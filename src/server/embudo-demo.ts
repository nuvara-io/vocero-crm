import { asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { primerNombre } from "@/lib/respuestas-rapidas";
import { countVariables } from "@/lib/templates";
import { ajustesCrm } from "@/server/crm-ajustes";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * 073 — Lo que pasa después de «Demo agendada», según la plantilla de
 * pipeline de @tudeptodeventas: la demo se hizo, o no asistió; y quien no
 * asistió NO se pierde: recibe un mensaje a los minutos, pasa a «Seguimiento»
 * y, si no responde, un segundo mensaje al día.
 */

export const ETAPAS_DEMO = ["Demo hecha", "Por decidir", "No asistió", "Seguimiento"] as const;

/** Pasos del seguimiento de no asistió en `followup_send` (no chocan con 0–3). */
const PASO_NO_ASISTIO_1 = 101;
const PASO_NO_ASISTIO_2 = 102;
/** 077 — Hasta cuánto después de marcar «no asistió» sale el primer mensaje. */
export const VENTANA_PASO1_MS = 6 * 60 * 60 * 1000;

type Stage = typeof schema.pipelineStage.$inferSelect;

/** Clave de nombre sin tildes ni mayúsculas: «No asistio» y «No asistió» son la misma etapa. */
const clave = (nombre: string) =>
  nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/**
 * Las etapas de demo, justo después de «Demo agendada» (o de la última etapa
 * abierta si no existe). Re-ejecutable: no duplica por nombre.
 */
export async function asegurarEtapasDeDemo(organizationId: string): Promise<Map<string, Stage>> {
  const db = getDb();
  const actuales = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const porNombre = new Map(actuales.map((s) => [clave(s.name), s]));
  const faltan = ETAPAS_DEMO.filter((n) => !porNombre.has(clave(n)));
  if (faltan.length > 0) {
    // 084 — Cada etapa que falta entra justo después de la anterior de la
    // lista que ya exista («Por decidir» tras «Demo hecha»), o de «Demo
    // agendada» si no hay ninguna.
    const orden = [...actuales];
    const ultimaAbierta = [...actuales].reverse().find((s) => s.kind === "open") ?? actuales[actuales.length - 1];
    await db.transaction(async (tx) => {
      for (const [i, nombre] of ETAPAS_DEMO.entries()) {
        if (porNombre.has(clave(nombre))) continue;
        const previa = ETAPAS_DEMO.slice(0, i)
          .reverse()
          .map((n) => porNombre.get(clave(n)))
          .find(Boolean);
        const ancla = previa ?? porNombre.get("demo agendada") ?? ultimaAbierta;
        const idx = ancla ? orden.findIndex((s) => s.id === ancla.id) + 1 : orden.length;
        const nueva = {
          id: newId("stage"),
          organizationId,
          name: nombre,
          position: 0,
          kind: "open" as const,
          requiresBooking: false,
          createdAt: new Date(),
        } as Stage;
        orden.splice(idx, 0, nueva);
        porNombre.set(clave(nombre), nueva);
        await tx.insert(schema.pipelineStage).values({
          id: nueva.id,
          organizationId,
          name: nombre,
          position: idx,
          kind: "open",
        });
      }
      // Posiciones consecutivas en el orden nuevo.
      for (const [pos, s] of orden.entries()) {
        if (s.position !== pos) {
          await tx.update(schema.pipelineStage).set({ position: pos }).where(eq(schema.pipelineStage.id, s.id));
        }
      }
    });
  }
  const todas = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId));
  // La primera por posición gana si hubiera dos con el mismo nombre.
  todas.sort((a, b) => a.position - b.position);
  const mapa = new Map<string, Stage>();
  for (const s of todas) if (!mapa.has(clave(s.name))) mapa.set(clave(s.name), s);
  return mapa;
}

/**
 * Al arrancar: las organizaciones que ya agendan demos (tienen «Demo agendada»
 * o una etapa que exige cita) ven las etapas nuevas en el tablero desde ya, sin
 * esperar a marcar la primera cita. Nunca tumba el arranque.
 */
export async function asegurarEtapasDeDemoEnTodas(): Promise<void> {
  const db = getDb();
  const filas = await db
    .selectDistinct({ org: schema.pipelineStage.organizationId })
    .from(schema.pipelineStage)
    .where(
      or(eq(schema.pipelineStage.requiresBooking, true), sql`lower(trim(${schema.pipelineStage.name})) = 'demo agendada'`)
    );
  for (const f of filas) {
    await asegurarEtapasDeDemo(f.org).catch((err) =>
      console.warn("[demo] no se crearon las etapas de demo:", err instanceof Error ? err.message : err)
    );
  }
}

const temporizadores = new Set<ReturnType<typeof setTimeout>>();

/**
 * Al marcar el resultado de una cita: la demo hecha mueve el lead a «Demo
 * hecha»; la que no se hizo, a «No asistió». Si está encendida la recuperación,
 * a los N minutos sale el primer mensaje (una pasada propia, además de la de
 * cada 15 minutos). Nunca tumba la acción del usuario.
 */
export async function alMarcarResultadoDeCita(
  organizationId: string,
  bookingId: string,
  status: "realizada" | "no_show",
  actorUserId: string | null
): Promise<void> {
  try {
    const db = getDb();
    const rows = await db
      .select({ contactId: schema.booking.contactId, isTest: schema.booking.isTest })
      .from(schema.booking)
      .where(scoped(schema.booking.organizationId, organizationId, eq(schema.booking.id, bookingId)))
      .limit(1);
    const b = rows[0];
    if (!b?.contactId || b.isTest) return;
    const etapas = await asegurarEtapasDeDemo(organizationId);
    const destino = etapas.get(status === "realizada" ? "demo hecha" : "no asistio");
    const lead = await db
      .select({ id: schema.lead.id, stageId: schema.lead.stageId })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, b.contactId)))
      .limit(1);
    if (destino && lead[0] && lead[0].stageId !== destino.id) {
      await moveLeadToStage({
        organizationId,
        leadId: lead[0].id,
        toStageId: destino.id,
        actorUserId,
        source: actorUserId ? "dueno" : "sistema",
      });
    }
    if (status === "no_show") {
      const { noAsistio } = await ajustesCrm(organizationId);
      if (noAsistio.enabled) {
        const t = setTimeout(
          () => {
            temporizadores.delete(t);
            void recuperarNoAsistidos(organizationId).catch(() => {});
          },
          noAsistio.minutos * 60 * 1000 + 5000
        );
        temporizadores.add(t);
      }
    }
  } catch (err) {
    console.warn("[demo] no se movió el lead tras la cita:", err instanceof Error ? err.message : err);
  }
}

export type ResumenNoAsistio = { enviados1: number; enviados2: number; errores: number };

/**
 * La recuperación de quien no asistió: citas marcadas «no asistió» en los
 * últimos 7 días. Paso 1 a los N minutos de marcarla (y el lead pasa a
 * «Seguimiento»); paso 2 a los N días del paso 1 si el cliente no escribió
 * nada después. Cada paso se registra una sola vez por cita.
 */
export async function recuperarNoAsistidos(organizationId: string, ahora = new Date()): Promise<ResumenNoAsistio> {
  const resumen: ResumenNoAsistio = { enviados1: 0, enviados2: 0, errores: 0 };
  const { noAsistio } = await ajustesCrm(organizationId);
  if (!noAsistio.enabled || !noAsistio.plantilla1) return resumen;
  const db = getDb();
  const desde = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const citas = await db
    .select({
      id: schema.booking.id,
      contactId: schema.booking.contactId,
      conversationId: schema.booking.conversationId,
      scheduledAt: schema.booking.scheduledAt,
      marcadaEn: schema.booking.updatedAt,
      nombre: schema.contact.name,
      suprimido: schema.contact.doNotContactAt,
    })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.booking.contactId))
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.status, "no_show"),
        eq(schema.booking.isTest, false),
        gt(schema.booking.updatedAt, desde),
        isNull(schema.contact.doNotContactAt)
      )
    );
  if (citas.length === 0) return resumen;

  // La conversación de cada contacto (la de la cita, o la primera que tenga).
  const convs = await db
    .select({ id: schema.conversation.id, contactId: schema.conversation.contactId, lastInboundAt: schema.conversation.lastInboundAt })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        inArray(
          schema.conversation.contactId,
          citas.map((c) => c.contactId).filter((x): x is string => Boolean(x))
        )
      )
    );
  const hechos = await db
    .select({ conversationId: schema.followupSend.conversationId, step: schema.followupSend.step, anchorAt: schema.followupSend.anchorAt, createdAt: schema.followupSend.createdAt })
    .from(schema.followupSend)
    .where(
      scoped(
        schema.followupSend.organizationId,
        organizationId,
        inArray(schema.followupSend.step, [PASO_NO_ASISTIO_1, PASO_NO_ASISTIO_2])
      )
    );
  const plantillas = await db
    .select({ id: schema.template.id, body: schema.template.body, status: schema.template.status })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));
  const plantilla = new Map(plantillas.map((p) => [p.id, p]));
  const etapas = await asegurarEtapasDeDemo(organizationId);
  const seguimiento = etapas.get("seguimiento");

  for (const c of citas) {
    const conv = convs.find((v) => v.id === c.conversationId) ?? convs.find((v) => v.contactId === c.contactId);
    if (!conv) continue;
    const ancla = c.scheduledAt;
    const hecho = (paso: number) =>
      hechos.find((h) => h.conversationId === conv.id && h.step === paso && h.anchorAt.getTime() === ancla.getTime());
    const paso1 = hecho(PASO_NO_ASISTIO_1);

    if (!paso1) {
      if (ahora.getTime() < c.marcadaEn.getTime() + noAsistio.minutos * 60 * 1000) continue;
      // 077 — El primer mensaje dice «te esperé en la demostración de hoy»: solo
      // para citas marcadas hace poco, nunca para las de días atrás.
      if (ahora.getTime() - c.marcadaEn.getTime() > VENTANA_PASO1_MS) continue;
      const ok = await enviar(organizationId, conv.id, noAsistio.plantilla1, c.nombre, plantilla, ancla, PASO_NO_ASISTIO_1);
      if (ok) {
        resumen.enviados1++;
        if (seguimiento && c.contactId) {
          const lead = await db
            .select({ id: schema.lead.id, stageId: schema.lead.stageId })
            .from(schema.lead)
            .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, c.contactId)))
            .limit(1);
          if (lead[0] && lead[0].stageId !== seguimiento.id) {
            await moveLeadToStage({ organizationId, leadId: lead[0].id, toStageId: seguimiento.id, source: "sistema" });
          }
        }
      } else resumen.errores++;
      continue;
    }

    if (!noAsistio.plantilla2 || hecho(PASO_NO_ASISTIO_2)) continue;
    // Si escribió después del primer mensaje, ya hay conversación: no se insiste.
    if (conv.lastInboundAt && conv.lastInboundAt > paso1.createdAt) continue;
    if (ahora.getTime() < paso1.createdAt.getTime() + noAsistio.dias2 * 24 * 60 * 60 * 1000) continue;
    const ok = await enviar(organizationId, conv.id, noAsistio.plantilla2, c.nombre, plantilla, ancla, PASO_NO_ASISTIO_2);
    if (ok) resumen.enviados2++;
    else resumen.errores++;
  }
  return resumen;
}

async function enviar(
  organizationId: string,
  conversationId: string,
  templateId: string,
  nombre: string,
  plantillas: Map<string, { id: string; body: string; status: string }>,
  ancla: Date,
  paso: number
): Promise<boolean> {
  const db = getDb();
  // Primero se reserva el paso (índice único conversación + paso + ancla): si
  // otra pasada ya lo tomó, esta no envía. Así nunca sale dos veces.
  const id = newId("followupSend");
  const reservado = await db
    .insert(schema.followupSend)
    .values({ id, organizationId, conversationId, step: paso, anchorAt: ancla, templateId, ok: true, error: null })
    .onConflictDoNothing()
    .returning({ id: schema.followupSend.id });
  if (reservado.length === 0) return false;

  const p = plantillas.get(templateId);
  let error: string | null = null;
  if (!p || p.status !== "approved") {
    error = "La plantilla no existe o no está aprobada";
  } else {
    try {
      const variables = countVariables(p.body) >= 1 ? [primerNombre(nombre) || "hola"] : [];
      await sendTemplate({ organizationId, conversationId, templateId: p.id, variables });
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : "error";
    }
  }
  if (error) {
    // Queda registrado como fallido: un error no se reintenta en bucle.
    await db.update(schema.followupSend).set({ ok: false, error }).where(eq(schema.followupSend.id, id));
    return false;
  }
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
  return true;
}

