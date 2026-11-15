import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { leerHojaDeFirmas } from "@/lib/prospeccion";
import { importarProspectos } from "@/server/prospeccion";

import { prospeccionEnabled } from "@/server/prospeccion-flag";

export const dynamic = "force-dynamic";

const celda = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const bodySchema = z.object({
  lista: z.string().trim().min(2).max(80),
  /** La hoja tal cual (filas de celdas): el servidor la vuelve a leer. */
  filas: z.array(z.array(celda).max(60)).min(2).max(2001),
});

/**
 * 072 — Importar la lista de firmas (el Excel del equipo). Re-ejecutable: quien
 * ya está en el CRM no se duplica y se reporta.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!prospeccionEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra importa prospectos");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { filas, problemas } = leerHojaDeFirmas(body.data.filas);
  if (filas.length === 0) {
    return apiError(422, "sin_filas", problemas[0]?.motivo ?? "No hay filas para importar");
  }
  const r = await importarProspectos(session.organizationId, body.data.lista, filas);
  return Response.json({ ok: true, ...r, problemas });
});
