import { describe, expect, it } from "vitest";
import { eventoDeGoogle } from "@/server/agenda/connectors/google";
import { cambiosDesdeGoogle, eventosQueOcupan } from "@/server/agenda/google-externos";

/** 079 — Google Calendar → CRM. */

describe("eventoDeGoogle", () => {
  it("evento con hora", () => {
    expect(
      eventoDeGoogle({
        id: "a",
        summary: "Reunión con banco",
        start: { dateTime: "2026-11-18T09:00:00-05:00" },
        end: { dateTime: "2026-11-18T10:00:00-05:00" },
      })
    ).toMatchObject({ id: "a", inicio: "2026-11-18T14:00:00.000Z", fin: "2026-11-18T15:00:00.000Z", diaCompleto: false });
  });
  it("día completo y «disponible»", () => {
    expect(
      eventoDeGoogle({ id: "b", start: { date: "2026-11-18" }, end: { date: "2026-11-19" }, transparency: "transparent" })
    ).toMatchObject({ diaCompleto: true, libre: true });
  });
  it("borrado sin fechas sirve para saber que se canceló", () => {
    expect(eventoDeGoogle({ id: "c", status: "cancelled" })).toMatchObject({ id: "c", cancelado: true });
  });
});

const ev = (id: string, extra: Partial<ReturnType<typeof eventoDeGoogle>> = {}) => ({
  id,
  titulo: null,
  inicio: "2026-11-18T14:00:00.000Z",
  fin: "2026-11-18T15:00:00.000Z",
  diaCompleto: false,
  libre: false,
  cancelado: false,
  ...extra,
});

describe("eventosQueOcupan", () => {
  it("ocupa lo propio del dueño, no las citas del CRM, ni lo «disponible» ni lo cancelado", () => {
    const r = eventosQueOcupan(
      [ev("dueno"), ev("cita-crm"), ev("libre", { libre: true }), ev("borrado", { cancelado: true })],
      new Set(["cita-crm"])
    );
    expect(r.map((e) => e.id)).toEqual(["dueno"]);
  });
});

describe("cambiosDesdeGoogle", () => {
  const cita = { id: "bk1", ref: "evt1", scheduledAt: new Date("2026-11-18T14:00:00Z"), durationMinutes: 30 };
  it("borrada en Google → se cancela en el CRM", () => {
    expect(cambiosDesdeGoogle([cita], [ev("evt1", { cancelado: true })])).toEqual([
      { bookingId: "bk1", accion: "cancelar" },
    ]);
  });
  it("movida en Google → se mueve en el CRM", () => {
    const r = cambiosDesdeGoogle(
      [cita],
      [ev("evt1", { inicio: "2026-11-18T16:00:00.000Z", fin: "2026-11-18T16:30:00.000Z" })]
    );
    expect(r).toEqual([{ bookingId: "bk1", accion: "mover", inicio: new Date("2026-11-18T16:00:00Z"), minutos: 30 }]);
  });
  it("igual en los dos lados → nada", () => {
    expect(cambiosDesdeGoogle([cita], [ev("evt1", { fin: "2026-11-18T14:30:00.000Z" })])).toEqual([]);
  });
  it("si Google no lo trajo (fuera del rango), no se asume que se borró", () => {
    expect(cambiosDesdeGoogle([cita], [])).toEqual([]);
  });
});
