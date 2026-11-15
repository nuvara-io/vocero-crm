import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { aplicarAvisoPlataforma } from "@/server/bot/plataforma";
import { comisionesEnabled } from "@/server/comisiones/flag";
import { anularPago, registrarPago } from "@/server/comisiones/ventas";

export const dynamic = "force-dynamic";

const contacto = {
  telefono: z.string().max(40).nullish(),
  email: z.string().email().max(200).nullish(),
};

const avisoEtapaSchema = z
  .object({
    ...contacto,
    estado: z.enum(["registrado", "activado"]),
    etapaRegistrado: z.string().min(1).max(200).optional(),
    archivar: z.boolean().optional(),
  })
  .refine((a) => Boolean(a.telefono || a.email), {
    message: "Hace falta teléfono o correo",
  });

/**
 * 068 — El primer pago confirmado del cliente. Además de registrar la venta
 * (con la bandera COMISIONES), hace lo mismo que `activado`.
 */
const avisoPagadoSchema = z.object({
  ...contacto,
  estado: z.literal("pagado"),
  platformOrgId: z.string().min(1).max(120),
  nombre: z.string().max(200).nullish(),
  codigo: z.string().max(60).nullish(),
  montoCents: z.number().int().positive().max(1_000_000_000_000),
  moneda: z.string().length(3).nullish(),
  pagadoEn: z.string().datetime({ offset: true }),
  referenciaPago: z.string().min(1).max(200),
  archivar: z.boolean().optional(),
});

/** 068 — El pago se reversó (reverso de la pasarela, devolución). */
const avisoAnuladoSchema = z
  .object({
    estado: z.literal("anulado"),
    platformOrgId: z.string().min(1).max(120).nullish(),
    referenciaPago: z.string().min(1).max(200).nullish(),
    motivo: z.string().max(300).nullish(),
  })
  .refine((a) => Boolean(a.platformOrgId || a.referenciaPago), {
    message: "Hace falta platformOrgId o referenciaPago",
  });

const avisoSchema = z.union([avisoPagadoSchema, avisoAnuladoSchema, avisoEtapaSchema]);

const bodySchema = z.object({
  avisos: z.array(avisoSchema).min(1).max(500),
});

/**
 * 067 — La plataforma del negocio (con la llave del bot) avisa quiénes ya se
 * registraron o activaron su cuenta. Idempotente: el mismo lote cada noche no
 * mueve a nadie dos veces ni hacia atrás. Ver `src/server/bot/plataforma.ts`.
 *
 * 068 — `pagado` registra la venta para comisiones y `anulado` la reversa.
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

  const comisiones = comisionesEnabled();
  const total = { encontrados: 0, movidos: 0, archivados: 0, ventasNuevas: 0, anuladas: 0 };
  for (const aviso of body.data.avisos) {
    if (aviso.estado === "anulado") {
      if (comisiones) {
        const r = await anularPago(organizationId, aviso);
        if (r.anulada) total.anuladas++;
      }
      continue;
    }
    if (aviso.estado === "pagado") {
      if (comisiones) {
        const r = await registrarPago(organizationId, { ...aviso, pagadoEn: new Date(aviso.pagadoEn) });
        if (r.nueva) total.ventasNuevas++;
      }
      if (!aviso.telefono && !aviso.email) continue;
    }
    const r = await aplicarAvisoPlataforma(organizationId, {
      telefono: aviso.telefono,
      email: aviso.email,
      estado: aviso.estado === "pagado" ? "activado" : aviso.estado,
      etapaRegistrado: "etapaRegistrado" in aviso ? aviso.etapaRegistrado : undefined,
      archivar: aviso.archivar,
    });
    total.encontrados += r.encontrados;
    total.movidos += r.movidos;
    total.archivados += r.archivados;
  }
  return Response.json({ ok: true, ...total });
}
