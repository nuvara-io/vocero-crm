import { describe, expect, it } from "vitest";
import { PAUTA_CUALQUIERA, PAUTA_SIN, PAUTA_TODAS, claveDePauta, nombreCortoDePauta, pasaPauta, pautasDe } from "@/lib/anuncios";

const a = (headline: string | null, sourceId = "120", sourceType = "ad") => ({ headline, sourceId, sourceType });

describe("087 — origen por pauta", () => {
  it("nombre corto: lo de antes de los dos puntos, o recortado", () => {
    expect(nombreCortoDePauta(a("Ponte al día: hasta 20 % en tu primera recarga"))).toBe("Ponte al día");
    expect(nombreCortoDePauta(a("Para contadores: causa sin digitar"))).toBe("Para contadores");
    expect(nombreCortoDePauta(a("Factura donde ya causas"))).toBe("Factura donde ya causas");
    expect(nombreCortoDePauta(a("¿Y el acuse de tus compras a crédito?"))).toBe("¿Y el acuse de tus comp…");
    expect(nombreCortoDePauta(a(null))).toBe("Anuncio sin título");
    expect(nombreCortoDePauta(a(null, "9", "post"))).toBe("Publicación sin título");
  });

  it("agrupa por titular y cuenta, de la que más trae a la que menos", () => {
    const { pautas, sin } = pautasDe([
      { anuncio: a("Factura donde ya causas", "1") },
      { anuncio: a("Ponte al día: hasta 20 %", "2") },
      { anuncio: a("Ponte al día: hasta 20 %", "3") },
      { anuncio: null },
    ]);
    expect(pautas.map((p) => [p.nombre, p.n])).toEqual([
      ["Ponte al día", 2],
      ["Factura donde ya causas", 1],
    ]);
    expect(sin).toBe(1);
  });

  it("el filtro deja pasar lo que toca", () => {
    const ponte = a("Ponte al día: hasta 20 %");
    const clave = claveDePauta(ponte)!;
    expect(pasaPauta(ponte, PAUTA_TODAS)).toBe(true);
    expect(pasaPauta(null, PAUTA_TODAS)).toBe(true);
    expect(pasaPauta(ponte, clave)).toBe(true);
    expect(pasaPauta(a("Factura donde ya causas"), clave)).toBe(false);
    expect(pasaPauta(null, PAUTA_SIN)).toBe(true);
    expect(pasaPauta(ponte, PAUTA_SIN)).toBe(false);
    expect(pasaPauta(ponte, PAUTA_CUALQUIERA)).toBe(true);
    expect(pasaPauta(null, PAUTA_CUALQUIERA)).toBe(false);
  });
});
