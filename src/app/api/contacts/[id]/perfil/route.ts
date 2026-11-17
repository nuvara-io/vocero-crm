import { apiError, withAuth } from "@/lib/api";
import { marcarPerfilOk } from "@/server/perfil/revisar";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 078 — «Sí es perfil»: el filtro no lo vuelve a marcar. */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  if (!id) return apiError(400, "invalid", "Falta el contacto");
  await marcarPerfilOk(session.organizationId, id);
  return Response.json({ ok: true });
});
