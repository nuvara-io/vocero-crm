import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { revisarAbiertos } from "@/server/perfil/revisar";

export const dynamic = "force-dynamic";

/** 078 — Revisa los chats abiertos que ya estaban, con el modo de los ajustes. */
export const POST = withAuth(async (session) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra puede hacerlo");
  const resumen = await revisarAbiertos(session.organizationId);
  return Response.json({ ok: true, resumen });
});
