import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { CANALES_PERMISO } from "@/lib/prospeccion";
import { registrarAccion } from "@/server/prospeccion";

import { prospeccionEnabled } from "@/server/prospeccion-flag";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ contactId: string }> };

const bodySchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("permiso_pedido") }),
  z.object({
    accion: z.literal("permiso_si"),
    canal: z.enum(Object.keys(CANALES_PERMISO) as [keyof typeof CANALES_PERMISO, ...(keyof typeof CANALES_PERMISO)[]]),
    texto: z.string().trim().min(10, "Escribe el texto que aceptó").max(1000),
    fecha: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({ accion: z.literal("permiso_no"), nota: z.string().max(300).nullish() }),
  z.object({ accion: z.literal("baja"), nota: z.string().max(300).nullish() }),
]);

/** 072 — Pidió permiso, dio permiso (fecha, canal, texto), no lo dio o pidió la baja. */
export const POST = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!prospeccionEnabled()) return new Response(null, { status: 404 });
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { contactId } = await ctx.params;
  const accion =
    body.data.accion === "permiso_si"
      ? { ...body.data, fecha: body.data.fecha ? new Date(body.data.fecha) : undefined }
      : body.data;
  const r = await registrarAccion(session.organizationId, session.userId, contactId, accion);
  if (!r.ok) return apiError(r.status, "prospeccion", r.message);
  return Response.json({ ok: true });
});
