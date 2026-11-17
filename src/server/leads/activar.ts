import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { esEtapaActivado } from "@/lib/filtros-bandeja";
import { getBranding } from "@/server/branding";
import { comisionesEnabled } from "@/server/comisiones/flag";
import { registrarVentaManual } from "@/server/comisiones/ventas";
import { moveLeadToStage } from "@/server/leads/stage-history";

/**
 * 076 — «Marcar activado» desde el chat: en un solo gesto mueve el lead a la
 * etapa «Activado» (o, si no existe, a la primera etapa ganada), le pone el
 * monto que pagó y, si las comisiones están prendidas, registra la venta a
 * nombre de quien la marcó (por confirmar si no es admin). Una sola venta por
 * lead: si ya hay una vigente no se duplica.
 */
export type ResultadoActivar =
  | {
      ok: true;
      leadId: string;
      contactId: string;
      venta: "registrada" | "ya_existia" | "comisiones_apagadas" | "rechazada";
      ventaMensaje?: string;
    }
  | { ok: false; status: number; code: string; message: string };

export async function activarLead(
  organizationId: string,
  actor: { userId: string; admin: boolean },
  input: { leadId: string; montoCents: number; pagadoEn: Date; email?: string | null }
): Promise<ResultadoActivar> {
  const db = getDb();
  const filas = await db
    .select({ lead: schema.lead, contactName: schema.contact.name })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, input.leadId)))
    .limit(1);
  const fila = filas[0];
  if (!fila) return { ok: false, status: 404, code: "not_found", message: "Lead no encontrado" };

  const etapas = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const destino =
    etapas.find((e) => esEtapaActivado(e.name)) ?? etapas.find((e) => e.kind === "won") ?? null;
  if (!destino) {
    return { ok: false, status: 422, code: "sin_etapa", message: "No hay una etapa «Activado» en el pipeline" };
  }

  const moneda = (await getBranding(organizationId)).currency;
  const extra = { amountCents: input.montoCents, currency: moneda };
  if (fila.lead.stageId === destino.id) {
    await db
      .update(schema.lead)
      .set({ ...extra, updatedAt: new Date() })
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, input.leadId)));
  } else {
    const mov = await moveLeadToStage({
      organizationId,
      leadId: input.leadId,
      toStageId: destino.id,
      position: 0,
      actorUserId: actor.userId,
      source: "dueno",
      extra,
    });
    if (!mov.ok) return { ok: false, status: 422, code: mov.reason, message: "No se pudo mover a Activado" };
  }

  const base = { ok: true as const, leadId: input.leadId, contactId: fila.lead.contactId };
  if (!comisionesEnabled()) return { ...base, venta: "comisiones_apagadas" };

  const vigente = await db
    .select({ id: schema.sale.id })
    .from(schema.sale)
    .where(
      and(
        eq(schema.sale.organizationId, organizationId),
        eq(schema.sale.leadId, input.leadId),
        isNull(schema.sale.voidedAt),
        notInArray(schema.sale.status, ["rechazada", "reemplazada"])
      )
    )
    .limit(1);
  if (vigente[0]) return { ...base, venta: "ya_existia" };

  const r = await registrarVentaManual(organizationId, actor, {
    cliente: fila.contactName,
    email: input.email ?? null,
    canal: "whatsapp_crm",
    montoCents: input.montoCents,
    pagadoEn: input.pagadoEn,
    nota: "Marcada como activada desde el chat",
    leadId: input.leadId,
    contactId: fila.lead.contactId,
  });
  if (!r.ok) return { ...base, venta: "rechazada", ventaMensaje: r.message };
  return { ...base, venta: "registrada" };
}
