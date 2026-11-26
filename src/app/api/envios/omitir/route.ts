import { apiError, parseBody, withAuth } from "@/lib/api";
import { omitirSchema } from "@/lib/envios";
import { EnvioError, omitirAutomatico } from "@/server/envios/servicio";

export const dynamic = "force-dynamic";

/** 085 — Que el seguimiento automático no mande ese paso a ese chat. */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, omitirSchema);
  if (!body.ok) return body.response;
  try {
    await omitirAutomatico(session, body.data);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof EnvioError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
