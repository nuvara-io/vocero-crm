import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { aplicarAvisoPlataforma } from "@/server/bot/plataforma";

export const dynamic = "force-dynamic";

const avisoSchema = z
  .object({
    telefono: z.string().max(40).nullish(),
    email: z.string().email().max(200).nullish(),
    estado: z.enum(["registrado", "activado"]),
    etapaRegistrado: z.string().min(1).max(200).optional(),
    archivar: z.boolean().optional(),
  })
  .refine((a) => Boolean(a.telefono || a.email), {
    message: "Hace falta teléfono o correo",
  });

const bodySchema = z.object({
  avisos: z.array(avisoSchema).min(1).max(500),
});

/**
 * 067 — La plataforma del negocio (con la llave del bot) avisa quiénes ya se
 * registraron o activaron su cuenta. Idempotente: el mismo lote cada noche no
 * mueve a nadie dos veces ni hacia atrás. Ver `src/server/bot/plataforma.ts`.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const total = { encontrados: 0, movidos: 0, archivados: 0 };
  for (const aviso of body.data.avisos) {
    const r = await aplicarAvisoPlataforma(organizationId, aviso);
    total.encontrados += r.encontrados;
    total.movidos += r.movidos;
    total.archivados += r.archivados;
  }
  return Response.json({ ok: true, ...total });
}
