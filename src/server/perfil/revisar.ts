import { z } from "zod";
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  accionDePerfil,
  pistaFueraDePerfil,
  PROMPT_PERFIL,
  type MotivoPerfil,
  type VeredictoPerfil,
} from "@/lib/perfil";
import { ajustesCrm } from "@/server/crm-ajustes";
import { publish } from "@/server/events/bus";
import { descartarNoPerfil } from "@/server/inbox/lote";

/**
 * 078 — Revisa si un lead está fuera de perfil (préstamo, empleo…).
 *
 * Solo mira los primeros mensajes de una conversación y solo pregunta a la IA
 * cuando hay pista por palabras. Nunca toca a quien una persona marcó «sí es
 * perfil», a un ganado o perdido, ni a un prospecto de la lista. Best-effort:
 * nada de aquí puede tumbar la ingesta del mensaje.
 */

const Veredicto = z.object({
  fueraDePerfil: z.boolean(),
  motivo: z.enum(["prestamo", "empleo", "otro_servicio", "spam"]).nullable(),
  confianza: z.number().min(0).max(1),
});

/** Cuántos mensajes del cliente se miran como máximo (el arranque de la charla). */
const MAX_ENTRANTES = 4;

export type ResultadoRevision = "sin_pista" | "omitido" | "marcado" | "descartado" | "perfil_ok" | "error";

export async function revisarPerfil(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  /** Revisión de chats viejos: mira los primeros mensajes aunque haya más. */
  ignorarConteo?: boolean;
}): Promise<ResultadoRevision> {
  try {
    const { filtroPerfil } = await ajustesCrm(input.organizationId);
    if (filtroPerfil.modo === "apagado") return "omitido";
    const db = getDb();

    const [fila] = await db
      .select({
        estado: schema.contact.perfilEstado,
        prospecto: schema.contact.prospectList,
        leadId: schema.lead.id,
        kind: schema.pipelineStage.kind,
        isTest: schema.conversation.isTest,
      })
      .from(schema.contact)
      .innerJoin(schema.conversation, eq(schema.conversation.id, input.conversationId))
      .leftJoin(schema.lead, eq(schema.lead.contactId, schema.contact.id))
      .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
      .where(scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, input.contactId)))
      .limit(1);
    if (!fila || fila.isTest || fila.prospecto) return "omitido";
    if (fila.estado === "ok" || fila.estado === "fuera") return "omitido";
    if (fila.kind === "won" || fila.kind === "lost") return "omitido";

    if (!input.ignorarConteo) {
      const [c] = await db
        .select({ n: count() })
        .from(schema.message)
        .where(and(eq(schema.message.conversationId, input.conversationId), eq(schema.message.direction, "in")));
      if (Number(c?.n ?? 0) > MAX_ENTRANTES) return "omitido";
    }

    const entrantes = await db
      .select({ text: schema.message.text })
      .from(schema.message)
      .where(and(eq(schema.message.conversationId, input.conversationId), eq(schema.message.direction, "in")))
      .orderBy(asc(schema.message.createdAt))
      .limit(MAX_ENTRANTES);
    const texto = entrantes
      .map((m) => m.text?.trim())
      .filter(Boolean)
      .join("\n");
    const pista = pistaFueraDePerfil(texto);
    if (!pista) return "sin_pista";

    const veredicto = await preguntarIa(input.organizationId, texto, pista);
    return await aplicar(input, filtroPerfil.modo, veredicto);
  } catch (err) {
    console.warn("[perfil] no se revisó:", err instanceof Error ? err.message : err);
    return "error";
  }
}

/**
 * Sin IA configurada (o si falla) se queda con la pista, pero con confianza
 * baja: marca para que una persona decida, nunca descarta solo.
 */
async function preguntarIa(organizationId: string, texto: string, pista: MotivoPerfil): Promise<VeredictoPerfil> {
  const r = await chatJson(
    Veredicto,
    [
      { role: "system", content: PROMPT_PERFIL },
      { role: "user", content: `Mensajes de la persona:\n"""\n${texto.slice(0, 1500)}\n"""` },
    ],
    { organizationId, timeoutMs: 20_000 }
  );
  if (r.ok) return r.data;
  return { fueraDePerfil: true, motivo: pista, confianza: 0.5 };
}

async function aplicar(
  input: { organizationId: string; conversationId: string; contactId: string },
  modo: "marcar" | "automatico" | "apagado",
  v: VeredictoPerfil
): Promise<ResultadoRevision> {
  const db = getDb();
  const accion = accionDePerfil(modo, v);
  if (accion === "nada") {
    await db
      .update(schema.contact)
      .set({ perfilRevisadoAt: new Date() })
      .where(eq(schema.contact.id, input.contactId));
    return "perfil_ok";
  }
  if (accion === "descartar") {
    const [lead] = await db
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(eq(schema.lead.contactId, input.contactId))
      .limit(1);
    await descartarNoPerfil(
      input.organizationId,
      [{ conversationId: input.conversationId, contactId: input.contactId, leadId: lead?.id ?? null }],
      { actorUserId: null, motivo: v.motivo }
    );
    publish(input.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: input.conversationId } },
    });
    return "descartado";
  }
  await db
    .update(schema.contact)
    .set({ perfilEstado: "sospecha", perfilMotivo: v.motivo, perfilRevisadoAt: new Date() })
    .where(eq(schema.contact.id, input.contactId));
  publish(input.organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: input.conversationId } },
  });
  return "marcado";
}

/**
 * 078 — Revisa los chats abiertos que ya estaban (para limpiar lo que llegó
 * antes de encender el filtro). Solo los que tienen pista por palabras llegan
 * a la IA; tope por corrida para no gastar de golpe.
 */
export async function revisarAbiertos(
  organizationId: string,
  tope = 200
): Promise<Record<ResultadoRevision, number>> {
  const db = getDb();
  const filas = await db
    .select({ conversationId: schema.conversation.id, contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .innerJoin(schema.lead, eq(schema.lead.contactId, schema.contact.id))
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        eq(schema.pipelineStage.kind, "open"),
        isNull(schema.contact.prospectList),
        or(isNull(schema.contact.perfilEstado), inArray(schema.contact.perfilEstado, ["sospecha"]))
      )
    )
    .orderBy(desc(schema.conversation.lastMessageAt))
    .limit(tope);
  const resumen: Record<ResultadoRevision, number> = {
    sin_pista: 0,
    omitido: 0,
    marcado: 0,
    descartado: 0,
    perfil_ok: 0,
    error: 0,
  };
  for (const f of filas) {
    const r = await revisarPerfil({ organizationId, ...f, ignorarConteo: true });
    resumen[r]++;
  }
  return resumen;
}

/** 078 — Una persona decide: «sí es perfil» (no se revisa más) o descarta. */
export async function marcarPerfilOk(organizationId: string, contactId: string): Promise<void> {
  await getDb()
    .update(schema.contact)
    .set({ perfilEstado: "ok", perfilRevisadoAt: new Date() })
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)));
}
