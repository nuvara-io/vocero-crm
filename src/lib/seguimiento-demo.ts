import { z } from "zod";
import { NOTA_MAX } from "@/lib/notas";
import { isIsoDate } from "@/lib/time/calendar";

/** 082 — Qué sigue después de una demo: lo puro, para servidor y pantalla. */

export const PASOS_DEMO = ["seguimiento", "oferta", "reagendar", "no_sigue"] as const;
export type PasoDemo = (typeof PASOS_DEMO)[number];

/** Los que dejan algo por hacer. «No le interesa» cierra, no queda pendiente. */
export const PASOS_PENDIENTES = ["seguimiento", "oferta", "reagendar"] as const;

export const PASO_LABEL: Record<PasoDemo, string> = {
  seguimiento: "Hacer seguimiento",
  oferta: "Enviar oferta",
  reagendar: "Reagendar",
  no_sigue: "No le interesa",
};

export const seguimientoSchema = z
  .object({
    texto: z.string().trim().max(NOTA_MAX).optional(),
    paso: z.enum(PASOS_DEMO).nullable().optional(),
    fecha: z
      .string()
      .refine((f) => isIsoDate(f), "Fecha inválida")
      .nullable()
      .optional(),
    hecho: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.texto) || v.paso !== undefined || v.hecho !== undefined, {
    message: "Escribe una nota o elige qué sigue",
  });

export type SeguimientoInput = z.infer<typeof seguimientoSchema>;

/**
 * Pura: las columnas de la cita que cambian. Cambiar el paso o la fecha lo
 * reabre; sin paso (o «No le interesa») no hay fecha que vencer.
 */
export function cambiosDeSeguimiento(
  actual: { nextStep: PasoDemo | null; nextStepOn: string | null; nextStepDoneAt: Date | null },
  input: SeguimientoInput,
  ahora: Date
): { nextStep: PasoDemo | null; nextStepOn: string | null; nextStepDoneAt: Date | null } {
  const paso = input.paso === undefined ? actual.nextStep : input.paso;
  const conFecha = paso !== null && paso !== "no_sigue";
  const fecha = conFecha ? (input.fecha === undefined ? actual.nextStepOn : input.fecha) : null;
  let hecho = actual.nextStepDoneAt;
  if (paso !== actual.nextStep || fecha !== actual.nextStepOn) hecho = null;
  if (input.hecho === true) hecho = hecho ?? ahora;
  if (input.hecho === false || !conFecha) hecho = null;
  return { nextStep: paso, nextStepOn: fecha, nextStepDoneAt: hecho };
}

/** Pura: vencido si su día ya pasó. El de hoy todavía está a tiempo. */
export function estaVencido(fecha: string | null, hoy: string): boolean {
  return fecha !== null && fecha < hoy;
}
