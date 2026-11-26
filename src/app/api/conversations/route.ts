import { withAuth } from "@/lib/api";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";
import { listConversations } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const conversations = await listConversations(
    session.organizationId,
    since && !Number.isNaN(since.getTime()) ? since : undefined
  );
  // 083 — La zona del negocio: «hoy» para la bandeja se cuenta ahí.
  const timezone = agendaEnabled() ? (await getSettings(session.organizationId)).timezone : null;
  return Response.json({ conversations, timezone });
});
