/**
 * 068 — Las reglas de comisión, puras (sin base de datos ni React), para que
 * una prueba unitaria las afirme todas. Las acordadas el 2026-11-14:
 *
 * - Venta = el PRIMER pago confirmado de un cliente en la plataforma.
 * - Base mensual: si las ventas del mes suman la base o más, se cobra el %
 *   sobre TODO lo del mes; si no llega, $0.
 * - Quien no comisiona (socios) suma en ventas, pero su comisión es $0.
 * - El % y la base son los del perfil vigente el último día del mes.
 *
 * Todo el dinero va en CENTAVOS ENTEROS.
 */

export type PerfilComision = {
  userId: string;
  comisiona: boolean;
  /** 500 = 5 %. */
  rateBps: number;
  monthlyBaseCents: number;
  referralCode: string | null;
  /** AAAA-MM-DD. */
  validFrom: string;
  createdAt: Date;
};

export type FuenteAtribucion = "codigo" | "responsable" | "manual";

const PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/;
const CODIGO = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;

export function esPeriodo(valor: string): boolean {
  return PERIODO.test(valor);
}

/** Mayúsculas y sin espacios; null si no es un código válido. */
export function normalizarCodigo(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return CODIGO.test(limpio) ? limpio : null;
}

/** AAAA-MM del instante en la zona del negocio. */
export function periodoDe(instante: Date, tz: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instante);
  const y = partes.find((p) => p.type === "year")?.value ?? "1970";
  const m = partes.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

/** AAAA-MM-DD del instante en la zona del negocio. */
export function diaDe(instante: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** Último día (AAAA-MM-DD) de un periodo AAAA-MM. */
export function ultimoDiaDe(periodo: string): string {
  const m = PERIODO.exec(periodo);
  if (!m) throw new Error(`Periodo inválido: ${periodo}`);
  const y = Number(m[1]);
  const mes = Number(m[2]);
  const dias = new Date(Date.UTC(y, mes, 0)).getUTCDate();
  return `${periodo}-${String(dias).padStart(2, "0")}`;
}

/** El periodo siguiente: 2026-12 → 2027-01. */
export function periodoSiguiente(periodo: string): string {
  const m = PERIODO.exec(periodo);
  if (!m) throw new Error(`Periodo inválido: ${periodo}`);
  const y = Number(m[1]);
  const mes = Number(m[2]);
  return mes === 12 ? `${y + 1}-01` : `${y}-${String(mes + 1).padStart(2, "0")}`;
}

/**
 * La versión del perfil que rige un día: la de `validFrom` más reciente que no
 * lo pase; si dos empiezan el mismo día, la última guardada.
 */
export function perfilVigente<P extends Pick<PerfilComision, "validFrom" | "createdAt">>(
  versiones: readonly P[],
  dia: string
): P | null {
  let mejor: P | null = null;
  for (const v of versiones) {
    if (v.validFrom > dia) continue;
    if (
      !mejor ||
      v.validFrom > mejor.validFrom ||
      (v.validFrom === mejor.validFrom && v.createdAt > mejor.createdAt)
    ) {
      mejor = v;
    }
  }
  return mejor;
}

/** Comisión de un monto con un porcentaje en puntos básicos, redondeada. */
export function comisionDe(montoCents: number, rateBps: number): number {
  return Math.round((montoCents * rateBps) / 10_000);
}

export type Liquidacion = {
  salesCount: number;
  salesTotalCents: number;
  baseCents: number;
  rateBps: number;
  comisiona: boolean;
  reached: boolean;
  /** Lo que le falta para la base (0 si ya llegó). */
  faltaCents: number;
  /** Comisión del mes antes de descuentos. */
  brutaCents: number;
  /** Descuentos por pagos anulados de meses ya aprobados (≤ 0). */
  adjustmentCents: number;
  /** Bruta + descuentos: lo que se le paga (puede quedar negativo). */
  commissionCents: number;
};

/**
 * La liquidación de una persona en un mes. Sin perfil o sin comisionar, la
 * comisión es $0 pero las ventas se cuentan igual.
 */
export function liquidar(input: {
  ventasCents: readonly number[];
  perfil: Pick<PerfilComision, "comisiona" | "rateBps" | "monthlyBaseCents"> | null;
  ajustesCents?: readonly number[];
}): Liquidacion {
  const salesTotalCents = input.ventasCents.reduce((a, v) => a + v, 0);
  const comisiona = input.perfil?.comisiona === true;
  const rateBps = comisiona ? input.perfil!.rateBps : 0;
  const baseCents = comisiona ? input.perfil!.monthlyBaseCents : 0;
  const reached = comisiona && input.ventasCents.length > 0 && salesTotalCents >= baseCents;
  const brutaCents = reached ? comisionDe(salesTotalCents, rateBps) : 0;
  const adjustmentCents = (input.ajustesCents ?? []).reduce((a, v) => a + v, 0);
  return {
    salesCount: input.ventasCents.length,
    salesTotalCents,
    baseCents,
    rateBps,
    comisiona,
    reached,
    faltaCents: comisiona ? Math.max(0, baseCents - salesTotalCents) : 0,
    brutaCents,
    adjustmentCents,
    commissionCents: brutaCents + adjustmentCents,
  };
}

/**
 * A quién se le atribuye una venta nueva. En orden: el dueño del código que
 * el cliente escribió al activar; si no, el responsable del lead; si no, nadie
 * (queda en «Sin atribuir» para que un admin la asigne a mano).
 */
export function atribuir(input: {
  codigo: string | null | undefined;
  /** Código normalizado → userId, con los perfiles vigentes hoy. */
  duenosDeCodigo: ReadonlyMap<string, string>;
  responsableUserId: string | null | undefined;
}): { userId: string | null; fuente: FuenteAtribucion | null } {
  const codigo = normalizarCodigo(input.codigo);
  const porCodigo = codigo ? input.duenosDeCodigo.get(codigo) : undefined;
  if (porCodigo) return { userId: porCodigo, fuente: "codigo" };
  if (input.responsableUserId) return { userId: input.responsableUserId, fuente: "responsable" };
  return { userId: null, fuente: null };
}

/** «5 %», «4,5 %». */
export function porcentajeLegible(rateBps: number): string {
  const valor = rateBps / 100;
  return `${valor.toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`;
}

/** Puntos básicos desde un texto «5», «4,5», «4.5» (null si no es válido). */
export function bpsDesdeTexto(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}
