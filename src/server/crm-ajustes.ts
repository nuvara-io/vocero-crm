import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  RECORDATORIO_POR_DEFECTO,
  SEGUIMIENTO_POR_DEFECTO,
  type AjustesNoAsistio,
  type AjustesRecordatorio,
  type AjustesSeguimiento,
  type FinalEtapa,
  type PasoSeguimiento,
  type ReglaResponsable,
  type SecuenciaEtapa,
} from "@/lib/crm-reglas";
import type { ModoFiltroPerfil } from "@/lib/perfil";

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
  /** 073 — Valor que toma un lead al entrar a «Demo agendada» si no tiene uno. */
  valorDemoCents: number | null;
  /** 073 — Recuperar a quien no asistió: mensaje a los N minutos y otro al día. */
  noAsistio: AjustesNoAsistio;
  /** 077 — Recordatorio automático N minutos antes de la demo. */
  recordatorio: AjustesRecordatorio;
  /** 078 — Filtro de leads fuera de perfil (préstamos, empleo…). */
  filtroPerfil: { modo: ModoFiltroPerfil };
};

export type { AjustesNoAsistio };

export const NO_ASISTIO_POR_DEFECTO: AjustesNoAsistio = {
  enabled: false,
  minutos: 10,
  plantilla1: null,
  dias2: 1,
  plantilla2: null,
};

export const AJUSTES_CRM_POR_DEFECTO: AjustesCrm = {
  responsable: { modo: "nadie" },
  seguimiento: SEGUIMIENTO_POR_DEFECTO,
  prospeccion: { ...SEGUIMIENTO_POR_DEFECTO, archivarDias: 0 },
  valorDemoCents: null,
  noAsistio: NO_ASISTIO_POR_DEFECTO,
  recordatorio: RECORDATORIO_POR_DEFECTO,
  filtroPerfil: { modo: "apagado" },
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

export function normalizar(raw: unknown): AjustesCrm {
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
    valorDemoCents:
      Number.isFinite(r.valorDemoCents) && Number(r.valorDemoCents) > 0 ? Math.round(Number(r.valorDemoCents)) : null,
    noAsistio: normalizarNoAsistio(r.noAsistio),
    recordatorio: normalizarRecordatorio(r.recordatorio),
    filtroPerfil: normalizarFiltroPerfil(r.filtroPerfil),
  };
}

function normalizarFiltroPerfil(raw: unknown): { modo: ModoFiltroPerfil } {
  const m = (typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).modo : null) as unknown;
  return { modo: m === "marcar" || m === "automatico" ? m : "apagado" };
}

function normalizarRecordatorio(raw: unknown): AjustesRecordatorio {
  const n = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const plantilla = typeof n.plantilla === "string" && n.plantilla ? n.plantilla : null;
  const minutos = Number.isFinite(n.minutos) ? Math.min(240, Math.max(5, Math.floor(Number(n.minutos)))) : 15;
  return { enabled: n.enabled === true && plantilla !== null, minutos, plantilla };
}

const FINALES: readonly FinalEtapa[] = ["archivar", "perdido", "nada"];

function normalizarPasos(raw: unknown): PasoSeguimiento[] {
  return Array.isArray(raw)
    ? raw
        .map((p) => p as Record<string, unknown>)
        .filter((p) => typeof p.templateId === "string" && p.templateId && Number.isFinite(p.dias))
        .map((p) => ({ dias: Math.max(1, Math.floor(Number(p.dias))), templateId: String(p.templateId) }))
        .slice(0, 3)
    : [];
}

function normalizarPorEtapa(raw: unknown): SecuenciaEtapa[] {
  if (!Array.isArray(raw)) return [];
  const vistas = new Set<string>();
  const out: SecuenciaEtapa[] = [];
  for (const x of raw) {
    const e = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
    if (typeof e.stageId !== "string" || !e.stageId || vistas.has(e.stageId)) continue;
    vistas.add(e.stageId);
    const final = FINALES.includes(e.final as FinalEtapa) ? (e.final as FinalEtapa) : "archivar";
    const finalDias = Number.isFinite(e.finalDias) ? Math.max(0, Math.floor(Number(e.finalDias))) : 0;
    out.push({ stageId: e.stageId, pasos: normalizarPasos(e.pasos), finalDias, final });
  }
  return out.slice(0, 30);
}

function normalizarNoAsistio(raw: unknown): AjustesNoAsistio {
  const n = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const plantilla1 = str(n.plantilla1);
  const num = (v: unknown, d: number, min: number, max: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(Number(v)))) : d;
  return {
    enabled: n.enabled === true && plantilla1 !== null,
    minutos: num(n.minutos, 10, 1, 240),
    plantilla1,
    dias2: num(n.dias2, 1, 1, 14),
    plantilla2: str(n.plantilla2),
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
  const porEtapa = normalizarPorEtapa(seg.porEtapa);
  return {
    enabled: seg.enabled === true && (pasos.length > 0 || archivarDias > 0 || porEtapa.length > 0),
    pasos,
    archivarDias,
    porEtapa,
    incluirAtendidos: seg.incluirAtendidos === true,
  };
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
