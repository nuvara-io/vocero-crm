import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { diaDe } from "@/lib/comisiones";
import { getDb, schema } from "@/lib/db";
import { zonedWallClockToUtc } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { publish } from "@/server/events/bus";
import { activarLead } from "@/server/leads/activar";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  montoCents: z.number().int().positive("Escribe cuánto pagó").max(1_000_000_000_000),
  pagadoEn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().trim().email("Correo inválido").max(200).nullish().or(z.literal("")),
});

/** 076 — Marcar activado con monto desde el chat (ver `server/leads/activar`). */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const tz = await businessTimezone(session.organizationId);
  if (body.data.pagadoEn > diaDe(new Date(), tz)) {
    return apiError(422, "fecha_futura", "La fecha del pago no puede ser futura");
  }
  const pagadoEn = zonedWallClockToUtc(body.data.pagadoEn, "12:00", tz);
  if (!pagadoEn) return apiError(422, "fecha", "Fecha inválida");

  const r = await activarLead(
    session.organizationId,
    { userId: session.userId, admin: canConfigure(session.role) },
    { leadId: id, montoCents: body.data.montoCents, pagadoEn, email: body.data.email || null }
  );
  if (!r.ok) return apiError(r.status, r.code, r.message);

  const conv = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.contactId, r.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (conv[0]) {
    publish(session.organizationId, { type: "conversation.updated", data: { conversation: { id: conv[0].id } } });
  }
  return Response.json({ ok: true, venta: r.venta, ventaMensaje: r.ventaMensaje ?? null });
});
