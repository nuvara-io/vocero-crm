import { describe, expect, it } from "vitest";
import { accionDePerfil, pistaFueraDePerfil } from "@/lib/perfil";
import { enVista } from "@/lib/filtros-bandeja";
import { normalizar } from "@/server/crm-ajustes";

/** 078 — Filtro de leads fuera de perfil. */

describe("pistaFueraDePerfil", () => {
  it.each([
    ["Hola necesito un préstamo urgente", "prestamo"],
    ["me pueden prestar 2 millones?", "prestamo"],
    ["Buenas, quiero un credito de libre inversion", "prestamo"],
    ["estoy reportado en datacrédito, igual me prestan?", "prestamo"],
    ["Necesito plata para pagar el arriendo", "prestamo"],
    ["Hola, ¿tienen vacantes? quiero enviar mi hoja de vida", "empleo"],
    ["busco trabajo como auxiliar contable", "empleo"],
  ])("«%s» → %s", (texto, motivo) => {
    expect(pistaFueraDePerfil(texto)).toBe(motivo);
  });

  it.each([
    "Hola, ¿cuántos créditos gasto por factura?",
    "Quiero información de la causación",
    "Soy contador, llevo 12 empresas y uso Siigo",
    "¿Cuánto cuesta la recarga mínima?",
    "Hola",
    "",
  ])("«%s» no tiene pista (no gasta IA)", (texto) => {
    expect(pistaFueraDePerfil(texto)).toBeNull();
  });
});

describe("accionDePerfil", () => {
  const fuera = { fueraDePerfil: true, motivo: "prestamo" as const, confianza: 0.95 };
  it("apagado no hace nada", () => expect(accionDePerfil("apagado", fuera)).toBe("nada"));
  it("marcar solo marca", () => expect(accionDePerfil("marcar", fuera)).toBe("marcar"));
  it("automático descarta si está muy seguro", () => expect(accionDePerfil("automatico", fuera)).toBe("descartar"));
  it("automático con dudas solo marca", () =>
    expect(accionDePerfil("automatico", { ...fuera, confianza: 0.6 })).toBe("marcar"));
  it("si la IA dice que sí es perfil, nada", () =>
    expect(accionDePerfil("automatico", { fueraDePerfil: false, motivo: null, confianza: 0.9 })).toBe("nada"));
});

describe("vista «¿Fuera de perfil?»", () => {
  const base = { lastDirection: "in" as const, stageKind: "open" as const, stageName: "Nuevo", archivedAt: null };
  it("muestra las sospechas abiertas", () => {
    expect(enVista({ ...base, perfil: { estado: "sospecha", motivo: "prestamo" } }, "revisar_perfil")).toBe(true);
  });
  it("no muestra las ya decididas ni las archivadas", () => {
    expect(enVista({ ...base, perfil: { estado: "ok", motivo: null } }, "revisar_perfil")).toBe(false);
    expect(
      enVista({ ...base, archivedAt: "2026-11-17", perfil: { estado: "sospecha", motivo: null } }, "revisar_perfil")
    ).toBe(false);
  });
});

describe("ajustes del filtro", () => {
  it("por defecto apagado y tolera basura", () => {
    expect(normalizar({}).filtroPerfil.modo).toBe("apagado");
    expect(normalizar({ filtroPerfil: { modo: "raro" } }).filtroPerfil.modo).toBe("apagado");
    expect(normalizar({ filtroPerfil: { modo: "marcar" } }).filtroPerfil.modo).toBe("marcar");
  });
});
