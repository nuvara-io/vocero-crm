import { parseAgendaFlag } from "@/server/agenda/flag";

/** 072 — ¿Esta instancia hace prospección? Apagada por defecto (ADR-001). */
export function prospeccionEnabled(): boolean {
  return parseAgendaFlag(process.env.PROSPECCION);
}
