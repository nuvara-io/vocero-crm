import { describe, expect, it } from "vitest";
import { PAUTA_CUALQUIERA, PAUTA_SIN, PAUTA_TODAS, claveDePauta, nombreCortoDePauta, nombreDelFiltro, origenSinAnuncio, pasaPauta, pautasDe } from "@/lib/anuncios";

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
    expect(pasaPauta({ anuncio: ponte }, PAUTA_TODAS)).toBe(true);
    expect(pasaPauta({ anuncio: null }, PAUTA_TODAS)).toBe(true);
    expect(pasaPauta({ anuncio: ponte }, clave)).toBe(true);
    expect(pasaPauta({ anuncio: a("Factura donde ya causas") }, clave)).toBe(false);
    expect(pasaPauta({ anuncio: null }, PAUTA_SIN)).toBe(true);
    expect(pasaPauta({ anuncio: ponte }, PAUTA_SIN)).toBe(false);
    expect(pasaPauta({ anuncio: ponte }, PAUTA_CUALQUIERA)).toBe(true);
    expect(pasaPauta({ anuncio: null }, PAUTA_CUALQUIERA)).toBe(false);
  });
});

describe("088 — origen de lo que no vino por anuncio", () => {
  const sinNada = { source: null, sourceHint: null, prospectList: null, tieneChat: true };
  it("lo capturado manda, luego prospección, la pista y al final directo o a mano", () => {
    expect(origenSinAnuncio({ ...sinNada, source: "referido", prospectList: "firmas" })).toBe("referido");
    expect(origenSinAnuncio({ ...sinNada, prospectList: "firmas-2026-11-15", sourceHint: "web" })).toBe("prospeccion");
    expect(origenSinAnuncio({ ...sinNada, sourceHint: "web" })).toBe("web");
    expect(origenSinAnuncio({ ...sinNada, sourceHint: "meta" })).toBe("meta");
    expect(origenSinAnuncio(sinNada)).toBe("directo");
    expect(origenSinAnuncio({ ...sinNada, tieneChat: false })).toBe("manual");
    // «anuncio» capturado a mano sin datos de Meta no inventa una pauta.
    expect(origenSinAnuncio({ ...sinNada, source: "anuncio" })).toBe("directo");
  });

  it("cuenta y filtra los orígenes", () => {
    const items = [
      { anuncio: a("Ponte al día: x"), origen: null },
      { anuncio: null, origen: "prospeccion" as const },
      { anuncio: null, origen: "prospeccion" as const },
      { anuncio: null, origen: "directo" as const },
    ];
    const { origenes, sin } = pautasDe(items);
    expect(sin).toBe(3);
    expect(origenes.map((o) => [o.nombre, o.n])).toEqual([
      ["Prospección", 2],
      ["Escribió directo", 1],
    ]);
    expect(items.filter((i) => pasaPauta(i, "o:prospeccion"))).toHaveLength(2);
    expect(items.filter((i) => pasaPauta(i, PAUTA_SIN))).toHaveLength(3);
    expect(nombreDelFiltro("o:prospeccion", [])).toBe("Origen: Prospección");
  });
});
