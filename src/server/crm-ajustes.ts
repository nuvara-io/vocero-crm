import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  SEGUIMIENTO_POR_DEFECTO,
  type AjustesSeguimiento,
  type ReglaResponsable,
} from "@/lib/crm-reglas";

/**
 * 071 — Ajustes del CRM que no merecen tabla propia: viven en
 * `organization.metadata.crm`, junto a la marca. Se leen con tolerancia: un
 * valor raro vale lo de por defecto, nunca tumba la ingesta.
 */
export type AjustesCrm = {
  responsable: ReglaResponsable;
  seguimiento: AjustesSeguimiento;
  /** 072 — Seguimiento de prospectos (día 2 dato útil, día 6 salida): nunca archiva. */
  prospeccion: AjustesSeguimiento;
};

export const AJUSTES_CRM_POR_DEFECTO: AjustesCrm = {
  responsable: { modo: "nadie" },
  seguimiento: SEGUIMIENTO_POR_DEFECTO,
  prospeccion: { ...SEGUIMIENTO_POR_DEFECTO, archivarDias: 0 },
};

function parse(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const v = JSON.parse(metadata) as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizar(raw: unknown): AjustesCrm {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const resp = (r.responsable ?? {}) as Record<string, unknown>;
  let responsable: ReglaResponsable = { modo: "nadie" };
  if (resp.modo === "fijo" && typeof resp.userId === "string") {
    responsable = { modo: "fijo", userId: resp.userId };
  } else if (resp.modo === "rotacion" && Array.isArray(resp.userIds)) {
    responsable = { modo: "rotacion", userIds: resp.userIds.filter((x): x is string => typeof x === "string") };
  }
  return {
    responsable,
    seguimiento: normalizarSeguimiento(r.seguimiento, SEGUIMIENTO_POR_DEFECTO.archivarDias),
    // Los prospectos nunca se archivan solos: tras el último paso no se les escribe más.
    prospeccion: { ...normalizarSeguimiento(r.prospeccion, 0), archivarDias: 0 },
  };
}

function normalizarSeguimiento(raw: unknown, archivarPorDefecto: number): AjustesSeguimiento {
  const seg = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pasos = Array.isArray(seg.pasos)
    ? seg.pasos
        .map((p) => p as Record<string, unknown>)
        .filter((p) => typeof p.templateId === "string" && Number.isFinite(p.dias))
        .map((p) => ({ dias: Math.max(1, Math.floor(Number(p.dias))), templateId: String(p.templateId) }))
        .slice(0, 3)
    : [];
  const archivarDias = Number.isFinite(seg.archivarDias)
    ? Math.max(0, Math.floor(Number(seg.archivarDias)))
    : archivarPorDefecto;
  return { enabled: seg.enabled === true && (pasos.length > 0 || archivarDias > 0), pasos, archivarDias };
}

export async function ajustesCrm(organizationId: string): Promise<AjustesCrm> {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return normalizar(parse(rows[0]?.metadata ?? null).crm);
}

export async function guardarAjustesCrm(organizationId: string, cambios: Partial<AjustesCrm>): Promise<AjustesCrm> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parse(rows[0]?.metadata ?? null);
  const actual = normalizar(meta.crm);
  const nuevo = normalizar({ ...actual, ...cambios });
  meta.crm = nuevo;
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
  return nuevo;
}
