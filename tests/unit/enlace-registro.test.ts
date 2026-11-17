import { describe, expect, it } from "vitest";
import { enlaceRegistro, normalizarRegistro } from "@/lib/enlace-registro";
import { normalizar } from "@/server/crm-ajustes";

/** 080 — Enlace de registro personal por lead. */

describe("enlaceRegistro", () => {
  const aj = { url: "https://app.nuvara.com.co/signup", codigo: "NUVARA20" };
  it("lleva el código de campaña y el id del lead", () => {
    expect(enlaceRegistro(aj, "ld_abc123")).toBe("https://app.nuvara.com.co/signup?code=NUVARA20&c=ld_abc123");
  });
  it("sin código, solo el lead", () => {
    expect(enlaceRegistro({ ...aj, codigo: null }, "ld_x")).toBe("https://app.nuvara.com.co/signup?c=ld_x");
  });
  it("conserva parámetros que ya traía la página", () => {
    expect(enlaceRegistro({ url: "https://app.nuvara.com.co/signup?utm_source=wa", codigo: null }, "ld_x")).toBe(
      "https://app.nuvara.com.co/signup?utm_source=wa&c=ld_x"
    );
  });
  it("sin página configurada o sin lead, no hay enlace", () => {
    expect(enlaceRegistro({ url: null, codigo: "X" }, "ld_x")).toBeNull();
    expect(enlaceRegistro(aj, null)).toBeNull();
  });
});

describe("normalizarRegistro", () => {
  it("descarta una página que no es http(s) y pone el código en mayúsculas", () => {
    expect(normalizarRegistro({ url: "javascript:alert(1)", codigo: " nuvara20 " })).toEqual({
      url: null,
      codigo: "NUVARA20",
    });
  });
  it("por defecto apagado", () => {
    expect(normalizar({}).registro).toEqual({ url: null, codigo: null });
  });
});
