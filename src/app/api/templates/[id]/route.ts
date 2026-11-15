import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { serializeTemplate } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({ hidden: z.boolean() });

/**
 * 071 — Ocultar una plantilla del redactor (p. ej. «hello_world», la de muestra
 * de Meta). Solo en el CRM: en Meta sigue igual, y se puede volver a mostrar.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra oculta plantillas");
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  const rows = await getDb()
    .update(schema.template)
    .set({ hidden: body.data.hidden, updatedAt: new Date() })
    .where(scoped(schema.template.organizationId, session.organizationId, eq(schema.template.id, id)))
    .returning();
  if (!rows[0]) return apiError(404, "not_found", "Plantilla no encontrada");
  return Response.json({ template: serializeTemplate(rows[0]) });
});
