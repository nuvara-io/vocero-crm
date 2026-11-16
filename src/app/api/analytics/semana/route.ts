import { withAuth } from "@/lib/api";
import { revisionSemanal } from "@/server/analytics/semana";

export const dynamic = "force-dynamic";

/** 073 — Revisión semanal del embudo. Siempre los últimos 7 días. */
export const GET = withAuth(async (session) => Response.json(await revisionSemanal(session.organizationId)));
