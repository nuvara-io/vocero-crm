import { festivosDe } from "@/lib/festivos";

/**
 * 072 — Reglas puras de la prospección por WhatsApp (sin base de datos ni
 * React). Vienen del cerebro de núvara, tema `prospeccion-por-whatsapp`:
 *
 * - A un prospecto solo se le escribe con permiso previo (fecha, canal, texto).
 * - Ley 2300 de 2023: lunes a viernes 7:00–19:00, sábados 8:00–15:00, nunca
 *   domingos ni festivos.
 * - Uno a uno, con tope de conversaciones nuevas por día.
 * - Quien pide la baja no se vuelve a contactar.
 */

/** Las etapas de la prospección, en orden, antes del embudo normal. */
export const ETAPAS_PROSPECCION = ["Prospecto", "Permiso pedido", "Permiso sí"] as const;
export type EtapaProspeccion = (typeof ETAPAS_PROSPECCION)[number];

/** Conversaciones nuevas con prospectos por día y por número (cerebro). */
export const TOPE_DIARIO_PROSPECTOS = 20;

export const CANALES_PERMISO = {
  llamada: "Llamada a la línea de la firma",
  formulario: "Formulario de su sitio web",
  linkedin: "LinkedIn",
  correo: "Correo",
  presencial: "En persona",
  otro: "Otro",
} as const;
export type CanalPermiso = keyof typeof CANALES_PERMISO;

/** El texto del puente de permiso que propone el cerebro. */
export const TEXTO_PERMISO_SUGERIDO =
  "¿Te puedo escribir por WhatsApp para contarte en dos líneas y, si te sirve, agendar una demostración en vivo de 30 minutos? Si en algún momento no quieres más mensajes, nos dices.";

/* ------------------------------------------------------------------ *
 * Horario (Ley 2300 de 2023)
 * ------------------------------------------------------------------ */

function partesEn(ahora: Date, tz: string) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(ahora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return {
    dia: `${v("year")}-${v("month")}-${v("day")}`,
    anio: Number(v("year")),
    minutos: (Number(v("hour")) % 24) * 60 + Number(v("minute")),
    semana: v("weekday"),
  };
}

/** ¿Se puede escribir un mensaje comercial ahora, según la Ley 2300? */
export function horarioLey2300(ahora: Date, tz = "America/Bogota"): boolean {
  const p = partesEn(ahora, tz);
  if (p.semana === "Sun") return false;
  if (festivosDe("CO", p.anio).includes(p.dia)) return false;
  if (p.semana === "Sat") return p.minutos >= 8 * 60 && p.minutos < 15 * 60;
  return p.minutos >= 7 * 60 && p.minutos < 19 * 60;
}

/** El día (AAAA-MM-DD) en la zona dada, para contar el tope diario. */
export function diaEn(ahora: Date, tz = "America/Bogota"): string {
  return partesEn(ahora, tz).dia;
}

/* ------------------------------------------------------------------ *
 * ¿Se le puede escribir?
 * ------------------------------------------------------------------ */

export type ContactoParaEnvio = {
  prospectList: string | null;
  consentAt: Date | null;
  doNotContactAt: Date | null;
  firstContactAt: Date | null;
};

export type BloqueoEnvio = {
  code: "suprimido" | "sin_permiso" | "fuera_de_horario" | "tope_diario";
  message: string;
};

/**
 * Para una plantilla (un mensaje que abre la conversación nosotros). Lo que el
 * cliente escribe primero se le puede contestar siempre: estas reglas son para
 * escribirle sin que haya escrito.
 */
export function bloqueoDePlantilla(input: {
  contacto: ContactoParaEnvio;
  ahora: Date;
  tz?: string;
  /** Prospectos con su primer mensaje hoy (sin contar a este). */
  primerosContactosHoy: number;
  tope?: number;
}): BloqueoEnvio | null {
  const { contacto } = input;
  if (contacto.doNotContactAt) {
    return {
      code: "suprimido",
      message: "Esta persona pidió no ser contactada: está en la lista de supresión.",
    };
  }
  if (!contacto.prospectList) return null;
  if (!contacto.consentAt) {
    return {
      code: "sin_permiso",
      message: "A un prospecto solo se le escribe con permiso: regístralo primero en Prospección.",
    };
  }
  if (!horarioLey2300(input.ahora, input.tz)) {
    return {
      code: "fuera_de_horario",
      message: "Fuera del horario de la Ley 2300: lunes a viernes de 7:00 a 19:00 y sábados de 8:00 a 15:00, sin domingos ni festivos.",
    };
  }
  const tope = input.tope ?? TOPE_DIARIO_PROSPECTOS;
  if (!contacto.firstContactAt && input.primerosContactosHoy >= tope) {
    return {
      code: "tope_diario",
      message: `Ya van ${tope} prospectos nuevos hoy: es el tope diario por número. Sigue mañana.`,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Baja
 * ------------------------------------------------------------------ */

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** ¿El mensaje pide que no le escribamos más? (incluye el botón «No me interesa»). */
export function pideBaja(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = sinTildes(texto).replace(/[¡!¿?.,]/g, "").replace(/\s+/g, " ");
  if (t === "no me interesa" || t === "baja" || t === "stop" || t === "no gracias no me interesa") return true;
  return /\b(no me (vuelvan a )?(escrib|contact|manden)|dar(me)? de baja|no quiero (recibir )?(mas )?mensajes|dejen de escrib|no me escriban mas|borren mi numero|eliminen mi numero)/.test(
    t
  );
}

/* ------------------------------------------------------------------ *
 * Importar la lista de firmas (formato del Excel del equipo)
 * ------------------------------------------------------------------ */

const norm = (s: unknown) =>
  sinTildes(String(s ?? ""))
    .replace(/[¿?()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Encabezado del Excel → clave de la ficha. Lo que no esté aquí se ignora. */
const COLUMNAS: Record<string, string> = {
  ciudad: "ciudad",
  region: "region",
  servicios: "servicios",
  "senal de tamano": "tamano",
  "programa contable que menciona": "programa",
  "sitio web": "sitio",
  "donde se ve el whatsapp": "fuente_whatsapp",
  "verificado el": "verificado",
  "encaje para nuvara": "encaje",
  "por que ese encaje": "encaje_motivo",
  "notas de la busqueda": "notas",
  "harvey exportacion del 05/11": "harvey",
};

export type FilaProspecto = {
  linea: number;
  nombre: string;
  telefono: string;
  ficha: Record<string, string>;
};

export type ProblemaFila = { linea: number; nombre: string; motivo: string };

/** Teléfono a solo dígitos con indicativo; un celular colombiano sin él gana el 57. */
export function normalizarTelefono(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (/^3\d{9}$/.test(d)) return `57${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/**
 * Convierte la hoja «Firmas» (o cualquier hoja con columnas «Firma» y
 * «WhatsApp…») en filas listas para importar. Puro: lo usa el navegador para
 * la vista previa y el servidor para validar de nuevo.
 */
export function leerHojaDeFirmas(filas: unknown[][]): { filas: FilaProspecto[]; problemas: ProblemaFila[] } {
  const iHeader = filas.findIndex((r) => r.some((c) => norm(c) === "firma"));
  if (iHeader < 0) return { filas: [], problemas: [{ linea: 1, nombre: "", motivo: "No encontré la columna «Firma»" }] };
  const header = filas[iHeader]!.map(norm);
  const iNombre = header.indexOf("firma");
  const iTel = header.findIndex((h) => h.startsWith("whatsapp"));
  if (iTel < 0) return { filas: [], problemas: [{ linea: iHeader + 1, nombre: "", motivo: "No encontré la columna del WhatsApp" }] };

  const out: FilaProspecto[] = [];
  const problemas: ProblemaFila[] = [];
  const vistos = new Set<string>();
  for (let i = iHeader + 1; i < filas.length; i++) {
    const r = filas[i]!;
    const nombre = String(r[iNombre] ?? "").trim();
    if (!nombre && !r[iTel]) continue;
    const telefono = normalizarTelefono(r[iTel]);
    if (!telefono) {
      problemas.push({ linea: i + 1, nombre, motivo: "teléfono inválido" });
      continue;
    }
    if (vistos.has(telefono)) {
      problemas.push({ linea: i + 1, nombre, motivo: "repetido en el archivo" });
      continue;
    }
    vistos.add(telefono);
    const ficha: Record<string, string> = {};
    header.forEach((h, j) => {
      const clave = COLUMNAS[h];
      const valor = r[j];
      if (clave && valor !== null && valor !== undefined && String(valor).trim()) {
        ficha[clave] = String(valor).trim().slice(0, 500);
      }
    });
    if (/borrador/i.test(ficha.harvey ?? "")) {
      ficha.aviso = "Tiene un correo en borrador en Harvey: no escribir por dos canales a la vez.";
    }
    out.push({ linea: i + 1, nombre: nombre.slice(0, 120) || telefono, telefono, ficha });
  }
  return { filas: out, problemas };
}

/** Orden de trabajo: encaje Alto primero. */
export function rangoEncaje(encaje: string | null | undefined): number {
  const e = norm(encaje);
  return e === "alto" ? 0 : e === "medio" ? 1 : e === "bajo" ? 2 : 3;
}
