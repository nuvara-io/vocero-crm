/**
 * 074 — Qué va en cada {{n}} de una plantilla, adivinado por el texto que la
 * rodea («Hola {{1}}» es el nombre, «a las {{3}}» la hora…), para llenarla con
 * lo que el CRM ya sabe en vez de reescribirlo. Siempre editable a mano.
 */

export type DatosPlantilla = {
  nombre: string | null;
  asesor: string | null;
  negocio: string | null;
  cita: { fecha: string; hora: string; enlace: string | null } | null;
};

export type TipoVariable = "nombre" | "asesor" | "negocio" | "fecha" | "hora" | "enlace" | "otro";

export type VariableSugerida = { tipo: TipoVariable; etiqueta: string; valor: string };

const ETIQUETA: Record<TipoVariable, string> = {
  nombre: "Nombre del cliente",
  asesor: "Tu nombre",
  negocio: "Nombre del negocio",
  fecha: "Día de la cita",
  hora: "Hora de la cita",
  enlace: "Enlace de la reunión",
  otro: "Valor",
};

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function tipoDeVariable(body: string, n: number): TipoVariable {
  const marca = new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`);
  const m = marca.exec(body);
  if (!m) return "otro";
  const antes = sinTildes(body.slice(Math.max(0, m.index - 60), m.index));
  const despues = sinTildes(body.slice(m.index + m[0].length, m.index + m[0].length + 30));
  if (/(enlace|link|url|meet)[^.{}]{0,25}:?\s*$/.test(antes)) return "enlace";
  if (/\ba las?\s*$/.test(antes) || /\bhora\s*:?\s*$/.test(antes)) return "hora";
  if (/\bsoy\s*$/.test(antes) || /\bmi nombre es\s*$/.test(antes)) return "asesor";
  if (/(\bel\b|\bdia\b|\bfecha\b)\s*:?\s*$/.test(antes) && /(demostracion|cita|reunion|llamada|agend)/.test(antes + despues)) {
    return "fecha";
  }
  if (/\bel\s*$/.test(antes) && /^\s*a las/.test(despues)) return "fecha";
  if (/(hola|buenos dias|buenas tardes|buenas noches|hey|saludos),?\s*$/.test(antes)) return "nombre";
  if (/(equipo de|empresa|negocio)\s*$/.test(antes)) return "negocio";
  // Al principio del mensaje y seguida de coma: casi siempre es el nombre.
  if (m.index < 3 && /^\s*,/.test(despues)) return "nombre";
  return "otro";
}

function valorDe(tipo: TipoVariable, datos: DatosPlantilla): string {
  switch (tipo) {
    case "nombre":
      return datos.nombre ?? "";
    case "asesor":
      return datos.asesor ?? "";
    case "negocio":
      return datos.negocio ?? "";
    case "fecha":
      return datos.cita?.fecha ?? "";
    case "hora":
      return datos.cita?.hora ?? "";
    case "enlace":
      return datos.cita?.enlace ?? "";
    default:
      return "";
  }
}

export function sugerirVariables(body: string, cantidad: number, datos: DatosPlantilla): VariableSugerida[] {
  return Array.from({ length: cantidad }, (_, i) => {
    const tipo = tipoDeVariable(body, i + 1);
    return {
      tipo,
      etiqueta: tipo === "otro" ? `Valor de {{${i + 1}}}` : ETIQUETA[tipo],
      valor: valorDe(tipo, datos),
    };
  });
}

/** Trozos del mensaje para la vista previa: texto fijo y valores puestos (o huecos). */
export type Trozo = { texto: string; variable?: number; vacio?: boolean };

export function trozosDeVistaPrevia(body: string, valores: readonly string[]): Trozo[] {
  const trozos: Trozo[] = [];
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let ultimo = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > ultimo) trozos.push({ texto: body.slice(ultimo, m.index) });
    const n = Number(m[1]);
    const v = (valores[n - 1] ?? "").trim();
    trozos.push({ texto: v || `{{${n}}}`, variable: n, vacio: !v });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < body.length) trozos.push({ texto: body.slice(ultimo) });
  return trozos;
}

/** `recordatorio_demostracion` → «Recordatorio demostracion». */
export function nombreLegible(nombre: string): string {
  const s = nombre.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
