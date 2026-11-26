import { esCerrado, esCliente, esDemo, pideSeguimiento } from "@/lib/filtros-bandeja";
import { PASO_LABEL, estaVencido, type PasoDemo } from "@/lib/seguimiento-demo";

/**
 * 083 — La vista «Hoy» de la bandeja: cada chat en el grupo de lo que toca
 * hacer con él. Pura, para probarla sin navegador. El primer grupo que aplica
 * gana; lo que no toca hoy (clientes al día, cerrados) no sale.
 */

export type GrupoHoy = "contestar" | "demos" | "seguimiento" | "esperando" | "dormidos";

export const GRUPOS_HOY: { id: GrupoHoy; label: string; plegado?: boolean }[] = [
  { id: "contestar", label: "Contestar ahora" },
  { id: "demos", label: "Demos hoy y mañana" },
  { id: "seguimiento", label: "Seguimiento" },
  { id: "esperando", label: "Esperando al cliente" },
  { id: "dormidos", label: "Dormidos", plegado: true },
];

/** Le escribimos hace estos días o más sin respuesta: toca volver a escribirle. */
export const DIAS_SEGUIMIENTO_HOY = 2;
/** Sin movimiento estos días o más, antes de la demo: se duerme. */
export const DIAS_DORMIDO = 7;

export type AgendaDeChat = {
  /** La próxima demo agendada. `dia` es el día del negocio (AAAA-MM-DD). */
  proxima: { startUtc: string; dia: string; hora: string } | null;
  /** Lo que quedó por hacer tras una demo (082). */
  porHacer: { paso: PasoDemo; fecha: string | null } | null;
};

export type ParaHoy = {
  lastDirection: "in" | "out" | null;
  lastMessageAt: string | null;
  stageKind: "open" | "won" | "lost" | null;
  stageName: string | null;
  archivedAt: string | null;
  agenda?: AgendaDeChat | null;
};

const sinTildes = (s: string | null) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const DIA_MS = 86_400_000;

export function grupoHoy(c: ParaHoy, hoy: string, manana: string, ahora: Date): GrupoHoy | null {
  if (esCerrado(c)) return null;
  if (c.lastDirection === "in") return "contestar";
  const proxima = c.agenda?.proxima ?? null;
  if (proxima && (proxima.dia === hoy || proxima.dia === manana)) return "demos";
  const porHacer = c.agenda?.porHacer ?? null;
  if (porHacer && (porHacer.fecha === null || porHacer.fecha <= hoy)) return "seguimiento";
  // Un cliente al día no pide nada hoy; con algo por hacer más adelante, tampoco.
  if (esCliente(c) || porHacer) return null;
  if (proxima) return "esperando";
  const dias = c.lastMessageAt ? (ahora.getTime() - Date.parse(c.lastMessageAt)) / DIA_MS : 0;
  if (!esDemo(c) && dias >= DIAS_DORMIDO) return "dormidos";
  if (sinTildes(c.stageName) === "no asistio" || pideSeguimiento(c, DIAS_SEGUIMIENTO_HOY, ahora)) {
    return "seguimiento";
  }
  return "esperando";
}

/** La única etiqueta de la fila: lo que hay que saber del chat en su grupo. */
export function detalleHoy(
  c: ParaHoy,
  grupo: GrupoHoy,
  hoy: string,
  ahora: Date
): { texto: string; urgente: boolean } | null {
  const dias = c.lastMessageAt ? Math.floor((ahora.getTime() - Date.parse(c.lastMessageAt)) / DIA_MS) : null;
  const proxima = c.agenda?.proxima ?? null;
  const porHacer = c.agenda?.porHacer ?? null;
  switch (grupo) {
    case "contestar":
      return null;
    case "demos":
      return proxima ? { texto: `Demo ${proxima.dia === hoy ? "hoy" : "mañana"} ${proxima.hora}`, urgente: proxima.dia === hoy } : null;
    case "seguimiento":
      if (porHacer) {
        const vencido = estaVencido(porHacer.fecha, hoy);
        return { texto: `${PASO_LABEL[porHacer.paso]}${vencido ? " · vencido" : ""}`, urgente: vencido };
      }
      if (sinTildes(c.stageName) === "no asistio") return { texto: "No asistió", urgente: true };
      return { texto: `Sin respuesta · ${dias ?? 0} d`, urgente: (dias ?? 0) >= 4 };
    case "esperando":
      return proxima
        ? { texto: `Demo ${proxima.dia.slice(8)}/${proxima.dia.slice(5, 7)} ${proxima.hora}`, urgente: false }
        : c.stageName
          ? { texto: c.stageName, urgente: false }
          : null;
    case "dormidos":
      return { texto: `${dias ?? 0} d sin movimiento`, urgente: false };
  }
}
