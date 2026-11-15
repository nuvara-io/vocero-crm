import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { diaDe, normalizarCodigo, perfilVigente, type PerfilComision } from "@/lib/comisiones";
import { businessTimezone } from "@/server/analytics/period";

/**
 * 068 — Perfiles comerciales. Versionados: guardar es SIEMPRE insertar una
 * versión nueva; nunca se edita ni se borra una vieja, porque la liquidación
 * de un mes pasado tiene que poder recalcularse con lo que regía entonces.
 */

export type VersionPerfil = PerfilComision & { id: string; createdBy: string | null };

export async function versionesDePerfiles(organizationId: string): Promise<VersionPerfil[]> {
  const rows = await getDb()
    .select()
    .from(schema.commissionProfile)
    .where(scoped(schema.commissionProfile.organizationId, organizationId))
    .orderBy(desc(schema.commissionProfile.validFrom), desc(schema.commissionProfile.createdAt));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    comisiona: r.comisiona,
    rateBps: r.rateBps,
    monthlyBaseCents: r.monthlyBaseCents,
    referralCode: r.referralCode,
    validFrom: r.validFrom,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  }));
}

/** userId → versiones (de la más nueva a la más vieja). */
export function agruparPorUsuario<V extends { userId: string }>(versiones: readonly V[]): Map<string, V[]> {
  const mapa = new Map<string, V[]>();
  for (const v of versiones) {
    const lista = mapa.get(v.userId) ?? [];
    lista.push(v);
    mapa.set(v.userId, lista);
  }
  return mapa;
}

/** Perfil vigente de cada persona en un día. */
export function vigentesEn(
  porUsuario: ReadonlyMap<string, readonly VersionPerfil[]>,
  dia: string
): Map<string, VersionPerfil> {
  const mapa = new Map<string, VersionPerfil>();
  for (const [userId, versiones] of porUsuario) {
    const v = perfilVigente(versiones, dia);
    if (v) mapa.set(userId, v);
  }
  return mapa;
}

/** Código → userId con los perfiles vigentes HOY. */
export async function duenosDeCodigoHoy(organizationId: string, ahora = new Date()): Promise<Map<string, string>> {
  const tz = await businessTimezone(organizationId);
  const vigentes = vigentesEn(agruparPorUsuario(await versionesDePerfiles(organizationId)), diaDe(ahora, tz));
  const mapa = new Map<string, string>();
  for (const v of vigentes.values()) {
    if (v.referralCode) mapa.set(v.referralCode, v.userId);
  }
  return mapa;
}

export type GuardarPerfilInput = {
  userId: string;
  comisiona: boolean;
  rateBps: number;
  monthlyBaseCents: number;
  referralCode: string | null;
  /** AAAA-MM-DD; por defecto hoy en la zona del negocio. */
  validFrom?: string;
};

export type GuardarPerfilResultado =
  | { ok: true; id: string }
  | { ok: false; code: "no_member" | "codigo_invalido" | "codigo_en_uso"; message: string };

export async function guardarPerfil(
  organizationId: string,
  actorUserId: string,
  input: GuardarPerfilInput
): Promise<GuardarPerfilResultado> {
  const db = getDb();
  const miembro = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, input.userId)))
    .limit(1);
  if (miembro.length === 0) {
    return { ok: false, code: "no_member", message: "Esa persona no es del equipo" };
  }

  let codigo: string | null = null;
  if (input.referralCode && input.referralCode.trim()) {
    codigo = normalizarCodigo(input.referralCode);
    if (!codigo) {
      return {
        ok: false,
        code: "codigo_invalido",
        message: "El código va de 2 a 30 letras o números, sin espacios",
      };
    }
    const duenos = await duenosDeCodigoHoy(organizationId);
    const dueno = duenos.get(codigo);
    if (dueno && dueno !== input.userId) {
      return { ok: false, code: "codigo_en_uso", message: `El código ${codigo} ya es de otra persona` };
    }
  }

  const tz = await businessTimezone(organizationId);
  const id = newId("commissionProfile");
  await db.insert(schema.commissionProfile).values({
    id,
    organizationId,
    userId: input.userId,
    comisiona: input.comisiona,
    rateBps: input.comisiona ? input.rateBps : 0,
    monthlyBaseCents: input.comisiona ? input.monthlyBaseCents : 0,
    referralCode: codigo,
    validFrom: input.validFrom ?? diaDe(new Date(), tz),
    createdBy: actorUserId,
  });
  return { ok: true, id };
}
