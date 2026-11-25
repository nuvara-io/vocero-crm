import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { NotaDto } from "@/lib/notas";
import { cambiosDeSeguimiento, type SeguimientoInput } from "@/lib/seguimiento-demo";
import { BookingError } from "@/server/agenda/service";
import { publish } from "@/server/events/bus";
import { crearNota, listarNotasDeCita } from "@/server/notas";

/**
 * 082 — Lo que pasó en la demo y qué sigue. La nota es una nota interna de la
 * conversación (se ve también en el chat, nunca le llega al cliente); el paso
 * vive en la cita.
 */

type Quien = { organizationId: string; userId: string; configura: boolean };

async function citaPropia(organizationId: string, bookingId: string) {
  const [cita] = await getDb()
    .select()
    .from(schema.booking)
    .where(scoped(schema.booking.organizationId, organizationId, eq(schema.booking.id, bookingId)))
    .limit(1);
  if (!cita || cita.kind !== "session") throw new BookingError("not_found", "Cita no encontrada");
  return cita;
}

/** La conversación de la cita o, si se agendó a mano, la última del contacto. */
async function conversacionDeCita(
  organizationId: string,
  cita: typeof schema.booking.$inferSelect
): Promise<string | null> {
  if (cita.conversationId || !cita.contactId) return cita.conversationId;
  const [conv] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, cita.contactId)
      )
    )
    .orderBy(desc(schema.conversation.lastMessageAt))
    .limit(1);
  return conv?.id ?? null;
}

export async function notasDeCita(quien: Quien, bookingId: string): Promise<NotaDto[]> {
  await citaPropia(quien.organizationId, bookingId);
  return listarNotasDeCita(quien, bookingId);
}

export async function guardarSeguimiento(
  quien: Quien,
  bookingId: string,
  input: SeguimientoInput
): Promise<NotaDto | null> {
  const cita = await citaPropia(quien.organizationId, bookingId);
  const conversationId = input.texto ? await conversacionDeCita(quien.organizationId, cita) : null;
  if (input.texto && !conversationId) {
    throw new BookingError("invalid", "Esta cita no tiene una conversación donde guardar la nota");
  }
  if (input.paso !== undefined || input.fecha !== undefined || input.hecho !== undefined) {
    // Sin `updatedAt` a propósito: ver el comentario de la columna.
    await getDb()
      .update(schema.booking)
      .set(cambiosDeSeguimiento(cita, input, new Date()))
      .where(scoped(schema.booking.organizationId, quien.organizationId, eq(schema.booking.id, bookingId)));
  }
  const nota =
    input.texto && conversationId ? await crearNota(quien, conversationId, input.texto, bookingId) : null;
  publish(quien.organizationId, { type: "booking.updated", data: { bookingId } });
  return nota;
}
