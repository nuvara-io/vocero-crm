import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { diaDe } from "@/lib/comisiones";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { businessTimezone } from "@/server/analytics/period";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { agruparPorUsuario, guardarPerfil, versionesDePerfiles, vigentesEn } from "@/server/comisiones/perfiles";

export const dynamic = "force-dynamic";

/** 068 — Condiciones comerciales de cada persona del equipo, con historial. */
export const GET = withAuth(async (session) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra ve las condiciones");
  const org = session.organizationId;
  const [miembros, versiones, tz] = await Promise.all([
    getDb()
      .select({ userId: schema.member.userId, name: schema.user.name, email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(scoped(schema.member.organizationId, org)),
    versionesDePerfiles(org),
    businessTimezone(org),
  ]);
  const hoy = diaDe(new Date(), tz);
  const porUsuario = agruparPorUsuario(versiones);
  const vigentes = vigentesEn(porUsuario, hoy);
  const dto = (v: (typeof versiones)[number]) => ({
    comisiona: v.comisiona,
    rateBps: v.rateBps,
    monthlyBaseCents: v.monthlyBaseCents,
    referralCode: v.referralCode,
    validFrom: v.validFrom,
    createdAt: v.createdAt.toISOString(),
  });
  return Response.json({
    hoy,
    personas: miembros.map((m) => {
      const vigente = vigentes.get(m.userId);
      return {
        ...m,
        vigente: vigente ? dto(vigente) : null,
        // Versiones que empiezan después de hoy (cambios programados) + historial.
        versiones: (porUsuario.get(m.userId) ?? []).map(dto),
      };
    }),
  });
});

const bodySchema = z.object({
  userId: z.string().min(1),
  comisiona: z.boolean(),
  rateBps: z.number().int().min(0).max(10_000),
  monthlyBaseCents: z.number().int().min(0).max(1_000_000_000_000),
  referralCode: z.string().max(60).nullish(),
  validFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia condiciones");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const r = await guardarPerfil(session.organizationId, session.userId, {
    ...body.data,
    referralCode: body.data.referralCode ?? null,
  });
  if (!r.ok) return apiError(r.code === "no_member" ? 422 : 409, r.code, r.message);
  return Response.json({ ok: true, id: r.id });
});
