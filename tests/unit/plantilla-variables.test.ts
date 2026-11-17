import { describe, expect, it } from "vitest";
import { nombreLegible, sugerirVariables, tipoDeVariable, trozosDeVistaPrevia } from "@/lib/plantilla-variables";

const datos = {
  nombre: "Yuli",
  asesor: "Robinson",
  negocio: "núvara",
  cita: { fecha: "lunes 16 de noviembre", hora: "9:10 a. m.", enlace: "https://meet.google.com/qcm-nihf-rwm" },
};

describe("074 — variables de plantilla", () => {
  it("recordatorio de demostración: nombre, día, hora y enlace", () => {
    const body =
      "Hola {{1}}, te recordamos tu demostración en vivo de núvara el {{2}} a las {{3}}. Entra por este enlace: {{4}} . Si necesitas cambiar la hora, responde a este mensaje.";
    expect(sugerirVariables(body, 4, datos).map((v) => v.valor)).toEqual([
      "Yuli",
      "lunes 16 de noviembre",
      "9:10 a. m", // 077: la plantilla ya pone el punto
      "https://meet.google.com/qcm-nihf-rwm",
    ]);
  });

  it("primer contacto: nombre y asesor", () => {
    const body = "Hola {{1}}, soy {{2}} de núvara. Gracias por dejarme escribirte.";
    expect(sugerirVariables(body, 2, datos).map((v) => v.tipo)).toEqual(["nombre", "asesor"]);
  });

  it("nombre al principio seguido de coma", () => {
    expect(tipoDeVariable("{{1}}, ¿te queda bien que reagendemos?", 1)).toBe("nombre");
  });

  it("confirmación: «el {{2}} a las {{3}}»", () => {
    const body = "Hola {{1}}, quedó agendada tu demostración en vivo de núvara el {{2}} a las {{3}} por Google Meet.";
    expect(sugerirVariables(body, 3, datos).map((v) => v.tipo)).toEqual(["nombre", "fecha", "hora"]);
  });

  it("sin cita los campos de la cita quedan vacíos y lo demás se llena", () => {
    const body = "Hola {{1}}, tu demostración es el {{2}} a las {{3}}.";
    expect(sugerirVariables(body, 3, { ...datos, cita: null }).map((v) => v.valor)).toEqual(["Yuli", "", ""]);
  });

  it("vista previa marca los huecos", () => {
    const t = trozosDeVistaPrevia("Hola {{1}}, el {{2}}.", ["Yuli", ""]);
    expect(t).toEqual([
      { texto: "Hola " },
      { texto: "Yuli", variable: 1, vacio: false },
      { texto: ", el " },
      { texto: "{{2}}", variable: 2, vacio: true },
      { texto: "." },
    ]);
  });

  it("nombre legible", () => {
    expect(nombreLegible("recordatorio_demostracion")).toBe("Recordatorio demostracion");
  });
});
