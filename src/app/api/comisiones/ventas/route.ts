import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { CANALES_MANUALES, diaDe } from "@/lib/comisiones";
import { zonedWallClockToUtc } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { registrarVentaManual } from "@/server/comisiones/ventas";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().min(1).nullish(),
  cliente: z.string().trim().min(2, "Escribe el nombre del cliente").max(200),
  email: z.string().trim().email("Correo inválido").max(200).nullish().or(z.literal("")),
  canal: z.enum(CANALES_MANUALES as [string, ...string[]]),
  montoCents: z.number().int().positive().max(1_000_000_000_000),
  pagadoEn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nota: z.string().max(500).nullish(),
});

/**
 * 069 — Registrar una venta que entró por otro WhatsApp u otro canal. Una
 * vendedora la registra a su nombre y queda por confirmar; un admin puede
 * registrarla para cualquiera y queda confirmada.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const tz = await businessTimezone(session.organizationId);
  if (body.data.pagadoEn > diaDe(new Date(), tz)) {
    return apiError(422, "fecha_futura", "La fecha del pago no puede ser futura");
  }
  const pagadoEn = zonedWallClockToUtc(body.data.pagadoEn, "12:00", tz);
  if (!pagadoEn) return apiError(422, "fecha", "Fecha inválida");

  const r = await registrarVentaManual(
    session.organizationId,
    { userId: session.userId, admin: canConfigure(session.role) },
    {
      userId: body.data.userId ?? null,
      cliente: body.data.cliente,
      email: body.data.email || null,
      canal: body.data.canal as (typeof CANALES_MANUALES)[number],
      montoCents: body.data.montoCents,
      pagadoEn,
      nota: body.data.nota ?? null,
    }
  );
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return Response.json({ ok: true, id: r.id }, { status: 201 });
});
