import { parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { seguimientoSchema } from "@/lib/seguimiento-demo";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { bookingErrorResponse } from "@/server/agenda/http";
import { guardarSeguimiento, notasDeCita } from "@/server/agenda/seguimiento";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 082 — Las notas de lo que pasó en la demo. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const { id } = await ctx.params;
  try {
    return Response.json({ notas: await notasDeCita({ ...session, configura: canConfigure(session.role) }, id) });
  } catch (err) {
    return bookingErrorResponse(err);
  }
});

/** 082 — Escribir una nota y/o decir qué sigue. No envía nada al cliente. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, seguimientoSchema);
  if (!body.ok) return body.response;
  try {
    const quien = { ...session, configura: canConfigure(session.role) };
    return Response.json({ ok: true, nota: await guardarSeguimiento(quien, id, body.data) });
  } catch (err) {
    return bookingErrorResponse(err);
  }
});
