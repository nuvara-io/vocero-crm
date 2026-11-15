import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { ajustesCrm, guardarAjustesCrm } from "@/server/crm-ajustes";
import { ultimosSeguimientos } from "@/server/seguimiento/runner";

export const dynamic = "force-dynamic";

/** 071 — Reparto de leads nuevos y seguimiento automático. */
export const GET = withAuth(async (session) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra ve estos ajustes");
  const org = session.organizationId;
  const db = getDb();
  const [ajustes, equipo, plantillas, ultimos] = await Promise.all([
    ajustesCrm(org),
    db
      .select({ userId: schema.member.userId, name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(scoped(schema.member.organizationId, org)),
    db
      .select({ id: schema.template.id, name: schema.template.name, body: schema.template.body, hidden: schema.template.hidden })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, org, eq(schema.template.status, "approved"))),
    ultimosSeguimientos(org),
  ]);
  return Response.json({
    ajustes,
    equipo,
    plantillas: plantillas.filter((p) => !p.hidden),
    ultimos: ultimos.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
  });
});

const responsableSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("nadie") }),
  z.object({ modo: z.literal("fijo"), userId: z.string().min(1) }),
  z.object({ modo: z.literal("rotacion"), userIds: z.array(z.string().min(1)).min(1).max(50) }),
]);

const seguimientoSchema = z.object({
  enabled: z.boolean(),
  pasos: z
    .array(z.object({ dias: z.number().int().min(1).max(60), templateId: z.string().min(1) }))
    .max(3),
  archivarDias: z.number().int().min(0).max(120),
});

const putSchema = z.object({
  responsable: responsableSchema.optional(),
  seguimiento: seguimientoSchema.optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia estos ajustes");
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const ajustes = await guardarAjustesCrm(session.organizationId, body.data);
  return Response.json({ ok: true, ajustes });
});
