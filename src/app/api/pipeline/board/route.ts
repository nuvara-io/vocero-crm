import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";
import { origenSinAnuncio } from "@/lib/anuncios";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session) => {
  const db = getDb();

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
      // 087 — De qué pauta llegó, para la etiqueta y el filtro del tablero.
      anuncioId: schema.adAttribution.id,
      headline: schema.adAttribution.headline,
      sourceId: schema.adAttribution.sourceId,
      sourceType: schema.adAttribution.sourceType,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .leftJoin(
      schema.adAttribution,
      and(
        eq(schema.adAttribution.organizationId, schema.lead.organizationId),
        eq(schema.adAttribution.conversationId, schema.conversation.id)
      )
    )
    .where(scoped(schema.lead.organizationId, session.organizationId))
    .orderBy(asc(schema.lead.position));

  // La moneda del negocio viaja con el tablero: el cliente suma sus columnas y
  // necesita saber cuál es la única sumable, sin adivinarla ni pedirla aparte.
  const { currency } = await getBranding(session.organizationId);

  return Response.json({
    currency,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
      requiresBooking: s.requiresBooking,
    })),
    leads: leads.map((r) => ({
      id: r.lead.id,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      amountCents: r.lead.amountCents,
      currency: r.lead.currency,
      priority: r.lead.priority,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      conversationId: r.conversationId,
      anuncio: r.anuncioId
        ? { headline: r.headline, sourceId: r.sourceId, sourceType: r.sourceType }
        : null,
      // 088 — Sin anuncio, de dónde vino.
      origen: r.anuncioId
        ? null
        : origenSinAnuncio({
            source: r.contact.source,
            sourceHint: r.contact.sourceHint,
            prospectList: r.contact.prospectList,
            tieneChat: r.conversationId !== null,
          }),
    })),
  });
});
