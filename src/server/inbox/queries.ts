import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWindowOpen, replyWindow, windowRemainingMs } from "@/server/inbox/window";
import { capabilitiesFor, windowMsFor } from "@/server/channels/capabilities";
import type { ConversationDto } from "@/lib/types";
import type { AgendaDeChat } from "@/lib/bandeja-hoy";
import { PASOS_DEMO, type PasoDemo } from "@/lib/seguimiento-demo";
import { dayIsoInTz, timeInTz } from "@/lib/time/slots";
import { agendaEnabled } from "@/server/agenda/flag";
import { origenSinAnuncio } from "@/lib/anuncios";
import { getSettings } from "@/server/agenda/settings";

/**
 * 018 — El anuncio de origen viaja con la conversación. La llave única
 * (organización, conversación) garantiza a lo más una fila por renglón, así
 * que el LEFT JOIN no multiplica la lista.
 */
const anuncioDeLaConversacion = and(
  eq(schema.adAttribution.organizationId, schema.conversation.organizationId),
  eq(schema.adAttribution.conversationId, schema.conversation.id)
);

const anuncioDeLista = {
  id: schema.adAttribution.id,
  headline: schema.adAttribution.headline,
  sourceId: schema.adAttribution.sourceId,
  sourceType: schema.adAttribution.sourceType,
};

function aAnuncioDeLista(
  fila: {
    id: string | null;
    headline: string | null;
    sourceId: string | null;
    sourceType: string | null;
  } | null
): ConversationDto["anuncio"] {
  // Sin fila, drizzle devuelve el objeto con todo en null (o null a secas).
  if (!fila?.id) return null;
  return {
    headline: fila.headline,
    sourceId: fila.sourceId,
    sourceType: fila.sourceType,
  };
}

export async function listConversations(
  organizationId: string,
  since?: Date
): Promise<ConversationDto[]> {
  const db = getDb();
  // 064 — `organization_id` primero: es la primera columna de
  // `message_org_conv_idx`. Sin ella Postgres recorre TODOS los mensajes por
  // cada conversación de la lista (segundos con unas decenas de miles).
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.organization_id = ${schema.conversation.organizationId}
      and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;
  // 067 — Lo que la bandeja necesita para archivar, asignar, dar seguimiento
  // y actuar en lote sin pedir cada lead por separado.
  const stageKindSql = sql<string | null>`(
    select s.kind from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;
  const leadIdSql = sql<string | null>`(
    select l.id from lead l where l.contact_id = ${schema.contact.id} limit 1
  )`;
  const assigneeIdSql = sql<string | null>`(
    select l.assigned_user_id from lead l where l.contact_id = ${schema.contact.id} limit 1
  )`;
  const assigneeNameSql = sql<string | null>`(
    select u.name from lead l
    join "user" u on u.id = l.assigned_user_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;
  const lastDirectionSql = sql<string | null>`(
    select m.direction
    from message m
    where m.organization_id = ${schema.conversation.organizationId}
      and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;

  // 083 — Lo de la agenda que pide la vista «Hoy». Por contacto: una cita
  // agendada a mano puede no tener la conversación puesta.
  const proximaSql = sql<string | null>`(
    select to_char(b.scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from booking b
    where b.organization_id = ${schema.conversation.organizationId}
      and b.contact_id = ${schema.contact.id}
      and b.kind = 'session' and b.status = 'agendada' and b.is_test = false
      and b.scheduled_at > now() - interval '1 hour'
    order by b.scheduled_at asc
    limit 1
  )`;
  const porHacerSql = sql<string | null>`(
    select b.next_step || '|' || coalesce(b.next_step_on, '') from booking b
    where b.organization_id = ${schema.conversation.organizationId}
      and b.contact_id = ${schema.contact.id}
      and b.next_step in ('seguimiento', 'oferta', 'reagendar')
      and b.next_step_done_at is null and b.is_test = false
    order by b.next_step_on asc nulls first
    limit 1
  )`;
  const timezone = agendaEnabled() ? (await getSettings(organizationId)).timezone : null;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      stageKind: stageKindSql,
      leadId: leadIdSql,
      assigneeId: assigneeIdSql,
      assigneeName: assigneeNameSql,
      lastDirection: lastDirectionSql,
      proxima: proximaSql,
      porHacer: porHacerSql,
      anuncio: anuncioDeLista,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        since ? gt(schema.conversation.updatedAt, since) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));

  return rows.map((r) =>
    serializeConversation(
      r.conversation,
      r.contact,
      r.preview,
      r.stageName,
      aAnuncioDeLista(r.anuncio),
      {
        stageKind: aStageKind(r.stageKind),
        leadId: r.leadId,
        assignee:
          r.assigneeId && r.assigneeName ? { id: r.assigneeId, name: r.assigneeName } : null,
        lastDirection: r.lastDirection === "in" || r.lastDirection === "out" ? r.lastDirection : null,
      },
      timezone ? agendaDeChat(r.proxima, r.porHacer, timezone) : null
    )
  );
}

/** 083 — Pura: las dos columnas de la agenda a la forma de la bandeja. */
export function agendaDeChat(
  proxima: string | null,
  porHacer: string | null,
  timezone: string
): AgendaDeChat | null {
  const [paso, fecha] = (porHacer ?? "").split("|");
  const pasoOk = (PASOS_DEMO as readonly string[]).includes(paso ?? "") ? (paso as PasoDemo) : null;
  if (!proxima && !pasoOk) return null;
  return {
    proxima: proxima
      ? { startUtc: proxima, dia: dayIsoInTz(new Date(proxima), timezone), hora: timeInTz(proxima, timezone) }
      : null,
    porHacer: pasoOk ? { paso: pasoOk, fecha: fecha || null } : null,
  };
}

function aStageKind(kind: string | null): ConversationDto["stageKind"] {
  return kind === "open" || kind === "won" || kind === "lost" ? kind : null;
}

export async function getConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      anuncio: anuncioDeLista,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row, anuncio: aAnuncioDeLista(row.anuncio) } : null;
}

export async function listMessages(
  organizationId: string,
  conversationId: string,
  since?: Date
) {
  const db = getDb();
  return db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(schema.message.createdAt);
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null,
  anuncio: ConversationDto["anuncio"] = null,
  lista: Pick<ConversationDto, "stageKind" | "leadId" | "assignee" | "lastDirection"> = {
    stageKind: null,
    leadId: null,
    assignee: null,
    lastDirection: null,
  },
  agenda: AgendaDeChat | null = null
): ConversationDto {
  const caps = capabilitiesFor(c.channel);
  // 024: la extensión humana solo existe en los canales que la declaran.
  const reply =
    caps.humanAgentWindowMs !== null
      ? replyWindow(c.channel, c.lastInboundAt)
      : null;
  return {
    id: c.id,
    channel: c.channel,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    // 022: la ventana es la del canal (48 h en TikTok, 24 en los demás).
    windowOpen: isWindowOpen(c.lastInboundAt, new Date(), windowMsFor(c.channel)),
    windowRemainingMs: windowRemainingMs(
      c.lastInboundAt,
      new Date(),
      windowMsFor(c.channel)
    ),
    humanWindow: reply
      ? { open: reply.humanAgentTag, remainingMs: reply.humanAgentTag ? reply.operatorRemainingMs : 0 }
      : null,
    composer: {
      media: caps.outboundMedia,
      structured: caps.structuredMessages,
      // 039: la UI solo ofrece «Responder» donde el canal cita.
      quoteReply: caps.quoteReplies,
    },
    preview,
    anuncio,
    // 088 — Sin anuncio, de dónde vino.
    origen: anuncio
      ? null
      : origenSinAnuncio({
          source: contact.source,
          sourceHint: contact.sourceHint,
          prospectList: contact.prospectList,
          tieneChat: true,
        }),
    // 067
    archivedAt: contact.archivedAt?.toISOString() ?? null,
    // 078
    perfil: contact.perfilEstado ? { estado: contact.perfilEstado, motivo: contact.perfilMotivo } : null,
    agenda,
    ...lista,
  };
}

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  patch: { aiEnabled?: boolean; reactivate?: boolean; markRead?: boolean }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  return updated[0] ?? null;
}
