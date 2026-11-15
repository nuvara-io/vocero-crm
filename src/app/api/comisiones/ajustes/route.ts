import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { guardarIvaBps, ivaBpsDe } from "@/server/comisiones/ajustes";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";

export const dynamic = "force-dynamic";

/** 069 — El IVA incluido en los pagos (la comisión va sobre el neto). */
export const GET = withAuth(async (session) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  return Response.json({ ivaBps: await ivaBpsDe(session.organizationId) });
});

const bodySchema = z.object({ ivaBps: z.number().int().min(0).max(5_000) });

export const PUT = withAuth(async (session, req: Request) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia el IVA");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  await guardarIvaBps(session.organizationId, session.userId, body.data.ivaBps);
  return Response.json({ ok: true });
});
