import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { atribuir, comisionDe, netoDe, normalizarCodigo, periodoDe, type Canal } from "@/lib/comisiones";
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
  /** 080 — El lead exacto, por el enlace de registro personalizado. */
  crmRef?: string | null;
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
  // 069 — ¿Alguien del equipo ya la había registrado a mano (otro WhatsApp u
  // otro canal)? Se reconoce por el correo del cliente.
  const manual =
    (await ventaManualDe(organizationId, pago.email)) ??
    // 080 — O la marcó «Activado» a mano en el chat (venta ligada al lead).
    (conLead?.leadId ? await ventaManualDeLead(organizationId, conLead.leadId) : null);
  const { userId, fuente } = atribuir({
    codigo: pago.codigo,
    duenosDeCodigo: await duenosDeCodigoHoy(organizationId),
    registradaPor: manual?.attributedUserId ?? null,
    responsableUserId: conLead?.assignedUserId ?? null,
  });
  const channel: Canal | null =
    fuente === "codigo"
      ? "codigo"
      : fuente === "manual"
        ? ((manual?.channel as Canal | null) ?? "otro")
        : fuente === "responsable"
          ? "whatsapp_crm"
          : null;

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
      channel,
      customerEmail: pago.email?.trim().toLowerCase() || null,
      note: manual ? `Registrada a mano antes del pago (${manual.customerName ?? "sin nombre"})` : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.sale.id });
  // Dos avisos iguales a la vez: el segundo choca con el índice único.
  if (res.length === 0) return { nueva: false, saleId: null, atribuidaA: null };
  // La venta manual queda reemplazada por el pago real: no cuenta dos veces.
  if (manual) {
    await db
      .update(schema.sale)
      .set({ status: "reemplazada", reviewNote: "Llegó el pago real de la plataforma", updatedAt: new Date() })
      .where(scoped(schema.sale.organizationId, organizationId, eq(schema.sale.id, manual.id)));
  }
  return { nueva: true, saleId: id, atribuidaA: userId };
}

/** La venta manual vigente (por confirmar o confirmada) de un cliente, por correo. */
async function ventaManualDeLead(organizationId: string, leadId: string) {
  const rows = await getDb()
    .select()
    .from(schema.sale)
    .where(
      scoped(
        schema.sale.organizationId,
        organizationId,
        eq(schema.sale.origin, "manual"),
        eq(schema.sale.leadId, leadId),
        or(eq(schema.sale.status, "por_confirmar"), eq(schema.sale.status, "confirmada")),
        isNull(schema.sale.voidedAt)
      )
    )
    .orderBy(schema.sale.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

async function ventaManualDe(organizationId: string, email: string | null | undefined) {
  const correo = email?.trim().toLowerCase();
  if (!correo) return null;
  const rows = await getDb()
    .select()
    .from(schema.sale)
    .where(
      scoped(
        schema.sale.organizationId,
        organizationId,
        eq(schema.sale.origin, "manual"),
        or(eq(schema.sale.status, "por_confirmar"), eq(schema.sale.status, "confirmada")),
        isNull(schema.sale.voidedAt),
        sql`lower(${schema.sale.customerEmail}) = ${correo}`
      )
    )
    .orderBy(schema.sale.createdAt)
    .limit(1);
  return rows[0] ?? null;
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
      adjustmentCents = -comisionDe(netoDe(venta.amountCents, guardada.ivaBps), guardada.rateBps);
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

export type VentaManualInput = {
  /** Solo un admin elige a quién; una vendedora la registra a su nombre. */
  userId?: string | null;
  cliente: string;
  email?: string | null;
  canal: Canal;
  montoCents: number;
  pagadoEn: Date;
  nota?: string | null;
  /** 076 — Si se marcó desde el chat: de qué lead y contacto es la venta. */
  leadId?: string | null;
  contactId?: string | null;
};

/**
 * 069 — Una venta que entró por otro WhatsApp u otro canal y que el aviso de
 * la plataforma no va a atribuir bien. La registra quien la hizo y queda
 * «por confirmar» hasta que un admin la revise; la que registra un admin
 * queda confirmada. Si después llega el pago real con ese correo, el pago la
 * reemplaza (ver `registrarPago`).
 */
export async function registrarVentaManual(
  organizationId: string,
  actor: { userId: string; admin: boolean },
  input: VentaManualInput
): Promise<{ ok: true; id: string } | { ok: false; status: number; code: string; message: string }> {
  const db = getDb();
  const userId = actor.admin ? (input.userId ?? actor.userId) : actor.userId;
  const miembro = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId)))
    .limit(1);
  if (miembro.length === 0) {
    return { ok: false, status: 422, code: "no_member", message: "Esa persona no es del equipo" };
  }
  const correo = input.email?.trim().toLowerCase() || null;
  if (correo) {
    const yaPagada = await db
      .select({ id: schema.sale.id })
      .from(schema.sale)
      .where(
        scoped(
          schema.sale.organizationId,
          organizationId,
          eq(schema.sale.origin, "plataforma"),
          ne(schema.sale.status, "rechazada"),
          sql`lower(${schema.sale.customerEmail}) = ${correo}`
        )
      )
      .limit(1);
    if (yaPagada.length > 0) {
      return {
        ok: false,
        status: 409,
        code: "ya_registrada",
        message: "Ese cliente ya tiene su pago en la plataforma: pide que te reasignen esa venta",
      };
    }
  }
  const tz = await businessTimezone(organizationId);
  if (await liquidacionGuardada(organizationId, userId, periodoDe(input.pagadoEn, tz))) {
    return { ok: false, status: 409, code: "mes_aprobado", message: "Ese mes ya está aprobado para esa persona" };
  }

  const id = newId("sale");
  await db.insert(schema.sale).values({
    id,
    organizationId,
    platformOrgId: `manual:${id}`,
    paymentRef: `manual:${id}`,
    origin: "manual",
    customerName: input.cliente.trim(),
    customerEmail: correo,
    leadId: input.leadId ?? null,
    contactId: input.contactId ?? null,
    amountCents: input.montoCents,
    currency: "COP",
    paidAt: input.pagadoEn,
    attributedUserId: userId,
    attributionSource: "manual",
    channel: input.canal,
    status: actor.admin ? "confirmada" : "por_confirmar",
    note: input.nota?.trim() || null,
    createdBy: actor.userId,
    reviewedBy: actor.admin ? actor.userId : null,
    reviewedAt: actor.admin ? new Date() : null,
  });
  return { ok: true, id };
}

/** 069 — Un admin confirma o rechaza una venta registrada a mano. */
export async function revisarVentaManual(
  organizationId: string,
  actorUserId: string,
  saleId: string,
  accion: "confirmar" | "rechazar",
  nota: string | null
): Promise<AccionResultado> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.sale)
    .where(scoped(schema.sale.organizationId, organizationId, eq(schema.sale.id, saleId)))
    .limit(1);
  const venta = rows[0];
  if (!venta || venta.origin !== "manual") {
    return { ok: false, status: 404, code: "not_found", message: "No existe esa venta registrada a mano" };
  }
  if (venta.status !== "por_confirmar") {
    return { ok: false, status: 409, code: "ya_revisada", message: "Esa venta ya se revisó" };
  }
  if (accion === "rechazar" && !nota?.trim()) {
    return { ok: false, status: 422, code: "motivo", message: "Escribe por qué se rechaza" };
  }
  const tz = await businessTimezone(organizationId);
  if (
    venta.attributedUserId &&
    (await liquidacionGuardada(organizationId, venta.attributedUserId, periodoDe(venta.paidAt, tz)))
  ) {
    return { ok: false, status: 409, code: "mes_aprobado", message: "Ese mes ya está aprobado; reábrelo primero" };
  }
  await db
    .update(schema.sale)
    .set({
      status: accion === "confirmar" ? "confirmada" : "rechazada",
      reviewedBy: actorUserId,
      reviewedAt: new Date(),
      reviewNote: nota?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      scoped(schema.sale.organizationId, organizationId, and(eq(schema.sale.id, saleId), eq(schema.sale.status, "por_confirmar")))
    );
  return { ok: true };
}
