/**
 * 078 — Filtro de leads fuera de perfil.
 *
 * La pauta trae gente que busca préstamos («crédito», «plata») o empleo y no
 * contadores. Primero una pista barata por palabras (sin IA, sin costo); solo
 * si hay pista se le pregunta a la IA, porque «créditos» también es la unidad
 * de saldo de núvara y un contador puede decir «¿cuántos créditos gasto?».
 */

export type MotivoPerfil = "prestamo" | "empleo" | "otro_servicio" | "spam";

export const MOTIVO_PERFIL_LABEL: Record<MotivoPerfil, string> = {
  prestamo: "Busca un préstamo",
  empleo: "Busca empleo",
  otro_servicio: "Busca otro servicio",
  spam: "Spam o publicidad",
};

export type ModoFiltroPerfil = "apagado" | "marcar" | "automatico";

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const PISTAS: { motivo: MotivoPerfil; re: RegExp }[] = [
  {
    motivo: "prestamo",
    re: /\b(prestamo|prestamos|prestar|prestame|presten|prestan|libranza|libre inversion|credito (personal|de libre|rapido|urgente|inmediato)|necesito (plata|dinero)|plata (prestada|urgente)|dinero (prestado|urgente)|me (pueden|puede) (prestar|financiar)|desembolso|reportado en datacredito|datacredito|cuanto me prestan)\b/,
  },
  {
    motivo: "empleo",
    re: /\b(empleo|vacante|vacantes|hoja de vida|curriculum|trabajo como|busco trabajo|necesito trabajo|ofrecen trabajo|estan contratando|contratan|postularme|me postulo)\b/,
  },
  { motivo: "spam", re: /\b(gana dinero|inversion segura|bitcoin|forex|cripto|multinivel)\b/ },
];

/** Pista por palabras: el motivo sospechado o null. Barata, sin IA. */
export function pistaFueraDePerfil(texto: string | null | undefined): MotivoPerfil | null {
  if (!texto) return null;
  const t = sinTildes(texto);
  return PISTAS.find((p) => p.re.test(t))?.motivo ?? null;
}

export type VeredictoPerfil = {
  fueraDePerfil: boolean;
  motivo: MotivoPerfil | null;
  /** 0 a 1. */
  confianza: number;
};

/** Umbral para actuar solo (modo automático). Por debajo, solo se marca. */
export const CONFIANZA_AUTOMATICA = 0.85;

export type AccionPerfil = "nada" | "marcar" | "descartar";

export function accionDePerfil(modo: ModoFiltroPerfil, v: VeredictoPerfil): AccionPerfil {
  if (modo === "apagado" || !v.fueraDePerfil) return "nada";
  if (modo === "automatico" && v.confianza >= CONFIANZA_AUTOMATICA) return "descartar";
  return "marcar";
}

export const PROMPT_PERFIL = `Eres el filtro de leads de núvara, un software contable colombiano que trae las facturas electrónicas de la DIAN y del correo y prepara la causación (asientos, IVA, retenciones) para contadores, firmas contables y empresas.

Te llega lo que escribió una persona por WhatsApp (casi siempre desde un anuncio). Decide si está FUERA DE PERFIL: alguien que no busca un software contable sino otra cosa.

Fuera de perfil:
- prestamo: pide un préstamo, crédito de dinero, plata prestada, libranza o financiación personal.
- empleo: busca trabajo, vacantes o quiere enviar su hoja de vida.
- otro_servicio: quiere algo que núvara no hace (tramitar algo personal, vender un producto ajeno, etc.).
- spam: publicidad, inversiones, cadenas.

NO es fuera de perfil (fueraDePerfil=false):
- Preguntas sobre «créditos» de núvara (el saldo con que se paga la causación), precios, recargas o planes.
- Contadores, auxiliares o empresas preguntando por facturas, causación, DIAN, RUT, IVA, nómina, programas contables.
- Saludos o mensajes sin contenido («hola», «información», «quiero saber más»): ante la duda, false.

Responde SOLO un JSON: {"fueraDePerfil": boolean, "motivo": "prestamo" | "empleo" | "otro_servicio" | "spam" | null, "confianza": número de 0 a 1}.`;
