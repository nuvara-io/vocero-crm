import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { revisarVentaManual } from "@/server/comisiones/ventas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  accion: z.enum(["confirmar", "rechazar"]),
  nota: z.string().max(300).nullish(),
});

/** 069 — Confirmar o rechazar una venta registrada a mano. */
export const POST = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra confirma ventas");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  const r = await revisarVentaManual(session.organizationId, session.userId, id, body.data.accion, body.data.nota ?? null);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return Response.json({ ok: true });
});
