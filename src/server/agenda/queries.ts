import { ocupadoEnGoogle } from "@/server/agenda/google-externos";
import { asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { PASOS_PENDIENTES, type PasoDemo } from "@/lib/seguimiento-demo";
import type { DateRange } from "@/lib/time/calendar";
import { addDaysISO, partsInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import { getSettings, type CalendarSettings } from "@/server/agenda/settings";

/** 015 — Listado de citas para la UI, con la hora en la zona del negocio. */

export type BookingListItem = {
  id: string;
  kind: "session" | "block";
  status: "agendada" | "realizada" | "no_show" | "cancelada";
  source: "manual" | "ai";
  scheduledAtUtc: string;
  durationMinutes: number;
  date: string;
  time: string;
  weekday: string;
  contact: { id: string; name: string } | null;
  conversationId: string | null;
  /** Con qué conector nació la entrega de esta cita. */
  connector: string | null;
  meetingLink: string | null;
  /** El proveedor falló al crear la reunión: se puede reintentar. */
  linkPending: boolean;
  isTest: boolean;
  notes: string | null;
  /** 082 — Qué sigue después de la demo; null si nadie lo ha anotado. */
  siguiente?: { paso: PasoDemo; fecha: string | null; hecho: boolean } | null;
};

/** Tope del listado sin rango: el de siempre, que leen los guiones E2E. */
export const LIST_LIMIT = 200;

/**
 * 215 — Tope de una consulta por rango. No es un límite del producto (92 días
 * de un negocio con 30 citas diarias son 2 760): es el seguro contra una
 * respuesta de megas. Si se alcanza, la respuesta lo dice (`truncated`) en vez
 * de esconder citas como hacía el tope de 200.
 */
export const RANGE_LIMIT = 3000;

/**
 * Cuánto mira hacia atrás la consulta por rango. La API acepta bloqueos de
 * hasta 600 minutos: uno que empezó a las 20:00 del día anterior al rango
 * sigue ocupando su madrugada y la rejilla lo tiene que pintar.
 */
const LOOKBACK_MS = 24 * 3_600_000;

type Row = {
  booking: typeof schema.booking.$inferSelect;
  contactId: string | null;
  contactName: string | null;
};

function baseQuery() {
  return getDb()
    .select({
      booking: schema.booking,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
    })
    .from(schema.booking)
    .leftJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id));
}

/** Las últimas 200 citas: el listado de siempre, para quien no pide rango. */
export async function listBookings(
  organizationId: string,
  settings?: CalendarSettings
): Promise<BookingListItem[]> {
  const resolved = settings ?? (await getSettings(organizationId));
  const rows = await baseQuery()
    .where(scoped(schema.booking.organizationId, organizationId))
    .orderBy(desc(schema.booking.scheduledAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => toListItem(r, resolved.timezone));
}

/**
 * 215 — Las citas que TOCAN un rango de días en la zona del negocio, en orden.
 *
 * `from`/`to` son fechas de calendario inclusivas; el corte se hace a la
 * medianoche del negocio, no a la de UTC (con cortes en UTC, lo que pasa
 * después de las 18:00 en México caería en la columna del día siguiente).
 */
export async function listBookingsInRange(
  organizationId: string,
  range: DateRange,
  settings?: CalendarSettings
): Promise<{ bookings: BookingListItem[]; truncated: boolean }> {
  const resolved = settings ?? (await getSettings(organizationId));
  const tz = resolved.timezone;
  // Fechas ya validadas (`parseRangeQuery`): la conversión no puede fallar.
  const start = zonedWallClockToUtc(range.from, "00:00", tz)!;
  const end = zonedWallClockToUtc(addDaysISO(range.to, 1), "00:00", tz)!;

  const rows = await baseQuery()
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        gte(schema.booking.scheduledAt, new Date(start.getTime() - LOOKBACK_MS)),
        lt(schema.booking.scheduledAt, end)
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(RANGE_LIMIT);

  // De lo que empezó el día anterior, solo lo que sigue ocupando el rango.
  const inRange = rows.filter(
    (r) =>
      r.booking.scheduledAt.getTime() + r.booking.durationMinutes * 60_000 >
      start.getTime()
  );
  return {
    bookings: inRange.map((r) => toListItem(r, tz)),
    truncated: rows.length === RANGE_LIMIT,
  };
}

/** 082 — Lo que falta por hacer después de las demos, lo más vencido primero. */
export async function listPendientesDeDemo(organizationId: string): Promise<BookingListItem[]> {
  const { timezone } = await getSettings(organizationId);
  const rows = await baseQuery()
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.kind, "session"),
        eq(schema.booking.isTest, false),
        inArray(schema.booking.nextStep, [...PASOS_PENDIENTES]),
        isNull(schema.booking.nextStepDoneAt)
      )
    )
    .orderBy(sql`${schema.booking.nextStepOn} asc nulls last`, asc(schema.booking.scheduledAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => toListItem(r, timezone));
}

function toListItem(r: Row, timezone: string): BookingListItem {
  const scheduledAtUtc = r.booking.scheduledAt.toISOString();
  const parts = partsInTz(scheduledAtUtc, timezone);
  return {
    id: r.booking.id,
    kind: r.booking.kind,
    status: r.booking.status,
    source: r.booking.source,
    scheduledAtUtc,
    durationMinutes: r.booking.durationMinutes,
    date: parts.date,
    time: parts.time,
    weekday: parts.weekday,
    contact: r.contactId ? { id: r.contactId, name: r.contactName ?? "" } : null,
    conversationId: r.booking.conversationId,
    connector: r.booking.connector,
    meetingLink: r.booking.meetingLink,
    linkPending: r.booking.linkPending,
    isTest: r.booking.isTest,
    notes: r.booking.notes,
    siguiente: r.booking.nextStep
      ? {
          paso: r.booking.nextStep,
          fecha: r.booking.nextStepOn,
          hecho: r.booking.nextStepDoneAt !== null,
        }
      : null,
  };
}

/** 079 — Marca de los bloques que vienen de Google: solo lectura en la UI. */
export const CONECTOR_GOOGLE_EXTERNO = "google-externo";

/**
 * 079 — Lo ocupado en Google Calendar como bloqueos del calendario del CRM.
 * Id con prefijo `gcal:` para que nada lo confunda con una cita propia.
 */
export async function bloquesDeGoogle(
  organizationId: string,
  range: DateRange,
  timezone: string
): Promise<BookingListItem[]> {
  const start = zonedWallClockToUtc(range.from, "00:00", timezone)!;
  const end = zonedWallClockToUtc(addDaysISO(range.to, 1), "00:00", timezone)!;
  const eventos = await ocupadoEnGoogle(organizationId, start, end).catch(() => []);
  return eventos.map((e) => {
    const parts = partsInTz(e.inicio, timezone);
    return {
      id: `gcal:${e.id}`,
      kind: "block" as const,
      status: "agendada" as const,
      source: "manual" as const,
      scheduledAtUtc: e.inicio,
      durationMinutes: Math.max(5, Math.round((Date.parse(e.fin) - Date.parse(e.inicio)) / 60_000)),
      date: parts.date,
      time: parts.time,
      weekday: parts.weekday,
      contact: null,
      conversationId: null,
      connector: CONECTOR_GOOGLE_EXTERNO,
      meetingLink: null,
      linkPending: false,
      isTest: false,
      notes: e.titulo ? `Ocupado (Google) · ${e.titulo}` : "Ocupado (Google)",
    };
  });
}
