/**
 * 071 — Reglas puras del CRM (sin base de datos ni React), para que una prueba
 * unitaria las afirme todas.
 */

/* ------------------------------------------------------------------ *
 * Texto del agente → WhatsApp
 * ------------------------------------------------------------------ */

/**
 * Lo que escribe un modelo a veces trae LaTeX o Markdown que WhatsApp muestra
 * literal: «$500 \times \$510$», «**negrita**», «### Título». Se convierte a
 * lo que WhatsApp entiende, sin tocar los precios normales («$80.000»).
 */
export function limpiarTextoParaWhatsApp(texto: string): string {
  // `\$` es un peso literal dentro de la fórmula: se aparta antes de buscar
  // los `$` que delimitan, y se devuelve al final.
  const PESO = "\u0000";
  let t = texto.replace(/\\\$/g, PESO);
  // Comandos LaTeX comunes → símbolos.
  t = t
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\approx/g, "≈")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1");
  // Delimitadores de bloque y en línea: \( \) \[ \] $$ … $$.
  t = t.replace(/\\\(|\\\)|\\\[|\\\]/g, "").replace(/\$\$/g, "");
  // `$…$` como delimitador matemático: solo cuando lo que encierra tiene
  // pinta de fórmula (un ×, un \, una llave) — así «$80.000 y $510» queda igual.
  t = t.replace(/\$([^$\n]*[×÷·≤≥≈{}\\][^$\n]*)\$/g, "$1");
  // `\%` escapado → literal; el peso apartado vuelve a ser `$`.
  t = t.replace(/\\%/g, "%").replace(new RegExp(PESO, "g"), "$");
  // Markdown: **negrita** → *negrita*, encabezados → texto.
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "*$1*").replace(/^#{1,6}\s+/gm, "");
  // Espacios dobles que dejan las sustituciones.
  t = t.replace(/[ \t]{2,}/g, " ");
  return t;
}

/* ------------------------------------------------------------------ *
 * Origen deducido del primer mensaje
 * ------------------------------------------------------------------ */

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Textos que pone el enlace de la página y de las redes (`apps/landing`). */
const SALUDOS_WEB = [
  "hola quiero mas informacion sobre nuvara",
  "hola vengo de sus redes y quiero mas informacion sobre nuvara",
];

/**
 * Saludos automáticos de Meta cuando alguien toca «Enviar mensaje» sin
 * preguntas propias (publicación promocionada, botón de la página o del
 * perfil, anuncio sin preguntas rápidas).
 */
const SALUDOS_META = [
  "hola quiero mas informacion",
  "hola me gustaria obtener mas informacion",
  "hola me gustaria conseguir mas informacion",
  "hola me gustaria recibir mas informacion",
  "hello can i get more info on this",
  "hi can i get more info on this",
  "hello i would like more information",
];

/**
 * Si la conversación NO llegó por un anuncio identificado, ¿el primer mensaje
 * dice de dónde salió? `null` si no se puede saber.
 */
export function deducirOrigenPorSaludo(texto: string | null | undefined): "web" | "meta" | null {
  if (!texto) return null;
  const t = sinTildes(texto);
  if (SALUDOS_WEB.includes(t)) return "web";
  if (SALUDOS_META.includes(t)) return "meta";
  return null;
}

/* ------------------------------------------------------------------ *
 * Responsable de los leads nuevos
 * ------------------------------------------------------------------ */

export type ReglaResponsable =
  | { modo: "nadie" }
  | { modo: "fijo"; userId: string }
  | { modo: "rotacion"; userIds: string[] };

/**
 * A quién se le asigna un lead nuevo. En rotación toca al siguiente del que
 * recibió el último; si ese ya no está en la lista, empieza por el primero.
 * Solo cuenta a quien sigue en el equipo.
 */
export function elegirResponsable(
  regla: ReglaResponsable,
  equipo: ReadonlySet<string>,
  ultimoAsignado: string | null
): string | null {
  if (regla.modo === "fijo") return equipo.has(regla.userId) ? regla.userId : null;
  if (regla.modo !== "rotacion") return null;
  const lista = regla.userIds.filter((id) => equipo.has(id));
  if (lista.length === 0) return null;
  const i = ultimoAsignado ? lista.indexOf(ultimoAsignado) : -1;
  return lista[(i + 1) % lista.length] ?? null;
}

/* ------------------------------------------------------------------ *
 * Seguimiento automático
 * ------------------------------------------------------------------ */

export type PasoSeguimiento = { dias: number; templateId: string };

/** 077 — Qué pasa al final de la secuencia de una etapa. */
export type FinalEtapa = "archivar" | "perdido" | "nada";

/**
 * 077 — La secuencia de UNA etapa: cada situación lleva su mensaje (no es lo
 * mismo quien nunca contestó que quien ya creó la cuenta). Los días cuentan
 * desde que el lead entró a la etapa o desde nuestro último mensaje sin
 * respuesta, lo que sea más reciente.
 */
export type SecuenciaEtapa = {
  stageId: string;
  pasos: PasoSeguimiento[];
  /** Días sin respuesta para la acción final; 0 = sin acción final. */
  finalDias: number;
  final: FinalEtapa;
};

export type AjustesSeguimiento = {
  enabled: boolean;
  pasos: PasoSeguimiento[];
  /** Días sin respuesta para archivar; 0 = no archivar. */
  archivarDias: number;
  /**
   * 077 — Secuencias por etapa. Si hay al menos una, SOLO esas etapas
   * reciben seguimiento (los pasos generales quedan de respaldo para nada):
   * así «Demo agendada» o «Activado» nunca reciben un «retomemos».
   */
  porEtapa?: SecuenciaEtapa[];
  /** 077 — También en chats que atiende una persona (solo plantillas). */
  incluirAtendidos?: boolean;
};

/** 077 — Recordatorio de la demo N minutos antes. */
export type AjustesRecordatorio = {
  enabled: boolean;
  minutos: number;
  plantilla: string | null;
};

export const RECORDATORIO_POR_DEFECTO: AjustesRecordatorio = {
  enabled: false,
  minutos: 15,
  plantilla: null,
};

/** 077 — ¿Toca el recordatorio de esta cita? (solo dentro de la ventana previa). */
export function tocaRecordatorio(input: {
  ahora: Date;
  citaEn: Date;
  minutos: number;
}): boolean {
  const falta = input.citaEn.getTime() - input.ahora.getTime();
  return falta > 0 && falta <= input.minutos * 60 * 1000;
}

export const SEGUIMIENTO_POR_DEFECTO: AjustesSeguimiento = {
  enabled: false,
  pasos: [],
  archivarDias: 10,
};

export type DecisionSeguimiento =
  | { accion: "enviar"; paso: number; templateId: string }
  | { accion: "archivar" }
  | { accion: "perdido" }
  | null;

/**
 * Qué le toca a una conversación que lleva `dias` sin respuesta desde nuestro
 * último mensaje. Los pasos van en orden y de a uno: si el paso 1 no se envió,
 * no salta al 2 aunque ya hayan pasado sus días.
 */
export function decidirSeguimiento(input: {
  ajustes: Pick<AjustesSeguimiento, "enabled" | "pasos" | "archivarDias">;
  dias: number;
  /** Pasos ya registrados para este ancla (1, 2… y 0 = archivado). */
  hechos: ReadonlySet<number>;
  /** 077 — Acción al final (por defecto, archivar). */
  final?: FinalEtapa;
  /**
   * 077 — Días desde el último paso enviado de este ancla. Con él se respeta
   * el espacio ENTRE pasos: un chat viejo que ya pasó todos sus días recibe
   * el paso 1 hoy y el 2 cuando se cumpla la diferencia, no 15 minutos después.
   */
  diasDesdeUltimo?: number | null;
}): DecisionSeguimiento {
  const { ajustes, dias, hechos } = input;
  const final = input.final ?? "archivar";
  if (!ajustes.enabled || hechos.has(0)) return null;
  const pasos = [...ajustes.pasos].sort((a, b) => a.dias - b.dias);
  const desde = input.diasDesdeUltimo;
  for (let i = 0; i < pasos.length; i++) {
    const n = i + 1;
    if (hechos.has(n)) continue;
    const paso = pasos[i]!;
    if (dias < paso.dias) return null;
    if (i > 0 && desde != null && desde < Math.max(1, paso.dias - pasos[i - 1]!.dias)) return null;
    return { accion: "enviar", paso: n, templateId: paso.templateId };
  }
  if (final === "nada" || ajustes.archivarDias <= 0 || dias < ajustes.archivarDias) return null;
  const ultimo = pasos.at(-1);
  if (ultimo && desde != null && desde < Math.max(1, ajustes.archivarDias - ultimo.dias)) return null;
  return final === "perdido" ? { accion: "perdido" } : { accion: "archivar" };
}

/** 077 — La secuencia que le toca a un lead en esa etapa (o null si no hay). */
export function secuenciaDeEtapa(
  ajustes: AjustesSeguimiento,
  stageId: string
): { modo: "etapa"; secuencia: SecuenciaEtapa } | { modo: "general" } | null {
  const porEtapa = ajustes.porEtapa ?? [];
  if (porEtapa.length === 0) return { modo: "general" };
  const secuencia = porEtapa.find((x) => x.stageId === stageId);
  return secuencia ? { modo: "etapa", secuencia } : null;
}

/** 073 — Recuperación de quien no asistió a la demo. */
export type AjustesNoAsistio = {
  enabled: boolean;
  minutos: number;
  plantilla1: string | null;
  dias2: number;
  plantilla2: string | null;
};
