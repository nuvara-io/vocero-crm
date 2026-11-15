import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  liquidar,
  periodoDe,
  periodoSiguiente,
  ultimoDiaDe,
  type Liquidacion,
} from "@/lib/comisiones";
import { zonedWallClockToUtc } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { ivaBpsDe } from "@/server/comisiones/ajustes";
import { agruparPorUsuario, versionesDePerfiles, vigentesEn } from "@/server/comisiones/perfiles";

/**
 * 068 — La liquidación mensual. Un mes `pendiente` no se guarda: se calcula al
 * consultarlo, así que una venta que llega tarde o una corrección de perfil
 * se ve de inmediato. Al aprobarlo se congela en `commission_settlement` con
 * el %, la base y los totales copiados; desde ahí nada lo cambia.
 */

export type Settlement = typeof schema.commissionSettlement.$inferSelect;
export type Sale = typeof schema.sale.$inferSelect;

export type EstadoLiquidacion = "pendiente" | "aprobada" | "pagada";

export type VentaDto = {
  id: string;
  customerName: string | null;
  platformOrgId: string;
  contactId: string | null;
  amountCents: number;
  paidAt: string;
  referralCode: string | null;
  attributionSource: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** 069 */
  origin: "plataforma" | "manual";
  channel: string | null;
  status: "por_confirmar" | "confirmada" | "rechazada" | "reemplazada";
  customerEmail: string | null;
  note: string | null;
  reviewNote: string | null;
  createdByName: string | null;
};

export type FilaLiquidacion = {
  userId: string;
  name: string;
  email: string;
  estado: EstadoLiquidacion;
  liquidacion: Liquidacion;
  approvedAt: string | null;
  approvedByName: string | null;
  paidAt: string | null;
  paidByName: string | null;
  note: string | null;
  ventas: VentaDto[];
  /** Pagos anulados de meses ya aprobados que se descuentan en este. */
  descuentos: (VentaDto & { adjustmentCents: number })[];
};

export type ResumenMes = {
  period: string;
  timezone: string;
  /** El mes ya terminó: solo entonces se puede aprobar. */
  cerrado: boolean;
  filas: FilaLiquidacion[];
  sinAtribuir: VentaDto[];
  /** 069 — Ventas registradas a mano que esperan la confirmación de un admin. */
  porConfirmar: (VentaDto & { attributedUserId: string | null; attributedName: string | null })[];
  /** 069 — IVA vigente para los meses sin aprobar. */
  ivaBps: number;
};

export function rangoDelPeriodo(period: string, tz: string): { start: Date; end: Date } {
  const start = zonedWallClockToUtc(`${period}-01`, "00:00", tz);
  const end = zonedWallClockToUtc(`${periodoSiguiente(period)}-01`, "00:00", tz);
  if (!start || !end) throw new Error(`Periodo inválido: ${period}`);
  return { start, end };
}

/** Solo una venta confirmada y sin anular cuenta para comisiones. */
export function cuenta(s: Pick<Sale, "status" | "voidedAt">): boolean {
  return s.status === "confirmada" && !s.voidedAt;
}

function ventaDto(s: Sale, nombres?: ReadonlyMap<string, { name: string }>): VentaDto {
  return {
    id: s.id,
    customerName: s.customerName,
    platformOrgId: s.platformOrgId,
    contactId: s.contactId,
    amountCents: s.amountCents,
    paidAt: s.paidAt.toISOString(),
    referralCode: s.referralCode,
    attributionSource: s.attributionSource,
    voidedAt: s.voidedAt?.toISOString() ?? null,
    voidReason: s.voidReason,
    origin: s.origin,
    channel: s.channel,
    status: s.status,
    customerEmail: s.customerEmail,
    note: s.note,
    reviewNote: s.reviewNote,
    createdByName: s.createdBy ? (nombres?.get(s.createdBy)?.name ?? null) : null,
  };
}

export async function liquidacionGuardada(
  organizationId: string,
  userId: string,
  period: string
): Promise<Settlement | null> {
  const rows = await getDb()
    .select()
    .from(schema.commissionSettlement)
    .where(
      scoped(
        schema.commissionSettlement.organizationId,
        organizationId,
        eq(schema.commissionSettlement.userId, userId),
        eq(schema.commissionSettlement.period, period)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** El primer mes desde `desde` que esa persona todavía no tiene aprobado. */
export async function primerMesAbierto(
  organizationId: string,
  userId: string,
  desde: string
): Promise<string> {
  let period = desde;
  // Un tope generoso: nadie aprueba años por adelantado.
  for (let i = 0; i < 36; i++) {
    if (!(await liquidacionGuardada(organizationId, userId, period))) return period;
    period = periodoSiguiente(period);
  }
  return period;
}

export async function resumenMes(
  organizationId: string,
  period: string,
  opciones: { soloUserId?: string; ahora?: Date } = {}
): Promise<ResumenMes> {
  const db = getDb();
  const tz = await businessTimezone(organizationId);
  const ahora = opciones.ahora ?? new Date();
  const { start, end } = rangoDelPeriodo(period, tz);

  const [miembros, versiones, ventas, guardadas, descuentos, ivaBps, pendientes] = await Promise.all([
    db
      .select({ userId: schema.member.userId, name: schema.user.name, email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(scoped(schema.member.organizationId, organizationId)),
    versionesDePerfiles(organizationId),
    db
      .select()
      .from(schema.sale)
      .where(
        scoped(schema.sale.organizationId, organizationId, gte(schema.sale.paidAt, start), lt(schema.sale.paidAt, end))
      )
      .orderBy(schema.sale.paidAt),
    db
      .select()
      .from(schema.commissionSettlement)
      .where(
        scoped(
          schema.commissionSettlement.organizationId,
          organizationId,
          eq(schema.commissionSettlement.period, period)
        )
      ),
    db
      .select()
      .from(schema.sale)
      .where(
        scoped(
          schema.sale.organizationId,
          organizationId,
          eq(schema.sale.adjustmentPeriod, period),
          isNotNull(schema.sale.adjustmentCents)
        )
      ),
    ivaBpsDe(organizationId),
    // Las por confirmar se muestran sin importar el mes: esperan a alguien.
    db
      .select()
      .from(schema.sale)
      .where(scoped(schema.sale.organizationId, organizationId, eq(schema.sale.status, "por_confirmar")))
      .orderBy(schema.sale.paidAt),
  ]);

  const nombres = new Map(miembros.map((m) => [m.userId, m]));
  const vigentes = vigentesEn(agruparPorUsuario(versiones), ultimoDiaDe(period));
  const guardadaDe = new Map(guardadas.map((g) => [g.userId, g]));

  const userIds = new Set<string>();
  // Quien comisiona aparece aunque no lleve ventas (para ver cuánto le falta);
  // un socio sin movimiento en el mes no ocupa espacio.
  for (const [userId, v] of vigentes) if (v.comisiona && nombres.has(userId)) userIds.add(userId);
  for (const s of ventas) if (s.attributedUserId && s.status !== "reemplazada") userIds.add(s.attributedUserId);
  for (const g of guardadas) userIds.add(g.userId);
  for (const d of descuentos) if (d.attributedUserId) userIds.add(d.attributedUserId);

  const filas: FilaLiquidacion[] = [];
  for (const userId of userIds) {
    if (opciones.soloUserId && userId !== opciones.soloUserId) continue;
    const persona = nombres.get(userId);
    const suyas = ventas.filter((s) => s.attributedUserId === userId && s.status !== "reemplazada");
    const validas = suyas.filter(cuenta);
    const susDescuentos = descuentos.filter((d) => d.attributedUserId === userId);
    const guardada = guardadaDe.get(userId) ?? null;

    let liquidacion: Liquidacion;
    if (guardada) {
      liquidacion = {
        salesCount: guardada.salesCount,
        salesTotalCents: guardada.salesTotalCents,
        ivaBps: guardada.ivaBps,
        salesNetCents: guardada.salesNetCents,
        baseCents: guardada.baseCents,
        rateBps: guardada.rateBps,
        comisiona: guardada.rateBps > 0,
        reached: guardada.reached,
        faltaCents: guardada.reached ? 0 : Math.max(0, guardada.baseCents - guardada.salesNetCents),
        brutaCents: guardada.commissionCents - guardada.adjustmentCents,
        adjustmentCents: guardada.adjustmentCents,
        commissionCents: guardada.commissionCents,
      };
    } else {
      liquidacion = liquidar({
        ventasCents: validas.map((s) => s.amountCents),
        perfil: vigentes.get(userId) ?? null,
        ajustesCents: susDescuentos.map((d) => d.adjustmentCents ?? 0),
        ivaBps,
      });
    }

    filas.push({
      userId,
      name: persona?.name ?? "Persona que ya no está en el equipo",
      email: persona?.email ?? "",
      estado: guardada ? guardada.status : "pendiente",
      liquidacion,
      approvedAt: guardada?.approvedAt.toISOString() ?? null,
      approvedByName: guardada?.approvedBy ? (nombres.get(guardada.approvedBy)?.name ?? null) : null,
      paidAt: guardada?.paidAt?.toISOString() ?? null,
      paidByName: guardada?.paidBy ? (nombres.get(guardada.paidBy)?.name ?? null) : null,
      note: guardada?.note ?? null,
      ventas: suyas.map((s) => ventaDto(s, nombres)),
      descuentos: susDescuentos.map((d) => ({ ...ventaDto(d, nombres), adjustmentCents: d.adjustmentCents ?? 0 })),
    });
  }

  // Quien más vendió, arriba.
  filas.sort((a, b) => b.liquidacion.salesTotalCents - a.liquidacion.salesTotalCents || a.name.localeCompare(b.name));

  return {
    period,
    timezone: tz,
    cerrado: period < periodoDe(ahora, tz),
    filas,
    sinAtribuir: opciones.soloUserId
      ? []
      : ventas.filter((s) => !s.attributedUserId && cuenta(s)).map((s) => ventaDto(s, nombres)),
    porConfirmar: pendientes
      .filter((s) => !opciones.soloUserId || s.attributedUserId === opciones.soloUserId)
      .map((s) => ({
        ...ventaDto(s, nombres),
        attributedUserId: s.attributedUserId,
        attributedName: s.attributedUserId ? (nombres.get(s.attributedUserId)?.name ?? null) : null,
      })),
    ivaBps,
  };
}

export type AccionResultado =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export async function aprobarLiquidacion(
  organizationId: string,
  actorUserId: string,
  userId: string,
  period: string,
  note: string | null
): Promise<AccionResultado> {
  const resumen = await resumenMes(organizationId, period, { soloUserId: userId });
  if (!resumen.cerrado) {
    return { ok: false, status: 409, code: "mes_abierto", message: "El mes todavía no termina" };
  }
  const fila = resumen.filas[0];
  if (!fila) return { ok: false, status: 404, code: "sin_datos", message: "No hay nada que liquidar" };
  if (fila.estado !== "pendiente") {
    return { ok: false, status: 409, code: "ya_aprobada", message: "Ese mes ya está aprobado" };
  }
  const l = fila.liquidacion;
  const res = await getDb()
    .insert(schema.commissionSettlement)
    .values({
      id: newId("commissionSettlement"),
      organizationId,
      userId,
      period,
      salesCount: l.salesCount,
      salesTotalCents: l.salesTotalCents,
      ivaBps: l.ivaBps,
      salesNetCents: l.salesNetCents,
      baseCents: l.baseCents,
      rateBps: l.rateBps,
      reached: l.reached,
      adjustmentCents: l.adjustmentCents,
      commissionCents: l.commissionCents,
      status: "aprobada",
      approvedBy: actorUserId,
      approvedAt: new Date(),
      note: note?.trim() || null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.commissionSettlement.id });
  if (res.length === 0) {
    return { ok: false, status: 409, code: "ya_aprobada", message: "Ese mes ya está aprobado" };
  }
  return { ok: true };
}

export async function marcarPagada(
  organizationId: string,
  actorUserId: string,
  userId: string,
  period: string
): Promise<AccionResultado> {
  const res = await getDb()
    .update(schema.commissionSettlement)
    .set({ status: "pagada", paidBy: actorUserId, paidAt: new Date() })
    .where(
      scoped(
        schema.commissionSettlement.organizationId,
        organizationId,
        eq(schema.commissionSettlement.userId, userId),
        eq(schema.commissionSettlement.period, period),
        eq(schema.commissionSettlement.status, "aprobada")
      )
    )
    .returning({ id: schema.commissionSettlement.id });
  if (res.length === 0) {
    return { ok: false, status: 409, code: "no_aprobada", message: "Solo se marca pagada una liquidación aprobada" };
  }
  return { ok: true };
}

/**
 * Deshacer una aprobación por error. No se puede si ya está pagada, ni si un
 * pago anulado de ese mes ya mandó su descuento a otro mes: reabrir sacaría
 * la venta del cálculo Y la seguiría descontando, dos veces.
 */
export async function reabrirLiquidacion(
  organizationId: string,
  userId: string,
  period: string
): Promise<AccionResultado> {
  const db = getDb();
  const guardada = await liquidacionGuardada(organizationId, userId, period);
  if (!guardada) return { ok: false, status: 404, code: "sin_aprobar", message: "Ese mes no está aprobado" };
  if (guardada.status === "pagada") {
    return { ok: false, status: 409, code: "pagada", message: "Una liquidación pagada no se reabre" };
  }
  const tz = await businessTimezone(organizationId);
  const { start, end } = rangoDelPeriodo(period, tz);
  const conDescuento = await db
    .select({ id: schema.sale.id })
    .from(schema.sale)
    .where(
      scoped(
        schema.sale.organizationId,
        organizationId,
        eq(schema.sale.attributedUserId, userId),
        gte(schema.sale.paidAt, start),
        lt(schema.sale.paidAt, end),
        isNotNull(schema.sale.adjustmentPeriod)
      )
    )
    .limit(1);
  if (conDescuento.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "con_descuentos",
      message: "Un pago anulado de este mes ya se descontó en otro; no se puede reabrir",
    };
  }
  await db
    .delete(schema.commissionSettlement)
    .where(
      and(
        eq(schema.commissionSettlement.id, guardada.id),
        eq(schema.commissionSettlement.organizationId, organizationId),
        eq(schema.commissionSettlement.status, "aprobada")
      )
    );
  return { ok: true };
}

/** CSV del mes para pagar: una fila por persona. */
export function csvDelMes(resumen: ResumenMes): string {
  const pesos = (c: number) => (c / 100).toFixed(2);
  const celda = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const filas = [
    ["Mes", "Persona", "Correo", "Ventas", "Total pagado", "IVA %", "Total neto", "Base", "Llegó a la base", "Porcentaje", "Descuentos", "Comisión", "Estado"],
    ...resumen.filas.map((f) => [
      resumen.period,
      f.name,
      f.email,
      String(f.liquidacion.salesCount),
      pesos(f.liquidacion.salesTotalCents),
      (f.liquidacion.ivaBps / 100).toString(),
      pesos(f.liquidacion.salesNetCents),
      pesos(f.liquidacion.baseCents),
      f.liquidacion.reached ? "Sí" : "No",
      (f.liquidacion.rateBps / 100).toString(),
      pesos(f.liquidacion.adjustmentCents),
      pesos(f.liquidacion.commissionCents),
      f.estado === "pendiente" ? "Pendiente" : f.estado === "aprobada" ? "Aprobada" : "Pagada",
    ]),
  ];
  return filas.map((f) => f.map(celda).join(",")).join("\n") + "\n";
}
