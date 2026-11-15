import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { historialDeVenta, reasignarVenta } from "@/server/comisiones/ventas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 068 — Quién ha tenido esta venta y por qué. */
export const GET = withAuth(async (session, _req: Request, ctx: Ctx) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra ve el historial");
  const { id } = await ctx.params;
  return Response.json({ cambios: await historialDeVenta(session.organizationId, id) });
});

const bodySchema = z.object({
  userId: z.string().min(1).nullable(),
  motivo: z.string().trim().min(3, "Escribe el motivo").max(300),
});

/** 068 — Reasignar una venta (o asignar una «Sin atribuir»), con motivo. */
export const POST = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra reasigna ventas");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  const r = await reasignarVenta(session.organizationId, session.userId, id, body.data.userId, body.data.motivo);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return Response.json({ ok: true });
});
