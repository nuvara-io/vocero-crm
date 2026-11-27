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

/**
 * 088 — De dónde vino lo que NO llegó por un anuncio. En orden de lo más
 * confiable a lo menos: lo que capturó el equipo, la lista de prospección,
 * la pista del primer mensaje (web o saludo de Meta), y al final si escribió
 * por su cuenta o se creó a mano sin chat.
 */
export type OrigenSinAnuncio =
  | "prospeccion"
  | "web"
  | "meta"
  | "organico"
  | "referido"
  | "conocido"
  | "otro"
  | "directo"
  | "manual";

export const ORIGEN_LABEL: Record<OrigenSinAnuncio, string> = {
  prospeccion: "Prospección",
  web: "Web o redes",
  meta: "Meta, sin anuncio",
  organico: "Contenido orgánico",
  referido: "Referido",
  conocido: "Conocido",
  otro: "Otro origen",
  directo: "Escribió directo",
  manual: "Creado a mano",
};

const ORDEN_ORIGEN: OrigenSinAnuncio[] = [
  "prospeccion",
  "web",
  "meta",
  "organico",
  "referido",
  "conocido",
  "otro",
  "directo",
  "manual",
];

export function origenSinAnuncio(contacto: {
  source: string | null;
  sourceHint: string | null;
  prospectList: string | null;
  /** ¿Tiene conversación? Sin chat y sin nada más, alguien lo creó a mano. */
  tieneChat: boolean;
}): OrigenSinAnuncio {
  const capturada = contacto.source;
  if (capturada === "organico" || capturada === "referido" || capturada === "conocido" || capturada === "otro") {
    return capturada;
  }
  if (contacto.prospectList) return "prospeccion";
  if (contacto.sourceHint === "web" || contacto.sourceHint === "meta") return contacto.sourceHint;
  return contacto.tieneChat ? "directo" : "manual";
}

export const claveDeOrigen = (o: OrigenSinAnuncio) => `o:${o}`;

type ConOrigen = { anuncio: OrigenAnuncio | null; origen?: OrigenSinAnuncio | null };

export type Pauta = { clave: string; nombre: string; titular: string; n: number };

export type OrigenContado = { clave: string; origen: OrigenSinAnuncio; nombre: string; n: number };

/**
 * Las pautas presentes, de la que más chats trae a la que menos, y (088) los
 * orígenes de lo que no vino de un anuncio, en su orden fijo.
 */
export function pautasDe(items: readonly ConOrigen[]): { pautas: Pauta[]; sin: number; origenes: OrigenContado[] } {
  const porClave = new Map<string, Pauta>();
  const porOrigen = new Map<OrigenSinAnuncio, number>();
  let sin = 0;
  for (const it of items) {
    const clave = claveDePauta(it.anuncio);
    if (!clave || !it.anuncio) {
      sin++;
      const o = it.origen ?? "directo";
      porOrigen.set(o, (porOrigen.get(o) ?? 0) + 1);
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
  const origenes = ORDEN_ORIGEN.filter((o) => porOrigen.has(o)).map((o) => ({
    clave: claveDeOrigen(o),
    origen: o,
    nombre: ORIGEN_LABEL[o],
    n: porOrigen.get(o)!,
  }));
  return { pautas, sin, origenes };
}

/** ¿El chat pasa el filtro de pauta u origen elegido? */
export function pasaPauta(item: ConOrigen, pauta: string): boolean {
  const { anuncio } = item;
  if (pauta === PAUTA_TODAS) return true;
  if (pauta === PAUTA_SIN) return !anuncio;
  if (pauta === PAUTA_CUALQUIERA) return !!anuncio;
  if (pauta.startsWith("o:")) return !anuncio && claveDeOrigen(item.origen ?? "directo") === pauta;
  return claveDePauta(anuncio) === pauta;
}

/** Cómo se nombra el filtro puesto. */
export function nombreDelFiltro(pauta: string, pautas: readonly Pauta[]): string {
  if (pauta === PAUTA_SIN) return "Sin anuncio";
  if (pauta === PAUTA_CUALQUIERA) return "De anuncios";
  if (pauta.startsWith("o:")) return `Origen: ${ORIGEN_LABEL[pauta.slice(2) as OrigenSinAnuncio] ?? "…"}`;
  return `Pauta: ${pautas.find((p) => p.clave === pauta)?.nombre ?? "…"}`;
}
