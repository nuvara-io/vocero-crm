import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cambiosDeSeguimiento, estaVencido, seguimientoSchema } from "@/lib/seguimiento-demo";

const ahora = new Date("2026-11-25T17:00:00Z");
const vacio = { nextStep: null, nextStepOn: null, nextStepDoneAt: null };
const hecho = { nextStep: "oferta" as const, nextStepOn: "2026-11-26", nextStepDoneAt: ahora };

describe("082 — qué sigue después de la demo", () => {
  it("pide una nota o un paso, y valida la fecha", () => {
    expect(seguimientoSchema.safeParse({}).success).toBe(false);
    expect(seguimientoSchema.safeParse({ texto: "   " }).success).toBe(false);
    expect(seguimientoSchema.safeParse({ texto: "Le gustó" }).success).toBe(true);
    expect(seguimientoSchema.safeParse({ paso: "oferta", fecha: "2026-13-40" }).success).toBe(false);
    expect(seguimientoSchema.safeParse({ paso: null }).success).toBe(true);
  });

  it("guarda el paso con su fecha y lo marca hecho", () => {
    const r = cambiosDeSeguimiento(vacio, { paso: "oferta", fecha: "2026-11-26" }, ahora);
    expect(r).toEqual({ nextStep: "oferta", nextStepOn: "2026-11-26", nextStepDoneAt: null });
    expect(cambiosDeSeguimiento(r, { hecho: true }, ahora).nextStepDoneAt).toBe(ahora);
  });

  it("cambiar el paso o la fecha lo reabre; guardar lo mismo no", () => {
    expect(cambiosDeSeguimiento(hecho, { paso: "reagendar" }, ahora).nextStepDoneAt).toBeNull();
    expect(cambiosDeSeguimiento(hecho, { paso: "oferta", fecha: "2026-11-30" }, ahora).nextStepDoneAt).toBeNull();
    expect(cambiosDeSeguimiento(hecho, { paso: "oferta", fecha: "2026-11-26" }, ahora)).toEqual(hecho);
  });

  it("«No le interesa» o quitar el paso no dejan fecha pendiente", () => {
    expect(cambiosDeSeguimiento(hecho, { paso: "no_sigue" }, ahora)).toEqual({ ...vacio, nextStep: "no_sigue" });
    expect(cambiosDeSeguimiento(hecho, { paso: null }, ahora)).toEqual(vacio);
  });

  it("vence al día siguiente, no el mismo día", () => {
    expect(estaVencido("2026-11-24", "2026-11-25")).toBe(true);
    expect(estaVencido("2026-11-25", "2026-11-25")).toBe(false);
    expect(estaVencido(null, "2026-11-25")).toBe(false);
  });

  it("guardarlo no toca updated_at: reabriría el mensaje de «no asistió»", () => {
    const codigo = readFileSync(join(process.cwd(), "src/server/agenda/seguimiento.ts"), "utf8");
    expect(codigo).not.toMatch(/updatedAt:/);
  });
});
