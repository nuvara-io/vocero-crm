/**
 * 052 — El filtro «Por vencer» de la bandeja y el aviso «Vence en…» de la
 * fila. Puros, para probarlos sin navegador. («Sin responder» se quitó en la
 * enmienda del 2026-10-23.)
 */

/** Margen para contestar antes de que cierre la ventana del canal. */
export const POR_VENCER_MS = 2 * 3_600_000;

type ConVentana = { windowOpen: boolean; windowRemainingMs: number };

/** La ventana sigue abierta pero le quedan 2 h o menos. */
export function porVencer(c: ConVentana): boolean {
  return c.windowOpen && c.windowRemainingMs > 0 && c.windowRemainingMs <= POR_VENCER_MS;
}

/** «Vence en 1 h 20 min» / «Vence en 45 min» / «Vence en menos de 1 min». */
export function etiquetaVence(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Vence en menos de 1 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `Vence en ${m} min`;
  return m === 0 ? `Vence en ${h} h` : `Vence en ${h} h ${m} min`;
}

/**
 * 067 — «Seguimiento pendiente»: le escribimos de último y lleva `dias` o más
 * sin contestar, en una etapa abierta y sin archivar. Es la lista de a quién
 * hay que volver a escribirle (casi siempre con plantilla).
 */
type ParaSeguimiento = {
  lastDirection: "in" | "out" | null;
  lastMessageAt: string | null;
  stageKind: "open" | "won" | "lost" | null;
  archivedAt: string | null;
};

export const DIAS_SEGUIMIENTO = [1, 2, 3, 7] as const;

export function pideSeguimiento(c: ParaSeguimiento, dias: number, ahora: Date): boolean {
  if (c.archivedAt || c.stageKind === "won" || c.stageKind === "lost") return false;
  if (c.lastDirection !== "out" || !c.lastMessageAt) return false;
  return ahora.getTime() - Date.parse(c.lastMessageAt) >= dias * 86_400_000;
}

/** Días completos desde el último mensaje (para la etiqueta de la fila). */
export function diasDesde(iso: string | null, ahora: Date): number | null {
  if (!iso) return null;
  return Math.floor((ahora.getTime() - Date.parse(iso)) / 86_400_000);
}
