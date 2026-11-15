import { withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { listarProspectos } from "@/server/prospeccion";

import { prospeccionEnabled } from "@/server/prospeccion-flag";

export const dynamic = "force-dynamic";

/** 072 — Los prospectos importados con su etapa, permiso y el embudo del canal. */
export const GET = withAuth(async (session) => {
  if (!prospeccionEnabled()) return new Response(null, { status: 404 });
  const datos = await listarProspectos(session.organizationId);
  return Response.json({ ...datos, admin: canConfigure(session.role) });
});
