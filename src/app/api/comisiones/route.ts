import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { esPeriodo, periodoDe } from "@/lib/comisiones";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { businessTimezone } from "@/server/analytics/period";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { resumenMes } from "@/server/comisiones/liquidaciones";

export const dynamic = "force-dynamic";

/**
 * 068 — El mes de comisiones. Quien configura ve a todo el equipo, la bandeja
 * «Sin atribuir» y la lista de personas para reasignar; un miembro, solo lo
 * suyo.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  const admin = canConfigure(session.role);
  const url = new URL(req.url);
  const pedido = url.searchParams.get("periodo");
  const tz = await businessTimezone(session.organizationId);
  const periodo = pedido ?? periodoDe(new Date(), tz);
  if (!esPeriodo(periodo)) return apiError(422, "invalid_period", "Usa el formato AAAA-MM");

  const resumen = await resumenMes(session.organizationId, periodo, {
    soloUserId: admin ? undefined : session.userId,
  });
  const equipo = admin
    ? await getDb()
        .select({ userId: schema.member.userId, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(scoped(schema.member.organizationId, session.organizationId))
    : [];
  return Response.json({ ...resumen, admin, equipo, yo: session.userId });
});
