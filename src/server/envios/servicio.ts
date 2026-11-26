import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import { horaValida, primeraHoraHabil, type EnvioDto } from "@/lib/envios";
import { businessTimezone } from "@/server/analytics/period";
import { ajustesCrm } from "@/server/crm-ajustes";
import { publish } from "@/server/events/bus";
import {
  candidatasDeSeguimiento,
  evaluarCandidata,
  horarioHabil,
  registrar,
} from "@/server/seguimiento/runner";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * 085 — Plantillas programadas por el equipo y lo que mandará el seguimiento
 * automático, en una sola lista. Nada de aquí escribe en `message` salvo el
 * envío a su hora, que pasa por `sendTemplate` como cualquier plantilla.
 */

export class EnvioError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type Quien = { organizationId: string; userId: string };

const DIA_MS = 86_400_000;

export async function programarEnvio(
  quien: Quien,
  input: { conversationId: string; templateId: string; variables: string[]; sendAt: string },
  ahora = new Date()
): Promise<string> {
  const db = getDb();
  const sendAt = new Date(input.sendAt);
  if (!horaValida(sendAt, ahora)) throw new EnvioError(422, "invalid_body", "Elige una hora que no haya pasado");
  const [conv] = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, quien.organizationId, eq(schema.conversation.id, input.conversationId)))
    .limit(1);
  if (!conv) throw new EnvioError(404, "not_found", "Conversación no encontrada");
  const [tpl] = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, quien.organizationId, eq(schema.template.id, input.templateId)))
    .limit(1);
  if (!tpl) throw new EnvioError(404, "not_found", "Plantilla no encontrada");
  if (tpl.status !== "approved") throw new EnvioError(422, "invalid_body", "Solo se programan plantillas aprobadas");
  const n = countVariables(tpl.body);
  if (input.variables.length < n) throw new EnvioError(422, "invalid_body", "Faltan datos de la plantilla");
  const id = newId("scheduledSend");
  await db.insert(schema.scheduledSend).values({
    id,
    organizationId: quien.organizationId,
    conversationId: conv.id,
    templateId: tpl.id,
    variables: input.variables.slice(0, n),
    sendAt,
    createdByUserId: quien.userId,
  });
  publish(quien.organizationId, { type: "conversation.updated", data: { conversation: { id: conv.id } } });
  return id;
}

export async function cambiarEnvio(
  quien: Quien,
  id: string,
  input: { action: "cancelar" } | { action: "mover"; sendAt: string },
  ahora = new Date()
): Promise<void> {
  const set =
    input.action === "cancelar"
      ? { status: "cancelado" as const, updatedAt: ahora }
      : { sendAt: new Date(input.sendAt), updatedAt: ahora };
  if (input.action === "mover" && !horaValida(set.sendAt as Date, ahora)) {
    throw new EnvioError(422, "invalid_body", "Elige una hora que no haya pasado");
  }
  // Solo lo pendiente se toca: lo que ya salió o está saliendo, no.
  const filas = await getDb()
    .update(schema.scheduledSend)
    .set(set)
    .where(
      scoped(
        schema.scheduledSend.organizationId,
        quien.organizationId,
        eq(schema.scheduledSend.id, id),
        eq(schema.scheduledSend.status, "pendiente")
      )
    )
    .returning({ conversationId: schema.scheduledSend.conversationId });
  if (filas.length === 0) throw new EnvioError(409, "conflict", "Ese envío ya salió o ya no está pendiente");
  publish(quien.organizationId, { type: "conversation.updated", data: { conversation: { id: filas[0]!.conversationId } } });
}

/**
 * Omitir un paso automático: queda registrado como hecho (sin enviar) y el
 * seguimiento sigue con el siguiente cuando le toque.
 */
export async function omitirAutomatico(
  quien: Quien,
  input: { conversationId: string; paso: number; ancla: string; templateId: string | null }
): Promise<void> {
  const [conv] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, quien.organizationId, eq(schema.conversation.id, input.conversationId)))
    .limit(1);
  if (!conv) throw new EnvioError(404, "not_found", "Conversación no encontrada");
  await registrar(quien.organizationId, conv.id, input.paso, new Date(input.ancla), input.templateId, false, "Omitido por el equipo");
}

/** Lo programado (pendiente y lo reciente) más lo automático de los próximos `dias`. */
export async function proximosEnvios(organizationId: string, dias = 14, ahora = new Date()): Promise<EnvioDto[]> {
  const db = getDb();
  const hasta = new Date(ahora.getTime() + dias * DIA_MS);
  const programados = await db
    .select({
      envio: schema.scheduledSend,
      contactoId: schema.contact.id,
      contactoNombre: schema.contact.name,
      plantilla: schema.template.name,
      quien: schema.user.name,
    })
    .from(schema.scheduledSend)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.scheduledSend.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .innerJoin(schema.template, eq(schema.template.id, schema.scheduledSend.templateId))
    .leftJoin(schema.user, eq(schema.user.id, schema.scheduledSend.createdByUserId))
    .where(
      scoped(
        schema.scheduledSend.organizationId,
        organizationId,
        lte(schema.scheduledSend.sendAt, hasta),
        // Lo pendiente de cualquier fecha y lo que pasó en las últimas 48 h.
        gte(schema.scheduledSend.updatedAt, new Date(ahora.getTime() - 2 * DIA_MS))
      )
    )
    .orderBy(asc(schema.scheduledSend.sendAt));
  const pendientesViejos = await db
    .select({ id: schema.scheduledSend.id })
    .from(schema.scheduledSend)
    .where(scoped(schema.scheduledSend.organizationId, organizationId, eq(schema.scheduledSend.status, "pendiente")));
  const vistos = new Set(programados.map((p) => p.envio.id));
  const faltan = pendientesViejos.filter((p) => !vistos.has(p.id)).map((p) => p.id);
  const extra = faltan.length
    ? await db
        .select({
          envio: schema.scheduledSend,
          contactoId: schema.contact.id,
          contactoNombre: schema.contact.name,
          plantilla: schema.template.name,
          quien: schema.user.name,
        })
        .from(schema.scheduledSend)
        .innerJoin(schema.conversation, eq(schema.conversation.id, schema.scheduledSend.conversationId))
        .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
        .innerJoin(schema.template, eq(schema.template.id, schema.scheduledSend.templateId))
        .leftJoin(schema.user, eq(schema.user.id, schema.scheduledSend.createdByUserId))
        .where(and(eq(schema.scheduledSend.organizationId, organizationId), inArray(schema.scheduledSend.id, faltan)))
    : [];

  const lista: EnvioDto[] = [...programados, ...extra].map((p) => ({
    id: p.envio.id,
    origen: "programado",
    conversationId: p.envio.conversationId,
    contacto: { id: p.contactoId, nombre: p.contactoNombre },
    plantilla: { id: p.envio.templateId, nombre: p.plantilla },
    accion: "enviar",
    cuando: p.envio.sendAt.toISOString(),
    estado: p.envio.status,
    error: p.envio.error,
    quien: p.quien,
  }));

  lista.push(...(await automaticos(organizationId, dias, ahora)));
  return lista.sort((a, b) => a.cuando.localeCompare(b.cuando));
}

/** Lo que el seguimiento automático hará con cada chat, si nada cambia antes. */
async function automaticos(organizationId: string, dias: number, ahora: Date): Promise<EnvioDto[]> {
  const ajustes = await ajustesCrm(organizationId);
  if (!ajustes.seguimiento.enabled && !ajustes.prospeccion.enabled) return [];
  const tz = await businessTimezone(organizationId);
  const { conAncla, hechos } = await candidatasDeSeguimiento(organizationId, ajustes.seguimiento);
  if (conAncla.length === 0) return [];
  const db = getDb();
  const plantillas = new Map(
    (
      await db
        .select({ id: schema.template.id, name: schema.template.name })
        .from(schema.template)
        .where(scoped(schema.template.organizationId, organizationId))
    ).map((t) => [t.id, t.name])
  );
  const etapas = new Map(
    (
      await db
        .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
        .from(schema.pipelineStage)
        .where(scoped(schema.pipelineStage.organizationId, organizationId))
    ).map((s) => [s.id, s.name])
  );
  const out: EnvioDto[] = [];
  for (const c of conAncla) {
    for (let k = 0; k <= dias; k++) {
      const e = evaluarCandidata(c, hechos, ajustes, ahora, k);
      if (!e) break;
      if (!e.decision) continue;
      // Le toca cuando el conteo de días llega a ese número (o ya, si k = 0);
      // sale en la primera hora hábil desde ahí.
      const diasHoy = Math.floor((ahora.getTime() - e.ancla.getTime()) / DIA_MS);
      const vence = k === 0 ? ahora : new Date(e.ancla.getTime() + (diasHoy + k) * DIA_MS);
      const cuando = primeraHoraHabil(vence, ahora, (d) => horarioHabil(d, tz));
      const d = e.decision;
      out.push({
        id: `auto:${c.conversationId}:${d.accion === "enviar" ? d.paso : 0}`,
        origen: "automatico",
        conversationId: c.conversationId,
        contacto: { id: c.contactId, nombre: c.nombre },
        plantilla: d.accion === "enviar" ? { id: d.templateId, nombre: plantillas.get(d.templateId) ?? "Plantilla borrada" } : null,
        accion: d.accion,
        cuando: cuando.toISOString(),
        estado: "pendiente",
        error: null,
        quien: null,
        paso: d.accion === "enviar" ? d.paso : 0,
        ancla: e.ancla.toISOString(),
        etapa: etapas.get(c.stageId) ?? null,
      });
      break;
    }
  }
  return out;
}

/** 085 — Lo programado que ya tocaba: se manda. La reserva evita enviarlo dos veces. */
export async function enviarProgramados(ahora = new Date()): Promise<{ enviados: number; errores: number }> {
  const db = getDb();
  const resumen = { enviados: 0, errores: 0 };
  const vencidos = await db
    .update(schema.scheduledSend)
    .set({ status: "enviando", updatedAt: ahora })
    .where(and(eq(schema.scheduledSend.status, "pendiente"), lte(schema.scheduledSend.sendAt, ahora)))
    .returning();
  for (const e of vencidos) {
    const [contacto] = await db
      .select({ suprimido: schema.contact.doNotContactAt })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(eq(schema.conversation.id, e.conversationId))
      .limit(1);
    let error: string | null = null;
    if (contacto?.suprimido) error = "El contacto pidió que no le escribieran";
    else {
      try {
        await sendTemplate({
          organizationId: e.organizationId,
          conversationId: e.conversationId,
          templateId: e.templateId,
          variables: e.variables,
        });
      } catch (err) {
        error = err instanceof Error ? err.message.slice(0, 300) : "error";
      }
    }
    await db
      .update(schema.scheduledSend)
      .set(error ? { status: "error", error, updatedAt: new Date() } : { status: "enviado", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.scheduledSend.id, e.id));
    if (error) resumen.errores++;
    else resumen.enviados++;
    publish(e.organizationId, { type: "conversation.updated", data: { conversation: { id: e.conversationId } } });
  }
  return resumen;
}

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __envios?: Estado };
const estado: Estado = (g.__envios ??= { timer: null, corriendo: false });

/** Cada minuto, lo programado que ya tocaba. */
export function iniciarEnviosProgramados(): void {
  if (estado.timer) return;
  estado.timer = setInterval(async () => {
    if (estado.corriendo) return;
    estado.corriendo = true;
    try {
      await enviarProgramados();
    } catch (err) {
      console.warn("[envios] la pasada falló:", err instanceof Error ? err.message : err);
    } finally {
      estado.corriendo = false;
    }
  }, 60_000);
}
