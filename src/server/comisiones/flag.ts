import { parseAgendaFlag } from "@/server/agenda/flag";

/**
 * 068 — Si esta instancia lleva comisiones. Mismo patrón que la agenda
 * (ADR-001): el código viaja siempre, la variable decide si existe. Apagada,
 * las rutas responden 404, el menú no la muestra y el aviso `pagado` de la
 * plataforma solo mueve el lead, sin registrar la venta.
 */
export function comisionesEnabled(): boolean {
  return parseAgendaFlag(process.env.COMISIONES);
}

export function comisionesDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
