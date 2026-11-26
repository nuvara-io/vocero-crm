import { describe, expect, it } from "vitest";
import { horaValida, moverSchema, nombreParaPlantilla, omitirSchema, primeraHoraHabil, programarSchema } from "@/lib/envios";
import { horarioHabil } from "@/server/seguimiento/runner";

describe("085 — envíos programados", () => {
  it("el nombre para la plantilla nunca queda vacío (👍🏻 no se quedó sin recordatorio)", () => {
    expect(nombreParaPlantilla("Yuly Granados")).toBe("Yuly");
    expect(nombreParaPlantilla("👍🏻")).toBe("👍🏻");
    expect(nombreParaPlantilla("   ")).toBe("hola");
    expect(nombreParaPlantilla(null)).toBe("hola");
  });

  it("valida lo que llega", () => {
    expect(programarSchema.safeParse({ conversationId: "cv", templateId: "tpl", sendAt: "2026-11-27T14:00:00.000Z" }).success).toBe(true);
    expect(programarSchema.safeParse({ conversationId: "cv", templateId: "tpl", sendAt: "mañana" }).success).toBe(false);
    expect(moverSchema.safeParse({ action: "mover" }).success).toBe(false);
    expect(omitirSchema.safeParse({ conversationId: "cv", paso: 0, ancla: "2026-11-20T00:00:00Z", templateId: null }).success).toBe(true);
  });

  it("no se programa en el pasado (con un minuto de gracia)", () => {
    const ahora = new Date("2026-11-26T15:00:00Z");
    expect(horaValida(new Date("2026-11-26T14:59:30Z"), ahora)).toBe(true);
    expect(horaValida(new Date("2026-11-26T14:00:00Z"), ahora)).toBe(false);
  });

  it("lo automático que vence de noche sale a las 8:00 del siguiente día hábil", () => {
    const tz = "America/Bogota";
    const ahora = new Date("2026-11-26T15:00:00Z"); // jueves 10:00 en Bogotá
    // Vence el sábado 28 a las 22:00 de Bogotá → el lunes 30 es hábil, pero el domingo no.
    const vence = new Date("2026-11-29T03:00:00Z");
    const sale = primeraHoraHabil(vence, ahora, (d) => horarioHabil(d, tz));
    expect(sale.toISOString()).toBe("2026-11-30T13:00:00.000Z");
    // Lo que ya venció sale ahora mismo si es horario hábil.
    expect(primeraHoraHabil(new Date("2026-11-20T00:00:00Z"), ahora, (d) => horarioHabil(d, tz))).toEqual(ahora);
  });
});
