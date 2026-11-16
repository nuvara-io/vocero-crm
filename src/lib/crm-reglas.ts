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

export type AjustesSeguimiento = {
  enabled: boolean;
  pasos: PasoSeguimiento[];
  /** Días sin respuesta para archivar; 0 = no archivar. */
  archivarDias: number;
};

export const SEGUIMIENTO_POR_DEFECTO: AjustesSeguimiento = {
  enabled: false,
  pasos: [],
  archivarDias: 10,
};

export type DecisionSeguimiento =
  | { accion: "enviar"; paso: number; templateId: string }
  | { accion: "archivar" }
  | null;

/**
 * Qué le toca a una conversación que lleva `dias` sin respuesta desde nuestro
 * último mensaje. Los pasos van en orden y de a uno: si el paso 1 no se envió,
 * no salta al 2 aunque ya hayan pasado sus días.
 */
export function decidirSeguimiento(input: {
  ajustes: AjustesSeguimiento;
  dias: number;
  /** Pasos ya registrados para este ancla (1, 2… y 0 = archivado). */
  hechos: ReadonlySet<number>;
}): DecisionSeguimiento {
  const { ajustes, dias, hechos } = input;
  if (!ajustes.enabled || hechos.has(0)) return null;
  const pasos = [...ajustes.pasos].sort((a, b) => a.dias - b.dias);
  for (let i = 0; i < pasos.length; i++) {
    const n = i + 1;
    if (hechos.has(n)) continue;
    const paso = pasos[i]!;
    return dias >= paso.dias ? { accion: "enviar", paso: n, templateId: paso.templateId } : null;
  }
  if (ajustes.archivarDias > 0 && dias >= ajustes.archivarDias) return { accion: "archivar" };
  return null;
}

/** 073 — Recuperación de quien no asistió a la demo. */
export type AjustesNoAsistio = {
  enabled: boolean;
  minutos: number;
  plantilla1: string | null;
  dias2: number;
  plantilla2: string | null;
};
