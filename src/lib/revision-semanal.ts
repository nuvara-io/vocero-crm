/**
 * 073 — La revisión semanal de la plantilla de @tudeptodeventas, pura: cuántos
 * entraron a cada etapa en la semana, el porcentaje de paso entre etapas
 * seguidas, dónde se cae más y qué suele pasar ahí.
 */

export type EtapaConteo = { nombre: string; entradas: number };

export type PasoEmbudo = {
  desde: string;
  hasta: string;
  entradasDesde: number;
  entradasHasta: number;
  /** 0–1; null si nadie entró a «desde». */
  tasa: number | null;
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Etapas que no son el camino principal: prospección y la recuperación. */
const FUERA_DEL_CAMINO = ["prospecto", "permiso pedido", "permiso si", "no asistio", "seguimiento"];

export function caminoPrincipal<T extends { nombre: string }>(etapas: readonly T[]): T[] {
  return etapas.filter((e) => !FUERA_DEL_CAMINO.includes(norm(e.nombre)));
}

export function pasosDelEmbudo(etapas: readonly EtapaConteo[]): PasoEmbudo[] {
  const camino = caminoPrincipal(etapas);
  const pasos: PasoEmbudo[] = [];
  for (let i = 0; i + 1 < camino.length; i++) {
    const a = camino[i]!;
    const b = camino[i + 1]!;
    pasos.push({
      desde: a.nombre,
      hasta: b.nombre,
      entradasDesde: a.entradas,
      entradasHasta: b.entradas,
      tasa: a.entradas > 0 ? Math.min(1, b.entradas / a.entradas) : null,
    });
  }
  return pasos;
}

/** El paso con la tasa más baja (con al menos `minimo` entradas para no leer ruido). */
export function mayorCaida(pasos: readonly PasoEmbudo[], minimo = 3): PasoEmbudo | null {
  let peor: PasoEmbudo | null = null;
  for (const p of pasos) {
    if (p.tasa === null || p.entradasDesde < minimo) continue;
    if (!peor || p.tasa < (peor.tasa ?? 1)) peor = p;
  }
  return peor;
}

/** Lo que suele explicar la caída, según a qué etapa no se llega. */
export function diagnostico(hasta: string): string {
  const h = norm(hasta);
  if (/conversacion|contactado/.test(h)) {
    return "Nadie responde rápido: el lead se enfría antes del primer mensaje.";
  }
  if (/calificado/.test(h)) {
    return "Se conversa, pero no se pregunta lo que hay que preguntar (tipo de cliente, empresas, facturas al mes).";
  }
  if (/demo agendada|llamada agendada|agendad/.test(h)) {
    return "Se califica bien, pero no se pide la demo con día y hora.";
  }
  if (/demo hecha|asistio/.test(h)) {
    return "Faltan la confirmación y los recordatorios antes de la demo.";
  }
  return "La demo, la oferta o el seguimiento después de la demo.";
}

export type RevisionSemanalDto = {
  desde: string;
  etapas: { nombre: string; entradas: number }[];
  pasos: PasoEmbudo[];
  caida: (PasoEmbudo & { diagnostico: string }) | null;
  /** Lo que hay en Demo agendada, No asistió y Seguimiento: se cierra o se pierde esta semana. */
  sobreLaMesa: { cents: number; leads: number; sinValor: number };
};
