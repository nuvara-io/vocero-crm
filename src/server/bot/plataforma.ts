import { and, eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";

/**
 * 067 — La plataforma del negocio avisa que un lead ya está dentro: se
 * registró o ya activó su cuenta. El CRM lo mueve de etapa y, al activar, lo
 * archiva para que deje de ocupar la Bandeja.
 *
 * Reglas:
 * - Solo hacia ADELANTE: un lead que ya está más avanzado (o ganado) no se
 *   devuelve. La plataforma puede mandar el mismo aviso cada noche sin daño.
 * - Se encuentra por teléfono (la identidad de WhatsApp) o por el correo que
 *   la ficha tenga en `correo` o `email`.
 * - Registrado → la etapa abierta con ese nombre (por defecto «Registrado»).
 *   Activado → la primera etapa ganada.
 */

export type EstadoPlataforma = "registrado" | "activado";

export type AvisoPlataforma = {
  telefono?: string | null;
  email?: string | null;
  estado: EstadoPlataforma;
  /** Nombre de la etapa para «registrado»; por defecto «Registrado». */
  etapaRegistrado?: string;
  /** Al activar, archiva el contacto (por defecto sí). */
  archivar?: boolean;
};

export type ResultadoAviso = {
  encontrados: number;
  movidos: number;
  archivados: number;
};

/** Solo dígitos; un celular colombiano de 10 dígitos gana el 57. */
export function telefonoComoIdentidad(telefono: string): string | null {
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length < 8) return null;
  if (/^3\d{9}$/.test(digitos)) return `57${digitos}`;
  return digitos;
}

export type ContactoPlataforma = {
  contactId: string;
  archivedAt: Date | null;
  leadId: string | null;
  stageId: string | null;
  assignedUserId: string | null;
};

/**
 * Los contactos que corresponden a un cliente de la plataforma, por teléfono
 * (identidad de WhatsApp o el teléfono guardado) o por el correo de la ficha.
 * 068 — También lo usa el registro de ventas para encontrar el responsable.
 */
export async function buscarContactosPlataforma(
  organizationId: string,
  datos: { telefono?: string | null; email?: string | null }
): Promise<ContactoPlataforma[]> {
  const db = getDb();
  const identidad = datos.telefono ? telefonoComoIdentidad(datos.telefono) : null;
  const email = datos.email?.trim().toLowerCase() || null;
  if (!identidad && !email) return [];

  const condiciones = [
    identidad ? eq(schema.contact.waIdentity, identidad) : undefined,
    identidad ? eq(sql`regexp_replace(coalesce(${schema.contact.phone}, ''), '\\D', '', 'g')`, identidad) : undefined,
    email ? sql`lower(${schema.contact.ficha}->>'correo') = ${email}` : undefined,
    email ? sql`lower(${schema.contact.ficha}->>'email') = ${email}` : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  return db
    .select({
      contactId: schema.contact.id,
      archivedAt: schema.contact.archivedAt,
      leadId: schema.lead.id,
      stageId: schema.lead.stageId,
      assignedUserId: schema.lead.assignedUserId,
    })
    .from(schema.contact)
    .leftJoin(
      schema.lead,
      and(
        eq(schema.lead.organizationId, schema.contact.organizationId),
        eq(schema.lead.contactId, schema.contact.id)
      )
    )
    .where(scoped(schema.contact.organizationId, organizationId, or(...condiciones)));
}

export async function aplicarAvisoPlataforma(
  organizationId: string,
  aviso: AvisoPlataforma
): Promise<ResultadoAviso> {
  const db = getDb();
  const contactos = await buscarContactosPlataforma(organizationId, aviso);

  if (contactos.length === 0) return { encontrados: 0, movidos: 0, archivados: 0 };

  const etapas = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(schema.pipelineStage.position);
  const nombreRegistrado = (aviso.etapaRegistrado ?? "Registrado").trim().toLowerCase();
  const destino =
    aviso.estado === "activado"
      ? etapas.find((e) => e.kind === "won")
      : etapas.find((e) => e.kind === "open" && e.name.trim().toLowerCase() === nombreRegistrado);

  let movidos = 0;
  let archivados = 0;
  for (const c of contactos) {
    if (destino && c.leadId) {
      const actual = etapas.find((e) => e.id === c.stageId);
      // Solo hacia adelante: nunca se saca a nadie de ganado, y un lead ya
      // más avanzado en el embudo se queda donde está.
      const avanza =
        !actual ||
        (actual.kind === "open" &&
          (destino.kind === "won" || actual.position < destino.position)) ||
        (actual.kind === "lost" && destino.kind === "won");
      if (avanza) {
        const res = await moveLeadToStage({
          organizationId,
          leadId: c.leadId,
          toStageId: destino.id,
          actorUserId: null,
          source: "sistema",
        });
        if (res.ok && res.changed) movidos++;
      }
    }
    if (aviso.estado === "activado" && aviso.archivar !== false && !c.archivedAt) {
      await db
        .update(schema.contact)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, c.contactId)));
      archivados++;
    }
  }

  const convs = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        or(...contactos.map((c) => eq(schema.conversation.contactId, c.contactId)))
      )
    );
  for (const cv of convs) {
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: cv.id } } });
  }

  return { encontrados: contactos.length, movidos, archivados };
}
