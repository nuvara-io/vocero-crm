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

/**
 * 075 — Las vistas de la bandeja, por lo que toca hacer con cada chat:
 *  - «Por contestar»: el cliente habló último (cualquier etapa abierta o de cliente).
 *  - «Esperando respuesta»: hablamos últimos, antes de la demo.
 *  - «En demo»: Demo agendada, Demo hecha, No asistió, Seguimiento.
 *  - «Clientes»: etapas ganadas (Registrado, Activado…).
 *  - «Cerrados»: perdidos y archivados.
 * «Por contestar» se cruza con «En demo» y «Clientes» a propósito: lo urgente
 * se ve junto, sin importar la etapa.
 */
export type VistaBandeja =
  /** 083 — Lo que toca hoy, agrupado (ver `bandeja-hoy`). */
  | "hoy"
  /** 083 — Todo lo abierto, agrupado por etapa del embudo. */
  | "etapa"
  | "todas"
  | "por_contestar"
  | "esperando"
  | "demo"
  | "clientes"
  | "cerrados"
  /** 078 — Chats que el filtro cree fuera de perfil, para decidir de una. */
  | "revisar_perfil";

/** 083 — Las pestañas: «Hoy» manda; las vistas viejas siguen para los filtros. */
export const VISTAS_BANDEJA: { id: VistaBandeja; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "etapa", label: "Por etapa" },
  { id: "clientes", label: "Clientes" },
  { id: "cerrados", label: "Cerrados" },
  { id: "revisar_perfil", label: "¿Fuera de perfil?" },
];

type ParaVista = {
  lastDirection: "in" | "out" | null;
  stageKind: "open" | "won" | "lost" | null;
  stageName: string | null;
  archivedAt: string | null;
  /** 078 */
  perfil?: { estado: "sospecha" | "fuera" | "ok" | null; motivo: string | null } | null;
};

const clave = (s: string | null) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Orden de las etapas de demo para agruparlas en la vista. */
export const ETAPAS_DE_DEMO = ["demo agendada", "demo hecha", "por decidir", "no asistio", "seguimiento"] as const;
const ETAPAS_DE_CLIENTE = ["registrado", "activado", "cliente"];

export function esCerrado(c: ParaVista): boolean {
  return Boolean(c.archivedAt) || c.stageKind === "lost";
}
export function esCliente(c: ParaVista): boolean {
  return !esCerrado(c) && (c.stageKind === "won" || ETAPAS_DE_CLIENTE.includes(clave(c.stageName)));
}
export function esDemo(c: ParaVista): boolean {
  return !esCerrado(c) && !esCliente(c) && (ETAPAS_DE_DEMO as readonly string[]).includes(clave(c.stageName));
}

export function enVista(c: ParaVista, vista: VistaBandeja): boolean {
  switch (vista) {
    case "hoy":
      // El grupo exacto lo decide `grupoHoy`; aquí basta con lo abierto.
      return !esCerrado(c);
    case "etapa":
      // Los clientes tienen su pestaña: aquí va el embudo.
      return !esCerrado(c) && !esCliente(c);
    case "todas":
      return !esCerrado(c);
    case "cerrados":
      return esCerrado(c);
    case "por_contestar":
      return !esCerrado(c) && c.lastDirection === "in";
    case "esperando":
      return !esCerrado(c) && !esCliente(c) && !esDemo(c) && c.lastDirection !== "in";
    case "demo":
      return esDemo(c);
    case "clientes":
      return esCliente(c);
    case "revisar_perfil":
      return !esCerrado(c) && c.perfil?.estado === "sospecha";
  }
}

/** En «En demo» y «Clientes» la lista va por etapa: este es el orden del grupo. */
export function ordenDeGrupo(stageName: string | null): number {
  const k = clave(stageName);
  const previas = ["nuevo", "prospecto", "en conversacion", "calificado"];
  const p = previas.indexOf(k);
  if (p >= 0) return -10 + p;
  const i = (ETAPAS_DE_DEMO as readonly string[]).indexOf(k);
  if (i >= 0) return i;
  const j = ETAPAS_DE_CLIENTE.indexOf(k);
  // 083 — Una etapa propia del negocio va antes de las de cliente.
  return j >= 0 ? 10 + j : 5;
}

/**
 * 076 — El estado del chat en un color, para ver de un vistazo a quién hay que
 * atender: quién ya está activo, a quién hay que volver a escribirle, quién
 * está esperando. Se decide en este orden (el primero que aplica gana):
 *  - Cerrado: perdido o archivado.
 *  - Activo: etapa «Activado» o «Cliente» (ya paga).
 *  - Registrado: otra etapa ganada (se registró, todavía no activa).
 *  - Por contestar: el cliente habló último.
 *  - Recontactar: le escribimos de último hace 2 días o más, o no asistió.
 *  - En demo: Demo agendada / Demo hecha / Seguimiento.
 *  - Esperando: le escribimos hace poco y todavía no contesta.
 */
export type EstadoChat =
  | "cerrado"
  | "activo"
  | "registrado"
  | "por_contestar"
  | "recontactar"
  | "en_demo"
  | "esperando";

export type TonoEstado = "neutral" | "success" | "brand" | "info" | "danger" | "warning";

export const ESTADOS_CHAT: Record<EstadoChat, { label: string; tono: TonoEstado }> = {
  cerrado: { label: "Cerrado", tono: "neutral" },
  activo: { label: "Activo", tono: "success" },
  registrado: { label: "Registrado", tono: "brand" },
  por_contestar: { label: "Por contestar", tono: "info" },
  recontactar: { label: "Recontactar", tono: "danger" },
  en_demo: { label: "En demo", tono: "warning" },
  esperando: { label: "Esperando", tono: "neutral" },
};

/** Días sin respuesta a partir de los cuales hay que volver a escribirle. */
export const DIAS_RECONTACTAR = 2;

const ETAPAS_ACTIVAS = ["activado", "activo", "cliente"];

type ParaEstado = ParaVista & { lastMessageAt: string | null };

export function estadoDeChat(c: ParaEstado, ahora: Date): EstadoChat {
  if (esCerrado(c)) return "cerrado";
  const etapa = clave(c.stageName);
  if (ETAPAS_ACTIVAS.includes(etapa)) return "activo";
  if (esCliente(c)) return "registrado";
  if (c.lastDirection === "in") return "por_contestar";
  if (etapa === "no asistio" || pideSeguimiento(c, DIAS_RECONTACTAR, ahora)) return "recontactar";
  if (esDemo(c)) return "en_demo";
  return "esperando";
}

/** 084 — ¿Es «Por decidir»? (demo hecha, falta su decisión). */
export function esEtapaPorDecidir(nombre: string | null): boolean {
  return clave(nombre) === "por decidir";
}

/** ¿Esta etapa es la de «Activado»? (sin importar tildes ni mayúsculas). */
export function esEtapaActivado(nombre: string | null): boolean {
  return ETAPAS_ACTIVAS.includes(clave(nombre));
}
