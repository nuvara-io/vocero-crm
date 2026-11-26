import { nombreParaPlantilla } from "@/lib/envios";
import { eq, gt, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { tocaRecordatorio } from "@/lib/crm-reglas";
import { sugerirVariables, type DatosPlantilla } from "@/lib/plantilla-variables";
import { countVariables } from "@/lib/templates";
import { businessTimezone } from "@/server/analytics/period";
import { getBranding } from "@/server/branding";
import { ajustesCrm } from "@/server/crm-ajustes";
import { publish } from "@/server/events/bus";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * 077 — Recordatorio automático de la demo N minutos antes (15 por defecto).
 *
 * Cada minuto busca citas agendadas que empiezan dentro de la ventana y les
 * manda la plantilla elegida con nombre, día, hora y enlace. Una sola vez por
 * cita y hora: queda en `followup_send` (paso 201, ancla = hora de la cita),
 * así reagendar la cita trae su propio recordatorio. Sin horario hábil: si la
 * demo es a las 8:00, el aviso sale a las 7:45.
 */

export const PASO_RECORDATORIO = 201;
const INTERVALO_MS = 60 * 1000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __recordatorioDemo?: Estado };
const estado: Estado = (g.__recordatorioDemo ??= { timer: null, corriendo: false });

export function iniciarRecordatorios(): void {
  if (estado.timer) return;
  estado.timer = setInterval(() => void tandaRecordatorios(), INTERVALO_MS);
}

export type ResumenRecordatorio = { enviados: number; errores: number };

export async function tandaRecordatorios(ahora = new Date()): Promise<ResumenRecordatorio> {
  const resumen: ResumenRecordatorio = { enviados: 0, errores: 0 };
  if (estado.corriendo) return resumen;
  estado.corriendo = true;
  try {
    const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
    for (const org of orgs) {
      const r = await recordatoriosDeOrganizacion(org.id, ahora).catch((err) => {
        console.warn("[recordatorio] falló:", err instanceof Error ? err.message : err);
        return null;
      });
      if (r) {
        resumen.enviados += r.enviados;
        resumen.errores += r.errores;
      }
    }
  } finally {
    estado.corriendo = false;
  }
  return resumen;
}

export async function recordatoriosDeOrganizacion(
  organizationId: string,
  ahora: Date
): Promise<ResumenRecordatorio> {
  const resumen: ResumenRecordatorio = { enviados: 0, errores: 0 };
  const { recordatorio } = await ajustesCrm(organizationId);
  if (!recordatorio.enabled || !recordatorio.plantilla) return resumen;

  const db = getDb();
  const hasta = new Date(ahora.getTime() + recordatorio.minutos * 60 * 1000);
  const citas = await db
    .select({
      id: schema.booking.id,
      contactId: schema.booking.contactId,
      conversationId: schema.booking.conversationId,
      scheduledAt: schema.booking.scheduledAt,
      enlace: schema.booking.meetingLink,
      nombre: schema.contact.name,
    })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.booking.contactId))
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.status, "agendada"),
        eq(schema.booking.kind, "session"),
        eq(schema.booking.isTest, false),
        gt(schema.booking.scheduledAt, ahora),
        lte(schema.booking.scheduledAt, hasta)
      )
    );
  const pendientes = citas.filter((c) =>
    tocaRecordatorio({ ahora, citaEn: c.scheduledAt, minutos: recordatorio.minutos })
  );
  if (pendientes.length === 0) return resumen;

  const contactos = pendientes.map((c) => c.contactId).filter((x): x is string => Boolean(x));
  const convs = await db
    .select({ id: schema.conversation.id, contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        inArray(schema.conversation.contactId, contactos)
      )
    );
  const [plantilla] = await db
    .select({ id: schema.template.id, body: schema.template.body, status: schema.template.status })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, recordatorio.plantilla)))
    .limit(1);
  const [tz, branding] = await Promise.all([businessTimezone(organizationId), getBranding(organizationId)]);

  for (const c of pendientes) {
    const conv = convs.find((v) => v.id === c.conversationId) ?? convs.find((v) => v.contactId === c.contactId);
    if (!conv) continue;
    // Reclamar el envío ANTES de mandarlo: dos pasadas no lo duplican.
    const reclamado = await db
      .insert(schema.followupSend)
      .values({
        id: newId("followupSend"),
        organizationId,
        conversationId: conv.id,
        step: PASO_RECORDATORIO,
        anchorAt: c.scheduledAt,
        templateId: recordatorio.plantilla,
        ok: true,
      })
      .onConflictDoNothing()
      .returning({ id: schema.followupSend.id });
    const fila = reclamado[0];
    if (!fila) continue;

    const fallo = async (error: string) => {
      await db
        .update(schema.followupSend)
        .set({ ok: false, error: error.slice(0, 300) })
        .where(eq(schema.followupSend.id, fila.id));
      resumen.errores++;
    };
    if (!plantilla || plantilla.status !== "approved") {
      await fallo("La plantilla del recordatorio no existe o no está aprobada");
      continue;
    }
    const datos: DatosPlantilla = {
      nombre: nombreParaPlantilla(c.nombre),
      asesor: null,
      negocio: branding.name || null,
      cita: datosDeCita(c.scheduledAt, c.enlace, tz),
    };
    const sugeridas = sugerirVariables(plantilla.body, countVariables(plantilla.body), datos);
    if (sugeridas.some((v) => !v.valor.trim())) {
      const falta = sugeridas.find((v) => !v.valor.trim())?.etiqueta ?? "un dato";
      await fallo(`Falta ${falta.toLowerCase()} para el recordatorio`);
      continue;
    }
    try {
      await sendTemplate({
        organizationId,
        conversationId: conv.id,
        templateId: plantilla.id,
        variables: sugeridas.map((v) => v.valor),
      });
      resumen.enviados++;
      publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conv.id } } });
    } catch (err) {
      await fallo(err instanceof Error ? err.message : "error");
    }
  }
  return resumen;
}

/** Día y hora como los dice el CRM en las plantillas (zona del negocio). */
export function datosDeCita(
  en: Date,
  enlace: string | null,
  tz: string
): NonNullable<DatosPlantilla["cita"]> {
  return {
    fecha: new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })
      .format(en)
      .replace(",", ""),
    hora: new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
      .format(en)
      .replace(/\s+/g, " "),
    enlace,
    proxima: en.getTime() > Date.now(),
  };
}
