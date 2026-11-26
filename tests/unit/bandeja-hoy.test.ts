import { describe, expect, it } from "vitest";
import { detalleHoy, grupoHoy, type ParaHoy } from "@/lib/bandeja-hoy";
import { agendaDeChat } from "@/server/inbox/queries";

const ahora = new Date("2026-11-26T15:00:00Z");
const hoy = "2026-11-26";
const manana = "2026-11-27";
const haceDias = (d: number) => new Date(ahora.getTime() - d * 86_400_000).toISOString();
const c = (o: Partial<ParaHoy>): ParaHoy => ({
  lastDirection: "out",
  lastMessageAt: haceDias(0.2),
  stageKind: "open",
  stageName: "En conversación",
  archivedAt: null,
  agenda: null,
  ...o,
});
const demo = (dia: string) => ({ proxima: { startUtc: `${dia}T13:35:00Z`, dia, hora: "08:35" }, porHacer: null });
const g = (o: Partial<ParaHoy>) => grupoHoy(c(o), hoy, manana, ahora);

describe("083 — vista «Hoy» de la bandeja", () => {
  it("el cliente habló último: contestar, aunque tenga demo", () => {
    expect(g({ lastDirection: "in", agenda: demo(hoy) })).toBe("contestar");
  });
  it("demo hoy o mañana; una más adelante espera", () => {
    expect(g({ agenda: demo(hoy) })).toBe("demos");
    expect(g({ agenda: demo(manana) })).toBe("demos");
    expect(g({ agenda: demo("2026-12-02"), lastMessageAt: haceDias(9) })).toBe("esperando");
  });
  it("lo de «Por hacer» con fecha de hoy, vencido o sin fecha; el de más adelante no sale", () => {
    const ph = (fecha: string | null) => ({ proxima: null, porHacer: { paso: "oferta" as const, fecha } });
    expect(g({ agenda: ph(hoy) })).toBe("seguimiento");
    expect(g({ agenda: ph("2026-11-20") })).toBe("seguimiento");
    expect(g({ agenda: ph(null) })).toBe("seguimiento");
    expect(g({ agenda: ph("2026-11-30") })).toBeNull();
  });
  it("le escribimos hace 2 días o más: seguimiento; 7 o más antes de la demo: dormido", () => {
    expect(g({ lastMessageAt: haceDias(1) })).toBe("esperando");
    expect(g({ lastMessageAt: haceDias(3) })).toBe("seguimiento");
    expect(g({ lastMessageAt: haceDias(10) })).toBe("dormidos");
    // En una etapa de demo no se duerme: sigue pidiendo seguimiento.
    expect(g({ stageName: "Demo hecha", lastMessageAt: haceDias(10) })).toBe("seguimiento");
    expect(g({ stageName: "No asistió", lastMessageAt: haceDias(0.1) })).toBe("seguimiento");
  });
  it("cerrados y clientes al día no salen", () => {
    expect(g({ archivedAt: haceDias(1), lastDirection: "in" })).toBeNull();
    expect(g({ stageKind: "lost" })).toBeNull();
    expect(g({ stageKind: "won", stageName: "Activado", lastMessageAt: haceDias(5) })).toBeNull();
    expect(g({ stageName: "Registrado", lastDirection: "in" })).toBe("contestar");
  });
  it("la etiqueta dice qué hacer", () => {
    expect(detalleHoy(c({ agenda: demo(hoy) }), "demos", hoy, ahora)).toEqual({ texto: "Demo hoy 08:35", urgente: true });
    expect(
      detalleHoy(c({ agenda: { proxima: null, porHacer: { paso: "oferta", fecha: "2026-11-24" } } }), "seguimiento", hoy, ahora)
    ).toEqual({ texto: "Enviar oferta · vencido", urgente: true });
    expect(detalleHoy(c({ lastMessageAt: haceDias(3) }), "seguimiento", hoy, ahora)?.texto).toBe("Sin respuesta · 3 d");
  });
  it("la agenda del servidor, en la zona del negocio", () => {
    expect(agendaDeChat(null, null, "America/Bogota")).toBeNull();
    expect(agendaDeChat("2026-11-27T03:00:00Z", "oferta|", "America/Bogota")).toEqual({
      proxima: { startUtc: "2026-11-27T03:00:00Z", dia: "2026-11-26", hora: expect.any(String) },
      porHacer: { paso: "oferta", fecha: null },
    });
    expect(agendaDeChat(null, "otra|2026-11-26", "America/Bogota")).toBeNull();
  });
});

describe("084 — Por decidir", () => {
  it("demo hecha y sin decisión: espera 2 días y luego pide recontactar; nunca se duerme", () => {
    expect(g({ stageName: "Por decidir", lastMessageAt: haceDias(1) })).toBe("esperando");
    expect(g({ stageName: "Por decidir", lastMessageAt: haceDias(3) })).toBe("seguimiento");
    expect(g({ stageName: "Por decidir", lastMessageAt: haceDias(20) })).toBe("seguimiento");
    expect(detalleHoy(c({ stageName: "Por decidir", lastMessageAt: haceDias(5) }), "seguimiento", hoy, ahora)).toEqual({
      texto: "Por decidir · 5 d",
      urgente: true,
    });
  });
});
