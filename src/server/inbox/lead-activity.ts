import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { deducirOrigenPorSaludo, elegirResponsable } from "@/lib/crm-reglas";
import { ajustesCrm } from "@/server/crm-ajustes";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { recordLeadCreated } from "@/server/leads/stage-history";
import type { StageChangeSource } from "@/lib/types";

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en la primera etapa del pipeline; si lo tiene, se actualiza su
 * última actividad.
 */
export async function onLeadActivity(
  organizationId: string,
  contactId: string,
  at: Date,
  /** 071 — El primer mensaje y si vino de un anuncio, para el lead nuevo. */
  contexto: { texto?: string | null; conAnuncio?: boolean } = {}
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(eq(schema.lead.contactId, contactId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({ lastActivityAt: at, updatedAt: new Date() })
      .where(eq(schema.lead.id, existing[0].id));
    return;
  }

  const creado = await createLeadForContact({ organizationId, contactId, at });
  if (!creado) return;
  // 071 — Lo que se sabe del lead al nacer. Nada de esto puede tumbar la
  // ingesta del mensaje: si falla, el lead queda como antes.
  try {
    await completarLeadNuevo(organizationId, contactId, creado.id, contexto);
  } catch (err) {
    console.warn("[lead] no se completó el lead nuevo:", err instanceof Error ? err.message : err);
  }
}

/** 071 — Pista de origen (si no hubo anuncio) y responsable por defecto. */
async function completarLeadNuevo(
  organizationId: string,
  contactId: string,
  leadId: string,
  contexto: { texto?: string | null; conAnuncio?: boolean }
): Promise<void> {
  const db = getDb();
  const pista = contexto.conAnuncio ? null : deducirOrigenPorSaludo(contexto.texto);
  if (pista) {
    await db
      .update(schema.contact)
      .set({ sourceHint: pista, updatedAt: new Date() })
      .where(and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.id, contactId)));
  }

  const { responsable } = await ajustesCrm(organizationId);
  if (responsable.modo === "nadie") return;
  const [miembros, ultimo] = await Promise.all([
    db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId)),
    db
      .select({ userId: schema.lead.assignedUserId })
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          isNotNull(schema.lead.assignedUserId),
          ne(schema.lead.id, leadId)
        )
      )
      .orderBy(desc(schema.lead.createdAt))
      .limit(1),
  ]);
  const userId = elegirResponsable(
    responsable,
    new Set(miembros.map((m) => m.userId)),
    ultimo[0]?.userId ?? null
  );
  if (!userId) return;
  await db
    .update(schema.lead)
    .set({ assignedUserId: userId, updatedAt: new Date() })
    .where(and(eq(schema.lead.id, leadId), isNull(schema.lead.assignedUserId)));
}

/**
 * Crea el lead de un contacto. Lo comparten el webhook (sin `stageId`: primera
 * etapa abierta) y la captura manual (con la etapa que elija el dueño). Vive en
 * un solo sitio a propósito: el cálculo de la posición, el `onConflictDoNothing`
 * sobre `lead_contact_uq` y el registro en la bitácora son lo bastante sutiles
 * como para que dos copias diverjan en el primer cambio.
 *
 * Devuelve `null` si el pipeline no tiene etapas abiertas — quien llama decide
 * si eso es un error que mostrar (captura manual) o un silencio aceptable
 * (webhook: jamás debe tumbar la ingesta de un mensaje).
 */
export async function createLeadForContact(input: {
  organizationId: string;
  contactId: string;
  stageId?: string;
  at?: Date;
  /** Quién dio de alta: el webhook es `sistema`, la captura manual `dueno`. */
  source?: StageChangeSource;
  actorUserId?: string | null;
}): Promise<{ id: string; stageId: string } | null> {
  const db = getDb();

  let stageId = input.stageId;
  if (!stageId) {
    const firstStage = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(
        and(
          eq(schema.pipelineStage.organizationId, input.organizationId),
          eq(schema.pipelineStage.kind, "open")
        )
      )
      .orderBy(asc(schema.pipelineStage.position))
      .limit(1);
    if (!firstStage[0]) return null;
    stageId = firstStage[0].id;
  }

  const maxPos = await db
    .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, input.organizationId),
        eq(schema.lead.stageId, stageId)
      )
    );

  const inserted = await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      stageId,
      position: (maxPos[0]?.max ?? -1) + 1,
      lastActivityAt: input.at ?? null,
    })
    .onConflictDoNothing({ target: [schema.lead.contactId] })
    .returning({ id: schema.lead.id, stageId: schema.lead.stageId });

  const creado = inserted[0];
  if (!creado) return null;

  // El nacimiento del lead es el primer evento del embudo: sin él, "prospectos
  // que entraron en el periodo" no se podría contar desde la bitácora. Va aquí
  // DENTRO y no en quien llama, porque hay dos caminos que crean leads y el
  // segundo que alguien agregue lo olvidaría. Y va tras comprobar `creado`
  // porque `onConflictDoNothing` no devuelve fila cuando otro webhook
  // simultáneo ganó la carrera — ese ya anotó el suyo.
  await recordLeadCreated({
    organizationId: input.organizationId,
    leadId: creado.id,
    contactId: input.contactId,
    stageId: creado.stageId,
    occurredAt: input.at,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? "sistema",
  });

  return creado;
}
