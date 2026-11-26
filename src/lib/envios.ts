import { z } from "zod";
import { primerNombre } from "@/lib/respuestas-rapidas";

/** 085 — Envíos programados: lo puro, para servidor y pantalla. */

/**
 * El nombre para «Hola {{1}}». Un contacto que en WhatsApp se llama solo con
 * un emoji (👍🏻) no tiene primer nombre: va el emoji tal cual, y sin nada,
 * «hola», antes que dejar el recordatorio sin salir.
 */
export function nombreParaPlantilla(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "").replace(/\s+/g, " ").trim();
  return primerNombre(limpio) || limpio.slice(0, 40) || "hola";
}

export const programarSchema = z.object({
  conversationId: z.string().min(1),
  templateId: z.string().min(1),
  variables: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  sendAt: z.string().datetime({ offset: true }),
});

export const moverSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancelar") }),
  z.object({ action: z.literal("mover"), sendAt: z.string().datetime({ offset: true }) }),
]);

export const omitirSchema = z.object({
  conversationId: z.string().min(1),
  // 0 = la acción final (archivar o pasar a Perdido).
  paso: z.number().int().min(0).max(99),
  ancla: z.string().datetime({ offset: true }),
  templateId: z.string().min(1).nullable(),
});

/** Un envío no se programa en el pasado; un minuto de gracia por el reloj. */
export function horaValida(sendAt: Date, ahora: Date): boolean {
  return sendAt.getTime() >= ahora.getTime() - 60_000;
}

/**
 * Cuándo saldría de verdad una acción automática que vence en `vence`: el
 * seguimiento solo corre en horario hábil (8:00–19:00, lunes a sábado), así
 * que lo que vence de noche sale a las 8:00 del siguiente día hábil.
 */
export function primeraHoraHabil(vence: Date, ahora: Date, habil: (d: Date) => boolean): Date {
  let t = new Date(Math.max(vence.getTime(), ahora.getTime()));
  for (let i = 0; i < 24 * 8 && !habil(t); i++) {
    t = new Date(Math.ceil((t.getTime() + 1) / 3_600_000) * 3_600_000);
  }
  return t;
}

export type EnvioDto = {
  id: string;
  /** `programado` lo puso una persona; `automatico` lo calcula el seguimiento. */
  origen: "programado" | "automatico";
  conversationId: string;
  contacto: { id: string; nombre: string };
  plantilla: { id: string; nombre: string } | null;
  /** Lo automático puede ser archivar o pasar a Perdido en vez de enviar. */
  accion: "enviar" | "archivar" | "perdido";
  cuando: string;
  estado: "pendiente" | "enviando" | "enviado" | "cancelado" | "error";
  error: string | null;
  quien: string | null;
  /** Solo automático: lo que hace falta para omitirlo. */
  paso?: number;
  ancla?: string;
  etapa?: string | null;
};
