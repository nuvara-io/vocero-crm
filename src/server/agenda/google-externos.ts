import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { listarEventosGoogle, type EventoGoogle } from "@/server/agenda/connectors/google";
import { getGoogleCredentials } from "@/server/agenda/connectors/google-credentials";
import { getSettings } from "@/server/agenda/settings";
import { publish } from "@/server/events/bus";

/**
 * 079 — Google Calendar → CRM.
 *
 * Antes la agenda solo iba del CRM a Google: lo que el dueño agendaba en
 * Google no existía para el CRM, y la IA podía ofrecer una demo encima de una
 * reunión suya. Ahora:
 *  1. Los eventos de Google ocupan la agenda (la IA no ofrece esos huecos).
 *  2. El calendario del CRM los muestra como «Ocupado (Google)».
 *  3. Si el dueño mueve o borra en Google una cita creada por el CRM, la cita
 *     del CRM se mueve o se cancela.
 * Best-effort: si Google falla, la agenda sigue con lo que el CRM sabe.
 */

const CACHE_MS = 60_000;
const cache = new Map<string, { en: number; eventos: EventoGoogle[] }>();

/** Solo si la agenda entrega por Google y la credencial está sana. */
async function credsActivas(organizationId: string) {
  const settings = await getSettings(organizationId);
  if (settings.connector !== "google") return null;
  const creds = await getGoogleCredentials(organizationId);
  if (!creds || creds.status !== "connected") return null;
  return creds;
}

async function eventosEnRango(organizationId: string, desde: Date, hasta: Date): Promise<EventoGoogle[] | null> {
  const creds = await credsActivas(organizationId);
  if (!creds) return null;
  // Rango redondeado a la hora para que consultas vecinas compartan caché.
  const h = 60 * 60 * 1000;
  const d = new Date(Math.floor(desde.getTime() / h) * h);
  const a = new Date(Math.ceil(hasta.getTime() / h) * h);
  const clave = `${organizationId}:${d.toISOString()}:${a.toISOString()}`;
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.en < CACHE_MS) return hit.eventos;
  try {
    const eventos = await listarEventosGoogle(creds, d, a);
    cache.set(clave, { en: Date.now(), eventos });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return eventos;
  } catch (err) {
    console.warn("[google] no se leyó el calendario:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Ids de eventos de Google que son citas del propio CRM. */
async function idsDelCrm(organizationId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await getDb()
    .select({ ref: schema.booking.externalRef })
    .from(schema.booking)
    .where(scoped(schema.booking.organizationId, organizationId, inArray(schema.booking.externalRef, ids)));
  return new Set(rows.map((r) => r.ref).filter((x): x is string => Boolean(x)));
}

/** Pura: los eventos que de verdad ocupan (ni cancelados, ni «disponible», ni del CRM). */
export function eventosQueOcupan(eventos: readonly EventoGoogle[], delCrm: ReadonlySet<string>): EventoGoogle[] {
  return eventos.filter((e) => !e.cancelado && !e.libre && e.inicio && e.fin && !delCrm.has(e.id));
}

/** 079 — Lo ocupado en Google que no es una cita del CRM. */
export async function ocupadoEnGoogle(
  organizationId: string,
  desde: Date,
  hasta: Date
): Promise<EventoGoogle[]> {
  const eventos = await eventosEnRango(organizationId, desde, hasta);
  if (!eventos?.length) return [];
  const delCrm = await idsDelCrm(
    organizationId,
    eventos.map((e) => e.id)
  );
  return eventosQueOcupan(eventos, delCrm);
}

export type CambioDeCita =
  | { bookingId: string; accion: "cancelar" }
  | { bookingId: string; accion: "mover"; inicio: Date; minutos: number };

/** Pura: qué cambió en Google para las citas del CRM. */
export function cambiosDesdeGoogle(
  citas: readonly { id: string; ref: string; scheduledAt: Date; durationMinutes: number }[],
  eventos: readonly EventoGoogle[]
): CambioDeCita[] {
  const porId = new Map(eventos.map((e) => [e.id, e]));
  const cambios: CambioDeCita[] = [];
  for (const c of citas) {
    const e = porId.get(c.ref);
    if (!e) continue; // fuera del rango leído: no se asume nada
    if (e.cancelado) {
      cambios.push({ bookingId: c.id, accion: "cancelar" });
      continue;
    }
    if (!e.inicio || !e.fin || e.diaCompleto) continue;
    const inicio = new Date(e.inicio);
    const minutos = Math.round((Date.parse(e.fin) - inicio.getTime()) / 60_000);
    if (inicio.getTime() !== c.scheduledAt.getTime() || (minutos > 0 && minutos !== c.durationMinutes)) {
      cambios.push({ bookingId: c.id, accion: "mover", inicio, minutos: minutos > 0 ? minutos : c.durationMinutes });
    }
  }
  return cambios;
}

/** 079 — Trae a la agenda del CRM lo que se movió o borró en Google (próximos 60 días). */
export async function sincronizarDesdeGoogle(organizationId: string, ahora = new Date()): Promise<number> {
  const hasta = new Date(ahora.getTime() + 60 * 24 * 60 * 60 * 1000);
  const eventos = await eventosEnRango(organizationId, ahora, hasta);
  if (!eventos) return 0;
  const db = getDb();
  const citas = await db
    .select({
      id: schema.booking.id,
      ref: schema.booking.externalRef,
      scheduledAt: schema.booking.scheduledAt,
      durationMinutes: schema.booking.durationMinutes,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.status, "agendada"),
          eq(schema.booking.connector, "google"),
          isNotNull(schema.booking.externalRef),
          gt(schema.booking.scheduledAt, ahora)
        )
      )
    );
  const cambios = cambiosDesdeGoogle(
    citas.map((c) => ({ ...c, ref: c.ref! })),
    eventos
  );
  for (const c of cambios) {
    await db
      .update(schema.booking)
      .set(
        c.accion === "cancelar"
          ? { status: "cancelada", updatedAt: new Date() }
          : { scheduledAt: c.inicio, durationMinutes: c.minutos, updatedAt: new Date() }
      )
      .where(eq(schema.booking.id, c.bookingId));
    publish(organizationId, { type: "booking.updated", data: { bookingId: c.bookingId } });
  }
  return cambios.length;
}

/* ---- Pasada periódica ---- */

const INTERVALO_MS = 5 * 60 * 1000;
type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __syncGoogle?: Estado };
const estado: Estado = (g.__syncGoogle ??= { timer: null, corriendo: false });

export function iniciarSyncGoogle(): void {
  if (estado.timer) return;
  estado.timer = setInterval(() => void pasadaSyncGoogle(), INTERVALO_MS);
}

export async function pasadaSyncGoogle(): Promise<void> {
  if (estado.corriendo) return;
  estado.corriendo = true;
  try {
    const orgs = await getDb()
      .selectDistinct({ id: schema.googleCredentials.organizationId })
      .from(schema.googleCredentials);
    for (const o of orgs) {
      await sincronizarDesdeGoogle(o.id).catch((err) =>
        console.warn("[google] sync falló:", err instanceof Error ? err.message : err)
      );
    }
  } finally {
    estado.corriendo = false;
  }
}
