import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { aprobarLiquidacion, marcarPagada, reabrirLiquidacion } from "@/server/comisiones/liquidaciones";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().min(1),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  accion: z.enum(["aprobar", "pagar", "reabrir"]),
  nota: z.string().max(500).nullish(),
});

/** 068 — Aprobar, marcar pagada o reabrir la liquidación de un mes. */
export const POST = withAuth(async (session, req: Request) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede liquidar comisiones");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { userId, periodo, accion, nota } = body.data;
  const org = session.organizationId;
  const r =
    accion === "aprobar"
      ? await aprobarLiquidacion(org, session.userId, userId, periodo, nota ?? null)
      : accion === "pagar"
        ? await marcarPagada(org, session.userId, userId, periodo)
        : await reabrirLiquidacion(org, userId, periodo);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return Response.json({ ok: true });
});
