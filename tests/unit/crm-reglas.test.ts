import { describe, expect, it } from "vitest";
import {
  decidirSeguimiento,
  deducirOrigenPorSaludo,
  elegirResponsable,
  limpiarTextoParaWhatsApp,
  SEGUIMIENTO_POR_DEFECTO,
} from "@/lib/crm-reglas";

describe("071 — limpiarTextoParaWhatsApp", () => {
  it("quita el LaTeX que le llegó a Carmen", () => {
    expect(limpiarTextoParaWhatsApp("tu costo sería de $255.000 ($500 \\times \\$510$).")).toBe(
      "tu costo sería de $255.000 (500 × $510)."
    );
  });

  it("no toca precios normales", () => {
    const t = "Desde $80.000 al mes: $510 por compra y $200 por venta.";
    expect(limpiarTextoParaWhatsApp(t)).toBe(t);
  });

  it("negrita y encabezados de Markdown a WhatsApp", () => {
    expect(limpiarTextoParaWhatsApp("### Precios\n**Gratis** la demo")).toBe("Precios\n*Gratis* la demo");
  });

  it("delimitadores y escapes", () => {
    expect(limpiarTextoParaWhatsApp("\\(150 \\times 510\\) y 10\\%")).toBe("150 × 510 y 10%");
  });
});

describe("071 — deducirOrigenPorSaludo", () => {
  it("el enlace de la web y de las redes", () => {
    expect(deducirOrigenPorSaludo("Hola, quiero más información sobre Núvara")).toBe("web");
    expect(deducirOrigenPorSaludo("Hola, vengo de sus redes y quiero más información sobre Núvara")).toBe("web");
  });

  it("el saludo automático de Meta, en español y en inglés", () => {
    expect(deducirOrigenPorSaludo("¡Hola! Quiero más información")).toBe("meta");
    expect(deducirOrigenPorSaludo("Hello! Can I get more info on this?")).toBe("meta");
  });

  it("cualquier otra cosa no se adivina", () => {
    expect(deducirOrigenPorSaludo("¿Cuánto cuesta después de la prueba?")).toBeNull();
    expect(deducirOrigenPorSaludo(null)).toBeNull();
  });
});

describe("071 — elegirResponsable", () => {
  const equipo = new Set(["a", "b", "c"]);

  it("rotación: el siguiente del último, y vuelve al principio", () => {
    const regla = { modo: "rotacion" as const, userIds: ["a", "b", "c"] };
    expect(elegirResponsable(regla, equipo, null)).toBe("a");
    expect(elegirResponsable(regla, equipo, "a")).toBe("b");
    expect(elegirResponsable(regla, equipo, "c")).toBe("a");
  });

  it("salta a quien ya no está en el equipo", () => {
    const regla = { modo: "rotacion" as const, userIds: ["a", "x", "b"] };
    expect(elegirResponsable(regla, equipo, "a")).toBe("b");
  });

  it("fijo solo si sigue en el equipo; nadie es nadie", () => {
    expect(elegirResponsable({ modo: "fijo", userId: "b" }, equipo, null)).toBe("b");
    expect(elegirResponsable({ modo: "fijo", userId: "x" }, equipo, null)).toBeNull();
    expect(elegirResponsable({ modo: "nadie" }, equipo, "a")).toBeNull();
  });
});

describe("071 — decidirSeguimiento", () => {
  const ajustes = {
    enabled: true,
    pasos: [
      { dias: 5, templateId: "tpl_b" },
      { dias: 2, templateId: "tpl_a" },
    ],
    archivarDias: 10,
  };
  const nada = new Set<number>();

  it("apagado por defecto: nunca hace nada", () => {
    expect(decidirSeguimiento({ ajustes: SEGUIMIENTO_POR_DEFECTO, dias: 30, hechos: nada })).toBeNull();
  });

  it("antes del primer paso, nada; el día 2, el paso 1", () => {
    expect(decidirSeguimiento({ ajustes, dias: 1, hechos: nada })).toBeNull();
    expect(decidirSeguimiento({ ajustes, dias: 2, hechos: nada })).toEqual({
      accion: "enviar",
      paso: 1,
      templateId: "tpl_a",
    });
  });

  it("no salta pasos: si el 1 no salió, el día 6 manda el 1", () => {
    expect(decidirSeguimiento({ ajustes, dias: 6, hechos: nada })).toMatchObject({ paso: 1 });
    expect(decidirSeguimiento({ ajustes, dias: 6, hechos: new Set([1]) })).toMatchObject({ paso: 2 });
  });

  it("después de todos los pasos, archiva a los 10 días y no repite", () => {
    expect(decidirSeguimiento({ ajustes, dias: 9, hechos: new Set([1, 2]) })).toBeNull();
    expect(decidirSeguimiento({ ajustes, dias: 10, hechos: new Set([1, 2]) })).toEqual({ accion: "archivar" });
    expect(decidirSeguimiento({ ajustes, dias: 20, hechos: new Set([1, 2, 0]) })).toBeNull();
  });
});
