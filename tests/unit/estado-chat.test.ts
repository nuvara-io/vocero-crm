import { describe, expect, it } from "vitest";
import { esEtapaActivado, estadoDeChat } from "@/lib/filtros-bandeja";

const ahora = new Date("2026-11-17T12:00:00Z");
const hace = (dias: number) => new Date(ahora.getTime() - dias * 86_400_000).toISOString();
const base = {
  lastDirection: "out" as "in" | "out" | null,
  lastMessageAt: hace(0.5),
  stageKind: "open" as "open" | "won" | "lost" | null,
  stageName: "Calificado" as string | null,
  archivedAt: null as string | null,
};

describe("076 — estado del chat por colores", () => {
  it("activado gana sobre que haya escrito el cliente", () => {
    expect(estadoDeChat({ ...base, stageKind: "won", stageName: "Activado", lastDirection: "in" }, ahora)).toBe("activo");
  });
  it("registrado es ganado pero no activo", () => {
    expect(estadoDeChat({ ...base, stageKind: "won", stageName: "Registrado" }, ahora)).toBe("registrado");
  });
  it("cerrado si perdió o se archivó", () => {
    expect(estadoDeChat({ ...base, stageKind: "lost", stageName: "Perdido" }, ahora)).toBe("cerrado");
    expect(estadoDeChat({ ...base, archivedAt: hace(1) }, ahora)).toBe("cerrado");
  });
  it("por contestar si el cliente habló último", () => {
    expect(estadoDeChat({ ...base, lastDirection: "in" }, ahora)).toBe("por_contestar");
  });
  it("recontactar tras 2 días sin respuesta o si no asistió", () => {
    expect(estadoDeChat({ ...base, lastMessageAt: hace(3) }, ahora)).toBe("recontactar");
    expect(estadoDeChat({ ...base, stageName: "No asistió" }, ahora)).toBe("recontactar");
  });
  it("en demo y esperando", () => {
    expect(estadoDeChat({ ...base, stageName: "Demo agendada" }, ahora)).toBe("en_demo");
    expect(estadoDeChat(base, ahora)).toBe("esperando");
  });
  it("reconoce la etapa Activado sin tildes ni mayúsculas", () => {
    expect(esEtapaActivado("ACTIVADO")).toBe(true);
    expect(esEtapaActivado("Registrado")).toBe(false);
  });
});
