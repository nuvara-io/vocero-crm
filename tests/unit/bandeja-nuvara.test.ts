import { describe, expect, it } from "vitest";
import { diasDesde, pideSeguimiento } from "@/lib/filtros-bandeja";
import { primerNombre } from "@/components/inbox/lote-bar";
import { telefonoComoIdentidad } from "@/server/bot/plataforma";
import { nombreCorto } from "@/lib/equipo";

/** 067 — Seguimiento pendiente, nombres para plantillas y teléfonos de la plataforma. */

const AHORA = new Date("2026-11-14T15:00:00Z");
const base = {
  lastDirection: "out" as const,
  lastMessageAt: "2026-11-11T15:00:00Z", // hace 3 días
  stageKind: "open" as const,
  archivedAt: null,
};

describe("pideSeguimiento", () => {
  it("le escribimos de último y lleva los días pedidos sin contestar", () => {
    expect(pideSeguimiento(base, 3, AHORA)).toBe(true);
    expect(pideSeguimiento(base, 7, AHORA)).toBe(false);
  });

  it("si el último en escribir fue el cliente, no es seguimiento", () => {
    expect(pideSeguimiento({ ...base, lastDirection: "in" }, 1, AHORA)).toBe(false);
  });

  it("ganados, perdidos y archivados no piden seguimiento", () => {
    expect(pideSeguimiento({ ...base, stageKind: "won" }, 1, AHORA)).toBe(false);
    expect(pideSeguimiento({ ...base, stageKind: "lost" }, 1, AHORA)).toBe(false);
    expect(pideSeguimiento({ ...base, archivedAt: "2026-11-12T00:00:00Z" }, 1, AHORA)).toBe(false);
  });

  it("cuenta días completos", () => {
    expect(diasDesde(base.lastMessageAt, AHORA)).toBe(3);
    expect(diasDesde(null, AHORA)).toBeNull();
  });
});

describe("primerNombre", () => {
  it("toma la primera palabra si parece un nombre", () => {
    expect(primerNombre("Juan Carlos Pérez")).toBe("Juan");
    expect(primerNombre("María-José")).toBe("María-José");
  });

  it("descarta emojis, números y alias raros", () => {
    expect(primerNombre("💘🎀")).toBeNull();
    expect(primerNombre("573001234567")).toBeNull();
    expect(primerNombre("🙏&andra @rias")).toBeNull();
    expect(primerNombre("J")).toBeNull();
  });
});

describe("telefonoComoIdentidad", () => {
  it("un celular colombiano de 10 dígitos gana el 57", () => {
    expect(telefonoComoIdentidad("300 123 4567")).toBe("573001234567");
    expect(telefonoComoIdentidad("+57 300-123-4567")).toBe("573001234567");
  });

  it("deja igual lo que ya trae indicativo y rechaza lo muy corto", () => {
    expect(telefonoComoIdentidad("5215512345678")).toBe("5215512345678");
    expect(telefonoComoIdentidad("12345")).toBeNull();
  });
});

describe("nombreCorto", () => {
  it("el primer nombre del responsable", () => {
    expect(nombreCorto("Robinson Buitrago")).toBe("Robinson");
  });
});
