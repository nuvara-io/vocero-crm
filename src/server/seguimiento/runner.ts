import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decidirSeguimiento, secuenciaDeEtapa } from "@/lib/crm-reglas";
import { festivosDe } from "@/lib/festivos";
import { horarioLey2300 } from "@/lib/prospeccion";
import { primerNombre } from "@/lib/respuestas-rapidas";
import { countVariables } from "@/lib/templates";
import { businessTimezone } from "@/server/analytics/period";
import { ajustesCrm } from "@/server/crm-ajustes";
import { recuperarNoAsistidos } from "@/server/embudo-demo";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * 071 — Seguimiento automático de quien dejó de contestar.
 *
 * Mira las conversaciones cuyo último movimiento fue NUESTRO: el ancla es el
 * primer mensaje nuestro después de su última respuesta, así los propios
 * mensajes de seguimiento no lo corren. A los N días manda la plantilla del
 * paso; al final, archiva. Si el cliente contesta, el ancla cambia y el ciclo
 * empieza de cero.
 *
 * Apagado por defecto (Ajustes → Seguimiento). Nunca toca conversaciones de
 * prueba, con una persona al frente, ni leads ganados o perdidos. Solo envía
 * en horario hábil del negocio (8:00–19:00, lunes a sábado, sin festivos) y
 * con un tope por pasada, para no soltar una ráfaga de golpe.
 */

const INTERVALO_MS = 15 * 60 * 1000;
const TOPE_POR_TANDA = 25;
const DIA_MS = 24 * 60 * 60 * 1000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __seguimiento?: Estado };
const estado: Estado = (g.__seguimiento ??= { timer: null, corriendo: false });

export function iniciarSeguimiento(): void {
  if (estado.timer) return;
  estado.timer = setInterval(() => void tandaSeguimiento(), INTERVALO_MS);
  setTimeout(() => void tandaSeguimiento(), 60_000);
}

/** ¿Es horario hábil en la zona del negocio? */
export function horarioHabil(ahora: Date, tz: string): boolean {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(ahora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const hora = Number(v("hour")) % 24;
  if (v("weekday") === "Sun" || hora < 8 || hora >= 19) return false;
  const dia = `${v("year")}-${v("month")}-${v("day")}`;
  return !festivosDe("CO", Number(v("year"))).includes(dia);
}

export type ResumenTanda = { revisadas: number; enviadas: number; archivadas: number; errores: number };

export async function tandaSeguimiento(ahora = new Date()): Promise<ResumenTanda> {
  const resumen: ResumenTanda = { revisadas: 0, enviadas: 0, archivadas: 0, errores: 0 };
  if (estado.corriendo) return resumen;
  estado.corriendo = true;
  try {
    const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
    for (const org of orgs) {
      // 073 — Recuperar a quien no asistió a la demo (si está encendido).
      if (horarioHabil(ahora, await businessTimezone(org.id))) {
        const n = await recuperarNoAsistidos(org.id, ahora).catch(() => null);
        if (n) {
          resumen.enviadas += n.enviados1 + n.enviados2;
          resumen.errores += n.errores;
        }
      }
      const r = await tandaDeOrganizacion(org.id, ahora);
      resumen.revisadas += r.revisadas;
      resumen.enviadas += r.enviadas;
      resumen.archivadas += r.archivadas;
      resumen.errores += r.errores;
    }
  } catch (err) {
    console.warn("[seguimiento] la pasada falló:", err instanceof Error ? err.message : err);
  } finally {
    estado.corriendo = false;
  }
  return resumen;
}

async function tandaDeOrganizacion(organizationId: string, ahora: Date): Promise<ResumenTanda> {
  const resumen: ResumenTanda = { revisadas: 0, enviadas: 0, archivadas: 0, errores: 0 };
  const { seguimiento, prospeccion } = await ajustesCrm(organizationId);
  if (!seguimiento.enabled && !prospeccion.enabled) return resumen;
  const tz = await businessTimezone(organizationId);
  if (!horarioHabil(ahora, tz)) return resumen;

  const db = getDb();
  // El ancla: el primer mensaje nuestro posterior a su última respuesta. Solo
  // conversaciones donde el cliente escribió alguna vez (un lead real).
  const candidatas = await db
    .select({
      conversationId: schema.conversation.id,
      contactId: schema.conversation.contactId,
      nombre: schema.contact.name,
      // 072 — Los prospectos llevan su propio seguimiento (y horario de ley).
      prospecto: schema.contact.prospectList,
      // 077 — Etapa del lead, para su secuencia propia, y si lo atiende una persona.
      leadId: schema.lead.id,
      stageId: schema.lead.stageId,
      atendido: schema.conversation.handoffAt,
      entroEtapa: sql<Date | null>`(
        select max(e."occurred_at") from "lead_stage_event" e
        where e."lead_id" = ${schema.lead.id} and e."to_stage_id" = ${schema.lead.stageId}
      )`,
      ancla: sql<Date>`(
        select min(m."created_at") from "message" m
        where m."conversation_id" = ${schema.conversation.id}
          and m."direction" = 'out'
          and m."created_at" > coalesce(${schema.conversation.lastInboundAt}, '-infinity'::timestamp)
      )`,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .innerJoin(schema.lead, eq(schema.lead.contactId, schema.contact.id))
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        // 077 — Los chats con una persona al frente entran solo si así se pidió.
        seguimiento.incluirAtendidos ? undefined : isNull(schema.conversation.handoffAt),
        isNull(schema.contact.archivedAt),
        isNull(schema.contact.doNotContactAt),
        eq(schema.pipelineStage.kind, "open"),
        // Un lead real escribió alguna vez; un prospecto con permiso puede no
        // haber contestado todavía (072).
        sql`(${schema.conversation.lastInboundAt} is not null or ${schema.contact.prospectList} is not null)`,
        sql`${schema.conversation.lastMessageAt} > coalesce(${schema.conversation.lastInboundAt}, '-infinity'::timestamp)`
      )
    )
    .limit(500);

  const conAncla = candidatas.filter((c) => c.ancla);
  resumen.revisadas = conAncla.length;
  if (conAncla.length === 0) return resumen;

  const hechos = await db
    .select({
      conversationId: schema.followupSend.conversationId,
      step: schema.followupSend.step,
      anchorAt: schema.followupSend.anchorAt,
    })
    .from(schema.followupSend)
    .where(
      scoped(
        schema.followupSend.organizationId,
        organizationId,
        inArray(
          schema.followupSend.conversationId,
          conAncla.map((c) => c.conversationId)
        )
      )
    );

  const plantillas = await db
    .select({ id: schema.template.id, body: schema.template.body, status: schema.template.status })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));
  const plantilla = new Map(plantillas.map((p) => [p.id, p]));

  let acciones = 0;
  for (const c of conAncla) {
    if (acciones >= TOPE_POR_TANDA) break;
    // 077 — Con secuencia por etapa los días cuentan desde lo más reciente:
    // nuestro mensaje sin respuesta o la entrada a la etapa. Cambiar de etapa
    // arranca su propia secuencia (otro ancla, otros pasos).
    const sec = c.prospecto ? { modo: "general" as const } : secuenciaDeEtapa(seguimiento, c.stageId);
    if (!sec) continue;
    if (!c.prospecto && c.atendido && sec.modo !== "etapa") continue;
    const base = new Date(c.ancla);
    const entro = c.entroEtapa ? new Date(c.entroEtapa) : null;
    const ancla = sec.modo === "etapa" && entro && entro > base ? entro : base;
    const dias = Math.floor((ahora.getTime() - ancla.getTime()) / DIA_MS);
    const pasosHechos = new Set(
      hechos
        .filter((h) => h.conversationId === c.conversationId && h.anchorAt.getTime() === ancla.getTime())
        .map((h) => h.step)
    );
    if (c.prospecto && !horarioLey2300(ahora, tz)) continue;
    const decision =
      sec.modo === "etapa"
        ? decidirSeguimiento({
            ajustes: { enabled: seguimiento.enabled, pasos: sec.secuencia.pasos, archivarDias: sec.secuencia.finalDias },
            dias,
            hechos: pasosHechos,
            final: sec.secuencia.final,
          })
        : decidirSeguimiento({ ajustes: c.prospecto ? prospeccion : seguimiento, dias, hechos: pasosHechos });
    if (!decision) continue;
    acciones++;

    if (decision.accion === "perdido") {
      // 077 — Al final de la secuencia: Perdido «Nunca contestó» (cuenta en el embudo).
      const perdida = await primeraEtapaPerdida(organizationId);
      if (perdida) {
        await moveLeadToStage({
          organizationId,
          leadId: c.leadId,
          toStageId: perdida,
          source: "sistema",
          lossReason: "nunca_contesto",
        }).catch(() => null);
      }
      await registrar(organizationId, c.conversationId, 0, ancla, null, Boolean(perdida), perdida ? null : "No hay etapa perdida");
      publish(organizationId, { type: "conversation.updated", data: { conversation: { id: c.conversationId } } });
      resumen.archivadas++;
      continue;
    }

    if (decision.accion === "archivar") {
      await db
        .update(schema.contact)
        .set({ archivedAt: ahora, updatedAt: ahora })
        .where(and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.id, c.contactId)));
      await registrar(organizationId, c.conversationId, 0, ancla, null, true, null);
      publish(organizationId, { type: "conversation.updated", data: { conversation: { id: c.conversationId } } });
      resumen.archivadas++;
      continue;
    }

    const p = plantilla.get(decision.templateId);
    if (!p || p.status !== "approved") {
      await registrar(organizationId, c.conversationId, decision.paso, ancla, decision.templateId, false, "La plantilla no existe o no está aprobada");
      resumen.errores++;
      continue;
    }
    const variables = countVariables(p.body) >= 1 ? [primerNombre(c.nombre) || "hola"] : [];
    try {
      await sendTemplate({ organizationId, conversationId: c.conversationId, templateId: p.id, variables });
      await registrar(organizationId, c.conversationId, decision.paso, ancla, p.id, true, null);
      resumen.enviadas++;
    } catch (err) {
      // Se registra igual: un error no se reintenta en bucle cada 15 minutos.
      await registrar(organizationId, c.conversationId, decision.paso, ancla, p.id, false, err instanceof Error ? err.message.slice(0, 300) : "error");
      resumen.errores++;
    }
  }
  return resumen;
}

async function registrar(
  organizationId: string,
  conversationId: string,
  step: number,
  anchorAt: Date,
  templateId: string | null,
  ok: boolean,
  error: string | null
): Promise<void> {
  await getDb()
    .insert(schema.followupSend)
    .values({ id: newId("followupSend"), organizationId, conversationId, step, anchorAt, templateId, ok, error })
    .onConflictDoNothing();
}

/** Lo último que hizo el seguimiento, para la pantalla de ajustes. */
export async function ultimosSeguimientos(organizationId: string, limite = 20) {
  return getDb()
    .select({
      createdAt: schema.followupSend.createdAt,
      step: schema.followupSend.step,
      ok: schema.followupSend.ok,
      error: schema.followupSend.error,
      nombre: schema.contact.name,
    })
    .from(schema.followupSend)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.followupSend.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(schema.followupSend.organizationId, organizationId))
    .orderBy(sql`${schema.followupSend.createdAt} desc`)
    .limit(limite);
}

/** 077 — La primera etapa perdida del tablero (por posición). */
async function primeraEtapaPerdida(organizationId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.kind, "lost")))
    .orderBy(schema.pipelineStage.position)
    .limit(1);
  return rows[0]?.id ?? null;
}
