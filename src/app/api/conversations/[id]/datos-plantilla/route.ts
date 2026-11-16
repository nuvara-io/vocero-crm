import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DatosPlantilla } from "@/lib/plantilla-variables";
import { businessTimezone } from "@/server/analytics/period";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const primerNombre = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * 074 — Lo que el CRM ya sabe para llenar una plantilla: el nombre del
 * cliente, el de quien escribe, el negocio y la próxima cita (o la última, si
 * no hay una por venir) con día y hora en la zona del negocio.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const org = session.organizationId;
  const [conv] = await db
    .select({ contactId: schema.conversation.contactId, nombre: schema.contact.name })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(schema.conversation.organizationId, org, eq(schema.conversation.id, id)))
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  const [yo] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, session.userId))
    .limit(1);
  const [tz, branding] = await Promise.all([businessTimezone(org), getBranding(org)]);

  const columnas = {
    scheduledAt: schema.booking.scheduledAt,
    meetingLink: schema.booking.meetingLink,
  };
  const delContacto = scoped(schema.booking.organizationId, org, eq(schema.booking.contactId, conv.contactId));
  const haceUnRato = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let [cita] = await db
    .select(columnas)
    .from(schema.booking)
    .where(and(delContacto, eq(schema.booking.status, "agendada"), gte(schema.booking.scheduledAt, haceUnRato)))
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(1);
  if (!cita) {
    [cita] = await db
      .select(columnas)
      .from(schema.booking)
      .where(and(delContacto, inArray(schema.booking.status, ["agendada", "no_show", "realizada"])))
      .orderBy(desc(schema.booking.scheduledAt))
      .limit(1);
  }

  const datos: DatosPlantilla = {
    nombre: primerNombre(conv.nombre) || null,
    asesor: primerNombre(yo?.name) || null,
    negocio: branding.name || null,
    cita: cita
      ? {
          fecha: new Intl.DateTimeFormat("es-CO", {
            timeZone: tz,
            weekday: "long",
            day: "numeric",
            month: "long",
          })
            .format(cita.scheduledAt)
            .replace(",", ""),
          hora: new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
            .format(cita.scheduledAt)
            .replace(/\s+/g, " "),
          enlace: cita.meetingLink,
        }
      : null,
  };
  return Response.json(datos);
});
