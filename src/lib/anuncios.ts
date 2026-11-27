/**
 * 018 — Cómo se nombra el origen en pantalla. Sin dependencias de servidor: lo
 * usan la lista, el panel, el cajón del trato y la fuente del contacto.
 *
 * Meta marca `source_type: "post"` cuando el clic vino de una publicación y no
 * de un anuncio. Llamarlo "anuncio" haría pasar por pagado algo que no lo fue.
 */
export function etiquetaDeOrigen(sourceType: string | null | undefined): string {
  return sourceType === "post" ? "Publicación" : "Anuncio";
}

/**
 * ¿Cuenta como fuente "anuncio"? Una publicación se enseña en la bandeja igual,
 * pero no se suma a los anuncios en la fuente del prospecto.
 */
export function cuentaComoAnuncio(
  anuncio: { sourceType: string | null } | null | undefined
): boolean {
  return !!anuncio && anuncio.sourceType !== "post";
}

/** Titular a enseñar cuando Meta no mandó ninguno. */
export function titularDeOrigen(
  headline: string | null | undefined,
  sourceType: string | null | undefined
): string {
  if (headline) return headline;
  return sourceType === "post" ? "Publicación sin título" : "Anuncio sin título";
}

/**
 * 087 — Origen por pauta. Los chats se agrupan por el titular del anuncio
 * (lo que el equipo reconoce: «Ponte al día», «Factura donde ya causas»);
 * sin titular, por el id del anuncio.
 */
type OrigenAnuncio = { headline: string | null; sourceId: string | null; sourceType: string | null };

export const PAUTA_TODAS = "all";
export const PAUTA_SIN = "sin";
export const PAUTA_CUALQUIERA = "cualquiera";

export function claveDePauta(anuncio: OrigenAnuncio | null | undefined): string | null {
  if (!anuncio) return null;
  const titular = anuncio.headline?.trim();
  if (titular) return `t:${titular.toLowerCase()}`;
  return `id:${anuncio.sourceId ?? anuncio.sourceType ?? "?"}`;
}

const LARGO_CORTO = 24;

/** Nombre corto para la etiqueta: lo que va antes de «:», y si no, recortado. */
export function nombreCortoDePauta(anuncio: OrigenAnuncio): string {
  const titular = titularDeOrigen(anuncio.headline, anuncio.sourceType).trim();
  const antes = titular.split(/\s*[:—–|]\s*/)[0]!.trim();
  const base = antes.length >= 4 ? antes : titular;
  return base.length > LARGO_CORTO ? `${base.slice(0, LARGO_CORTO - 1).trimEnd()}…` : base;
}

export type Pauta = { clave: string; nombre: string; titular: string; n: number };

/** Las pautas presentes, de la que más chats trae a la que menos. */
export function pautasDe(items: readonly { anuncio: OrigenAnuncio | null }[]): { pautas: Pauta[]; sin: number } {
  const porClave = new Map<string, Pauta>();
  let sin = 0;
  for (const it of items) {
    const clave = claveDePauta(it.anuncio);
    if (!clave || !it.anuncio) {
      sin++;
      continue;
    }
    const p = porClave.get(clave);
    if (p) p.n++;
    else
      porClave.set(clave, {
        clave,
        nombre: nombreCortoDePauta(it.anuncio),
        titular: titularDeOrigen(it.anuncio.headline, it.anuncio.sourceType),
        n: 1,
      });
  }
  const pautas = [...porClave.values()].sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, "es"));
  return { pautas, sin };
}

/** ¿El chat pasa el filtro de pauta elegido? */
export function pasaPauta(anuncio: OrigenAnuncio | null | undefined, pauta: string): boolean {
  if (pauta === PAUTA_TODAS) return true;
  if (pauta === PAUTA_SIN) return !anuncio;
  if (pauta === PAUTA_CUALQUIERA) return !!anuncio;
  return claveDePauta(anuncio) === pauta;
}
