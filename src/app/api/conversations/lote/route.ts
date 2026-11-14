import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  archivar,
  asignar,
  MAX_LOTE,
  moverDeEtapa,
  resolverDestinos,
} from "@/server/inbox/lote";

export const dynamic = "force-dynamic";

const LOSS = z.enum([
  "precio",
  "no_es_perfil",
  "sin_presupuesto",
  "eligio_otro",
  "nunca_contesto",
  "otro",
]);

const bodySchema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("archivar"),
    ids: z.array(z.string().min(1)).min(1).max(MAX_LOTE),
    archivado: z.boolean(),
  }),
  z.object({
    accion: z.literal("asignar"),
    ids: z.array(z.string().min(1)).min(1).max(MAX_LOTE),
    /** `null` = quitar la asignación. */
    userId: z.string().min(1).nullable(),
  }),
  z.object({
    accion: z.literal("etapa"),
    ids: z.array(z.string().min(1)).min(1).max(MAX_LOTE),
    stageId: z.string().min(1),
    lossReason: LOSS.optional(),
    lossNote: z.string().max(500).optional(),
  }),
]);

/**
 * 067 — Una acción sobre varias conversaciones de la Bandeja (o sobre una sola:
 * el botón «Archivar» del chat usa esta misma ruta).
 *
 * Las conversaciones que no son de la organización o son del Laboratorio se
 * ignoran: la respuesta dice cuántas se tocaron de verdad.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const destinos = await resolverDestinos(session.organizationId, body.data.ids);
  if (destinos.length === 0) {
    return apiError(404, "not_found", "Ninguna conversación encontrada");
  }

  switch (body.data.accion) {
    case "archivar": {
      const cambiados = await archivar(session.organizationId, destinos, body.data.archivado);
      return Response.json({ ok: true, cambiados });
    }
    case "asignar": {
      const res = await asignar(session.organizationId, destinos, body.data.userId);
      if (!res.ok) return apiError(422, "no_es_del_equipo", "Esa persona no es del equipo");
      return Response.json({ ok: true, cambiados: res.cambiados });
    }
    case "etapa": {
      const res = await moverDeEtapa(session.organizationId, destinos, {
        stageId: body.data.stageId,
        actorUserId: session.userId,
        lossReason: body.data.lossReason ?? null,
        lossNote: body.data.lossNote ?? null,
      });
      if (!res.ok) {
        return res.motivo === "etapa_inexistente"
          ? apiError(422, "invalid_stage", "Etapa inexistente")
          : apiError(422, "loss_reason_required", "Falta el motivo de la pérdida");
      }
      return Response.json({ ok: true, cambiados: res.movidos, omitidos: res.omitidos });
    }
  }
});
