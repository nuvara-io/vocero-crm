import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));

import { normalizar } from "@/server/crm-ajustes";

describe("073 — ajustes de demos", () => {
  it("por defecto: sin valor de demo y recuperación apagada", () => {
    const a = normalizar(undefined);
    expect(a.valorDemoCents).toBeNull();
    expect(a.noAsistio).toEqual({ enabled: false, minutos: 10, plantilla1: null, dias2: 1, plantilla2: null });
  });

  it("no se enciende sin la plantilla del primer mensaje", () => {
    expect(normalizar({ noAsistio: { enabled: true, minutos: 10 } }).noAsistio.enabled).toBe(false);
    expect(normalizar({ noAsistio: { enabled: true, plantilla1: "tpl_1" } }).noAsistio.enabled).toBe(true);
  });

  it("acota minutos y días", () => {
    const n = normalizar({ noAsistio: { enabled: true, plantilla1: "t", minutos: 9999, dias2: 0 } }).noAsistio;
    expect(n.minutos).toBeLessThanOrEqual(240);
    expect(n.dias2).toBeGreaterThanOrEqual(1);
  });

  it("valor de demo inválido queda sin valor", () => {
    expect(normalizar({ valorDemoCents: -5 }).valorDemoCents).toBeNull();
    expect(normalizar({ valorDemoCents: 8_000_000 }).valorDemoCents).toBe(8_000_000);
  });
});
