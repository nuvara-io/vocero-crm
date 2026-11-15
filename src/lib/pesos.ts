/** 068 — Pesos sin centavos, como se habla de plata en Colombia: «$80.000». */
export function pesos(cents: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

/** «Noviembre de 2026». */
export function mesLegible(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const texto = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 15))
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Pesos escritos («80.000», «$ 1.200.000») → centavos; null si no es un número. */
export function centavosDesdePesos(texto: string): number | null {
  const limpio = texto.replace(/[^\d]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isSafeInteger(n * 100) ? n * 100 : null;
}
