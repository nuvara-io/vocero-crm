import { describe, expect, it } from "vitest";
import { enVista, ordenDeGrupo, VISTAS_BANDEJA, type VistaBandeja } from "@/lib/filtros-bandeja";

const c = (o: Partial<Parameters<typeof enVista>[0]>) => ({
  lastDirection: "out" as "in" | "out" | null,
  stageKind: "open" as "open" | "won" | "lost" | null,
  stageName: "En conversación" as string | null,
  archivedAt: null as string | null,
  ...o,
});
// Las vistas de 075 siguen existiendo para los filtros, aunque 083 dejó como
// pestañas solo «Hoy», «Por etapa», «Clientes» y «Cerrados».
const VISTAS_075: VistaBandeja[] = ["todas", "por_contestar", "esperando", "demo", "clientes", "cerrados"];
const vistas = (x: Parameters<typeof enVista>[0]) => VISTAS_075.filter((v) => enVista(x, v));

describe("075 — vistas de la bandeja", () => {
  it("el cliente habló último: por contestar", () => {
    expect(vistas(c({ lastDirection: "in" }))).toEqual(["todas", "por_contestar"]);
  });
  it("hablamos últimos antes de la demo: esperando", () => {
    expect(vistas(c({}))).toEqual(["todas", "esperando"]);
  });
  it("en demo y con mensaje del cliente: demo y por contestar", () => {
    expect(vistas(c({ stageName: "No asistió", lastDirection: "in" }))).toEqual(["todas", "por_contestar", "demo"]);
    expect(vistas(c({ stageName: "No asistio" }))).toEqual(["todas", "demo"]);
  });
  it("ganado o Registrado: clientes", () => {
    expect(vistas(c({ stageKind: "won", stageName: "Activado" }))).toEqual(["todas", "clientes"]);
    expect(vistas(c({ stageName: "Registrado" }))).toEqual(["todas", "clientes"]);
  });
  it("perdido o archivado: solo cerrados", () => {
    expect(vistas(c({ stageKind: "lost", lastDirection: "in" }))).toEqual(["cerrados"]);
    expect(vistas(c({ archivedAt: "2026-11-01T00:00:00Z", stageName: "Demo agendada" }))).toEqual(["cerrados"]);
  });
  it("orden de grupos", () => {
    expect(["Seguimiento", "Demo agendada", "No asistió", "Demo hecha"].sort((a, b) => ordenDeGrupo(a) - ordenDeGrupo(b))).toEqual([
      "Demo agendada",
      "Demo hecha",
      "No asistió",
      "Seguimiento",
    ]);
  });
  it("083 — las pestañas son Hoy, Por etapa, Clientes y Cerrados", () => {
    expect(VISTAS_BANDEJA.map((v) => v.id).filter((v) => v !== "revisar_perfil")).toEqual([
      "hoy",
      "etapa",
      "clientes",
      "cerrados",
    ]);
  });
});
