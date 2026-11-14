/**
 * 067 — Festivos nacionales, como fechas de pared `YYYY-MM-DD`.
 *
 * PURO: sin BD ni reloj. Hoy solo Colombia (Ley 51 de 1983, «Ley Emiliani»):
 * - fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic;
 * - trasladables al lunes siguiente: 6 ene, 19 mar, 29 jun, 15 ago, 12 oct,
 *   1 nov, 11 nov;
 * - según la Pascua: Jueves y Viernes Santo (fijos), y Ascensión, Corpus
 *   Christi y Sagrado Corazón (trasladados al lunes).
 */

export type PaisFestivos = "CO";

export const PAISES_FESTIVOS: Record<PaisFestivos, string> = {
  CO: "Colombia",
};

/** Domingo de Pascua (algoritmo anónimo gregoriano), en UTC a medianoche. */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function masDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * 86_400_000);
}

/** El mismo día si es lunes; si no, el lunes siguiente. */
function alLunes(d: Date): Date {
  const dow = d.getUTCDay(); // 0 domingo … 6 sábado
  const faltan = (8 - dow) % 7;
  return masDias(d, faltan);
}

function festivosColombia(anio: number): string[] {
  const fecha = (mes: number, dia: number) => new Date(Date.UTC(anio, mes - 1, dia));
  const pascua = domingoDePascua(anio);
  const dias: Date[] = [
    fecha(1, 1),
    fecha(5, 1),
    fecha(7, 20),
    fecha(8, 7),
    fecha(12, 8),
    fecha(12, 25),
    alLunes(fecha(1, 6)),
    alLunes(fecha(3, 19)),
    alLunes(fecha(6, 29)),
    alLunes(fecha(8, 15)),
    alLunes(fecha(10, 12)),
    alLunes(fecha(11, 1)),
    alLunes(fecha(11, 11)),
    masDias(pascua, -3), // Jueves Santo
    masDias(pascua, -2), // Viernes Santo
    alLunes(masDias(pascua, 39)), // Ascensión
    alLunes(masDias(pascua, 60)), // Corpus Christi
    alLunes(masDias(pascua, 68)), // Sagrado Corazón
  ];
  return [...new Set(dias.map(iso))].sort();
}

/** Festivos del país en un año, ordenados y sin repetidos. */
export function festivosDe(pais: PaisFestivos, anio: number): string[] {
  switch (pais) {
    case "CO":
      return festivosColombia(anio);
  }
}

/**
 * Todos los días cerrados entre dos fechas de pared (inclusive): los festivos
 * del país y las fechas cerradas a mano.
 */
export function diasCerrados(
  desdeISO: string,
  hastaISO: string,
  opts: { pais: PaisFestivos | null; cerradas: readonly string[] }
): Set<string> {
  const cerrados = new Set<string>(opts.cerradas);
  if (opts.pais) {
    const desde = Number(desdeISO.slice(0, 4));
    const hasta = Number(hastaISO.slice(0, 4));
    for (let anio = desde; anio <= hasta; anio++) {
      for (const f of festivosDe(opts.pais, anio)) cerrados.add(f);
    }
  }
  return cerrados;
}
