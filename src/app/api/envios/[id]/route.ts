import { apiError, parseBody, withAuth } from "@/lib/api";
import { moverSchema } from "@/lib/envios";
import { cambiarEnvio, EnvioError } from "@/server/envios/servicio";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 085 — Cancelar o mover un envío programado mientras esté pendiente. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, moverSchema);
  if (!body.ok) return body.response;
  try {
    await cambiarEnvio(session, id, body.data);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof EnvioError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
