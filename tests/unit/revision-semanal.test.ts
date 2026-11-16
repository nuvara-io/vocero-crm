import { describe, expect, it } from "vitest";
import { caminoPrincipal, diagnostico, mayorCaida, pasosDelEmbudo } from "@/lib/revision-semanal";

const etapas = [
  { nombre: "Prospecto", entradas: 70 },
  { nombre: "Nuevo", entradas: 40 },
  { nombre: "En conversación", entradas: 30 },
  { nombre: "Calificado", entradas: 20 },
  { nombre: "Demo agendada", entradas: 6 },
  { nombre: "Demo hecha", entradas: 4 },
  { nombre: "No asistió", entradas: 2 },
  { nombre: "Seguimiento", entradas: 2 },
  { nombre: "Registrado", entradas: 3 },
  { nombre: "Activado", entradas: 2 },
];

describe("073 — revisión semanal", () => {
  it("el camino principal deja fuera prospección y la recuperación", () => {
    expect(caminoPrincipal(etapas).map((e) => e.nombre)).toEqual([
      "Nuevo",
      "En conversación",
      "Calificado",
      "Demo agendada",
      "Demo hecha",
      "Registrado",
      "Activado",
    ]);
  });

  it("la mayor caída es de Calificado a Demo agendada (30 %)", () => {
    const pasos = pasosDelEmbudo(etapas);
    const peor = mayorCaida(pasos)!;
    expect(peor.desde).toBe("Calificado");
    expect(peor.hasta).toBe("Demo agendada");
    expect(peor.tasa).toBeCloseTo(0.3);
    expect(diagnostico(peor.hasta)).toMatch(/día y hora/);
  });

  it("con muy pocas entradas no se juzga", () => {
    const pasos = pasosDelEmbudo([
      { nombre: "Nuevo", entradas: 2 },
      { nombre: "En conversación", entradas: 0 },
    ]);
    expect(mayorCaida(pasos)).toBeNull();
  });

  it("diagnósticos por etapa", () => {
    expect(diagnostico("En conversación")).toMatch(/responde rápido/);
    expect(diagnostico("Demo hecha")).toMatch(/recordatorios/);
    expect(diagnostico("Activado")).toMatch(/oferta/);
  });
});
