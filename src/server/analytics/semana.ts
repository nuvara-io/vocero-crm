import { asc, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { diagnostico, mayorCaida, pasosDelEmbudo, type RevisionSemanalDto } from "@/lib/revision-semanal";

export type { RevisionSemanalDto };


const ETAPAS_MESA = ["demo agendada", "no asistió", "no asistio", "seguimiento"];

/**
 * 073 — La revisión semanal (plantilla de @tudeptodeventas): cuántos leads
 * distintos ENTRARON a cada etapa en los últimos 7 días, el paso entre etapas
 * y la plata que está esperando una decisión.
 */
export async function revisionSemanal(organizationId: string, ahora = new Date()): Promise<RevisionSemanalDto> {
  const db = getDb();
  const desde = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const etapas = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const conteos = await db
    .select({
      stageId: schema.leadStageEvent.toStageId,
      n: sql<number>`count(distinct ${schema.leadStageEvent.leadId})::int`,
    })
    .from(schema.leadStageEvent)
    .where(scoped(schema.leadStageEvent.organizationId, organizationId, gte(schema.leadStageEvent.occurredAt, desde)))
    .groupBy(schema.leadStageEvent.toStageId);
  const porEtapa = new Map(conteos.map((c) => [c.stageId, c.n]));

  // El camino principal: abiertas en orden y, al final, la primera ganada.
  const ganada = etapas.find((e) => e.kind === "won");
  const camino = [...etapas.filter((e) => e.kind === "open"), ...(ganada ? [ganada] : [])].map((e) => ({
    nombre: e.name,
    entradas: porEtapa.get(e.id) ?? 0,
  }));
  const pasos = pasosDelEmbudo(camino);
  const peor = mayorCaida(pasos);

  const mesaIds = etapas.filter((e) => ETAPAS_MESA.includes(e.name.trim().toLowerCase())).map((e) => e.id);
  let sobreLaMesa = { cents: 0, leads: 0, sinValor: 0 };
  if (mesaIds.length > 0) {
    const [fila] = await db
      .select({
        cents: sql<number>`coalesce(sum(${schema.lead.amountCents}), 0)::bigint`,
        leads: sql<number>`count(*)::int`,
        sinValor: sql<number>`count(*) filter (where ${schema.lead.amountCents} is null)::int`,
      })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId, inArray(schema.lead.stageId, mesaIds)));
    if (fila) sobreLaMesa = { cents: Number(fila.cents), leads: fila.leads, sinValor: fila.sinValor };
  }

  return {
    desde: desde.toISOString(),
    etapas: camino,
    pasos,
    caida: peor ? { ...peor, diagnostico: diagnostico(peor.hasta) } : null,
    sobreLaMesa,
  };
}
