import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { LossReason } from "@/lib/types";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";

/**
 * 067 — Acciones sobre varias conversaciones a la vez: archivar, asignar y
 * mover de etapa. También las usa la acción de una sola conversación, para que
 * haya una regla y no dos.
 *
 * Todo se resuelve DENTRO de la organización: un id de otra organización se
 * ignora en silencio (cuenta como «no encontrado»), igual que en el resto de
 * la API.
 */

export const MAX_LOTE = 200;

export type Destino = { conversationId: string; contactId: string; leadId: string | null };

/** Conversaciones reales (no del Laboratorio) de la organización, con su lead. */
export async function resolverDestinos(
  organizationId: string,
  conversationIds: readonly string[]
): Promise<Destino[]> {
  if (conversationIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      conversationId: schema.conversation.id,
      contactId: schema.conversation.contactId,
      leadId: schema.lead.id,
    })
    .from(schema.conversation)
    .leftJoin(
      schema.lead,
      and(
        eq(schema.lead.organizationId, schema.conversation.organizationId),
        eq(schema.lead.contactId, schema.conversation.contactId)
      )
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        inArray(schema.conversation.id, [...conversationIds]),
        eq(schema.conversation.isTest, false)
      )
    );
  return rows;
}

function avisar(organizationId: string, destinos: readonly Destino[]) {
  for (const d of destinos) {
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: d.conversationId } },
    });
  }
}

export async function archivar(
  organizationId: string,
  destinos: readonly Destino[],
  archivado: boolean
): Promise<number> {
  if (destinos.length === 0) return 0;
  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set({ archivedAt: archivado ? new Date() : null, updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        inArray(
          schema.contact.id,
          destinos.map((d) => d.contactId)
        )
      )
    )
    .returning({ id: schema.contact.id });
  avisar(organizationId, destinos);
  return updated.length;
}

/** ¿Es miembro de la organización? Solo se asigna a gente del equipo. */
export async function esDelEquipo(organizationId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId))
    )
    .limit(1);
  return rows.length > 0;
}

export type ResultadoAsignar =
  | { ok: true; cambiados: number }
  | { ok: false; motivo: "no_es_del_equipo" };

export async function asignar(
  organizationId: string,
  destinos: readonly Destino[],
  userId: string | null
): Promise<ResultadoAsignar> {
  if (userId !== null && !(await esDelEquipo(organizationId, userId))) {
    return { ok: false, motivo: "no_es_del_equipo" };
  }
  const leadIds = destinos.map((d) => d.leadId).filter((id): id is string => id !== null);
  if (leadIds.length === 0) return { ok: true, cambiados: 0 };
  const db = getDb();
  const updated = await db
    .update(schema.lead)
    .set({ assignedUserId: userId, updatedAt: new Date() })
    .where(scoped(schema.lead.organizationId, organizationId, inArray(schema.lead.id, leadIds)))
    .returning({ id: schema.lead.id });
  avisar(organizationId, destinos);
  return { ok: true, cambiados: updated.length };
}

export type ResultadoMover =
  | { ok: true; movidos: number; omitidos: number }
  | { ok: false; motivo: "etapa_inexistente" | "falta_motivo" };

/**
 * Mueve cada lead por la puerta de siempre (`moveLeadToStage`): la bitácora,
 * la regla del motivo de pérdida y la conversión a Meta salen de ahí.
 */
export async function moverDeEtapa(
  organizationId: string,
  destinos: readonly Destino[],
  input: {
    stageId: string;
    actorUserId: string | null;
    lossReason?: LossReason | null;
    lossNote?: string | null;
  }
): Promise<ResultadoMover> {
  let movidos = 0;
  let omitidos = 0;
  for (const d of destinos) {
    if (!d.leadId) {
      omitidos++;
      continue;
    }
    const res = await moveLeadToStage({
      organizationId,
      leadId: d.leadId,
      toStageId: input.stageId,
      actorUserId: input.actorUserId,
      source: "dueno",
      lossReason: input.lossReason ?? null,
      lossNote: input.lossNote ?? null,
    });
    if (!res.ok) {
      if (res.reason === "stage_not_found") return { ok: false, motivo: "etapa_inexistente" };
      if (res.reason === "loss_reason_required") return { ok: false, motivo: "falta_motivo" };
      omitidos++;
      continue;
    }
    if (res.changed) movidos++;
  }
  avisar(organizationId, destinos);
  return { ok: true, movidos, omitidos };
}

/**
 * 077/078 — «No es perfil»: Perdido con ese motivo, archivado y marcado para
 * que el filtro no lo vuelva a revisar. Lo usan el botón y el filtro automático.
 */
export async function descartarNoPerfil(
  organizationId: string,
  destinos: readonly Destino[],
  input: { actorUserId: string | null; motivo?: string | null }
): Promise<{ ok: true; movidos: number; archivados: number } | { ok: false; motivo: "sin_etapa_perdida" }> {
  const db = getDb();
  const [perdida] = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.kind, "lost")))
    .orderBy(asc(schema.pipelineStage.position))
    .limit(1);
  if (!perdida) return { ok: false, motivo: "sin_etapa_perdida" };
  const res = await moverDeEtapa(organizationId, destinos, {
    stageId: perdida.id,
    actorUserId: input.actorUserId,
    lossReason: "no_es_perfil",
    lossNote: input.motivo ?? null,
  });
  const archivados = await archivar(organizationId, destinos, true);
  if (destinos.length > 0) {
    await db
      .update(schema.contact)
      .set({
        perfilEstado: "fuera",
        ...(input.motivo ? { perfilMotivo: input.motivo } : {}),
        perfilRevisadoAt: new Date(),
      })
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          inArray(
            schema.contact.id,
            destinos.map((d) => d.contactId)
          )
        )
      );
  }
  return { ok: true, movidos: res.ok ? res.movidos : 0, archivados };
}
