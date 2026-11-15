import { eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { atribuir, comisionDe, normalizarCodigo, periodoDe } from "@/lib/comisiones";
import { businessTimezone } from "@/server/analytics/period";
import { buscarContactosPlataforma } from "@/server/bot/plataforma";
import { duenosDeCodigoHoy } from "@/server/comisiones/perfiles";
import { liquidacionGuardada, primerMesAbierto, type AccionResultado } from "@/server/comisiones/liquidaciones";

/**
 * 068 — Las ventas. Entran SOLO por el aviso de la plataforma (`pagado`), con
 * el monto que la plataforma cobró: ninguna pantalla crea ni edita montos.
 * Una por cliente; el mismo aviso repetido no duplica nada.
 */

export type PagoPlataforma = {
  platformOrgId: string;
  nombre?: string | null;
  telefono?: string | null;
  email?: string | null;
  codigo?: string | null;
  montoCents: number;
  moneda?: string | null;
  pagadoEn: Date;
  referenciaPago: string;
};

export type RegistroVenta = { nueva: boolean; saleId: string | null; atribuidaA: string | null };

export async function registrarPago(organizationId: string, pago: PagoPlataforma): Promise<RegistroVenta> {
  const db = getDb();
  const existente = await db
    .select({ id: schema.sale.id, attributedUserId: schema.sale.attributedUserId })
    .from(schema.sale)
    .where(
      scoped(
        schema.sale.organizationId,
        organizationId,
        or(eq(schema.sale.platformOrgId, pago.platformOrgId), eq(schema.sale.paymentRef, pago.referenciaPago))
      )
    )
    .limit(1);
  if (existente[0]) {
    return { nueva: false, saleId: existente[0].id, atribuidaA: existente[0].attributedUserId };
  }

  const contactos = await buscarContactosPlataforma(organizationId, pago);
  const conLead = contactos.find((c) => c.leadId) ?? contactos[0] ?? null;
  const { userId, fuente } = atribuir({
    codigo: pago.codigo,
    duenosDeCodigo: await duenosDeCodigoHoy(organizationId),
    responsableUserId: conLead?.assignedUserId ?? null,
  });

  const id = newId("sale");
  const res = await db
    .insert(schema.sale)
    .values({
      id,
      organizationId,
      platformOrgId: pago.platformOrgId,
      customerName: pago.nombre?.trim() || null,
      contactId: conLead?.contactId ?? null,
      leadId: conLead?.leadId ?? null,
      amountCents: pago.montoCents,
      currency: pago.moneda?.trim().toUpperCase() || "COP",
      paidAt: pago.pagadoEn,
      paymentRef: pago.referenciaPago,
      referralCode: normalizarCodigo(pago.codigo),
      attributedUserId: userId,
      attributionSource: fuente,
    })
    .onConflictDoNothing()
    .returning({ id: schema.sale.id });
  // Dos avisos iguales a la vez: el segundo choca con el índice único.
  if (res.length === 0) return { nueva: false, saleId: null, atribuidaA: null };
  return { nueva: true, saleId: id, atribuidaA: userId };
}

/**
 * El pago se reversó en la plataforma. Si su mes no está aprobado, la venta
 * sale del cálculo y ya. Si ya estaba aprobado (y la comisión se generó), se
 * descuenta en el primer mes todavía abierto de esa persona.
 */
export async function anularPago(
  organizationId: string,
  datos: { platformOrgId?: string | null; referenciaPago?: string | null; motivo?: string | null },
  ahora = new Date()
): Promise<{ anulada: boolean }> {
  const db = getDb();
  const condiciones = [
    datos.platformOrgId ? eq(schema.sale.platformOrgId, datos.platformOrgId) : undefined,
    datos.referenciaPago ? eq(schema.sale.paymentRef, datos.referenciaPago) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (condiciones.length === 0) return { anulada: false };

  const rows = await db
    .select()
    .from(schema.sale)
    .where(scoped(schema.sale.organizationId, organizationId, or(...condiciones)))
    .limit(1);
  const venta = rows[0];
  if (!venta || venta.voidedAt) return { anulada: false };

  let adjustmentPeriod: string | null = null;
  let adjustmentCents: number | null = null;
  if (venta.attributedUserId) {
    const tz = await businessTimezone(organizationId);
    const mesDelPago = periodoDe(venta.paidAt, tz);
    const guardada = await liquidacionGuardada(organizationId, venta.attributedUserId, mesDelPago);
    if (guardada?.reached && guardada.rateBps > 0) {
      adjustmentCents = -comisionDe(venta.amountCents, guardada.rateBps);
      adjustmentPeriod = await primerMesAbierto(organizationId, venta.attributedUserId, periodoDe(ahora, tz));
    }
  }

  await db
    .update(schema.sale)
    .set({
      voidedAt: ahora,
      voidReason: datos.motivo?.trim() || "Pago anulado en la plataforma",
      adjustmentPeriod,
      adjustmentCents,
      updatedAt: ahora,
    })
    .where(scoped(schema.sale.organizationId, organizationId, eq(schema.sale.id, venta.id)));
  return { anulada: true };
}

/**
 * Cambiar a quién se le atribuye una venta (o asignar una «Sin atribuir»).
 * Queda en la bitácora con el motivo, y no se puede si el mes ya está
 * aprobado para quien la tenía o para quien la recibe.
 */
export async function reasignarVenta(
  organizationId: string,
  actorUserId: string,
  saleId: string,
  toUserId: string | null,
  motivo: string
): Promise<AccionResultado> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.sale)
    .where(scoped(schema.sale.organizationId, organizationId, eq(schema.sale.id, saleId)))
    .limit(1);
  const venta = rows[0];
  if (!venta) return { ok: false, status: 404, code: "not_found", message: "No existe esa venta" };
  if (venta.voidedAt) {
    return { ok: false, status: 409, code: "anulada", message: "Esa venta se anuló; no se reasigna" };
  }
  if (venta.attributedUserId === toUserId) return { ok: true };

  if (toUserId) {
    const miembro = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, toUserId)))
      .limit(1);
    if (miembro.length === 0) {
      return { ok: false, status: 422, code: "no_member", message: "Esa persona no es del equipo" };
    }
  }

  const tz = await businessTimezone(organizationId);
  const mes = periodoDe(venta.paidAt, tz);
  for (const userId of [venta.attributedUserId, toUserId]) {
    if (userId && (await liquidacionGuardada(organizationId, userId, mes))) {
      return {
        ok: false,
        status: 409,
        code: "mes_aprobado",
        message: "El mes de esa venta ya está aprobado; reábrelo antes de reasignarla",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.sale)
      .set({ attributedUserId: toUserId, attributionSource: toUserId ? "manual" : null, updatedAt: new Date() })
      .where(scoped(schema.sale.organizationId, organizationId, eq(schema.sale.id, saleId)));
    await tx.insert(schema.saleAttributionChange).values({
      id: newId("saleAttributionChange"),
      organizationId,
      saleId,
      fromUserId: venta.attributedUserId,
      toUserId,
      reason: motivo.trim(),
      actorUserId,
    });
  });
  return { ok: true };
}

export type CambioAtribucionDto = {
  fromName: string | null;
  toName: string | null;
  actorName: string | null;
  reason: string;
  createdAt: string;
};

export async function historialDeVenta(organizationId: string, saleId: string): Promise<CambioAtribucionDto[]> {
  const db = getDb();
  const cambios = await db
    .select()
    .from(schema.saleAttributionChange)
    .where(
      scoped(
        schema.saleAttributionChange.organizationId,
        organizationId,
        eq(schema.saleAttributionChange.saleId, saleId)
      )
    )
    .orderBy(schema.saleAttributionChange.createdAt);
  const ids = [
    ...new Set(cambios.flatMap((c) => [c.fromUserId, c.toUserId, c.actorUserId]).filter((v): v is string => !!v)),
  ];
  const personas =
    ids.length > 0
      ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, ids))
      : [];
  const nombre = new Map(personas.map((m) => [m.id, m.name]));
  return cambios.map((c) => ({
    fromName: c.fromUserId ? (nombre.get(c.fromUserId) ?? null) : null,
    toName: c.toUserId ? (nombre.get(c.toUserId) ?? null) : null,
    actorName: c.actorUserId ? (nombre.get(c.actorUserId) ?? null) : null,
    reason: c.reason,
    createdAt: c.createdAt.toISOString(),
  }));
}
