import { apiError, parseBody, withAuth } from "@/lib/api";
import { programarSchema } from "@/lib/envios";
import { businessTimezone } from "@/server/analytics/period";
import { EnvioError, programarEnvio, proximosEnvios } from "@/server/envios/servicio";

export const dynamic = "force-dynamic";

/** 085 — Lo programado y lo que mandará el seguimiento, de los próximos días. */
export const GET = withAuth(async (session, req: Request) => {
  const dias = Math.min(31, Math.max(1, Number(new URL(req.url).searchParams.get("dias") ?? 14) || 14));
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  const envios = await proximosEnvios(session.organizationId, dias);
  return Response.json({
    envios: conversationId ? envios.filter((e) => e.conversationId === conversationId) : envios,
    timezone: await businessTimezone(session.organizationId),
  });
});

/** 085 — Programar una plantilla para un día y hora. */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, programarSchema);
  if (!body.ok) return body.response;
  try {
    return Response.json({ id: await programarEnvio(session, body.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof EnvioError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
