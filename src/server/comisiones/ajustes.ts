import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 069 — IVA incluido en los pagos (puntos básicos: 1900 = 19 %). La base y el
 * porcentaje se calculan sobre el neto. Sin fila guardada rige el 19 %; un
 * admin lo cambia en Ajustes → Equipo (0 = los pagos ya llegan netos).
 */
export const IVA_POR_DEFECTO_BPS = 1900;

export async function ivaBpsDe(organizationId: string): Promise<number> {
  const rows = await getDb()
    .select({ ivaBps: schema.commissionSettings.ivaBps })
    .from(schema.commissionSettings)
    .where(scoped(schema.commissionSettings.organizationId, organizationId))
    .limit(1);
  return rows[0]?.ivaBps ?? IVA_POR_DEFECTO_BPS;
}

export async function guardarIvaBps(organizationId: string, actorUserId: string, ivaBps: number): Promise<void> {
  await getDb()
    .insert(schema.commissionSettings)
    .values({ organizationId, ivaBps, updatedBy: actorUserId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.commissionSettings.organizationId,
      set: { ivaBps, updatedBy: actorUserId, updatedAt: new Date() },
    });
}
