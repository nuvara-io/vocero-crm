import { apiError, withAuth } from "@/lib/api";
import { MetaApiError } from "@/lib/meta/client";
import { obtenerOCrearDataset } from "@/lib/meta/dataset";
import {
  atribucionDisabledResponse,
  atribucionEnabled,
} from "@/server/attribution/flag";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

/**
 * 077 — Trae (o crea) el dataset de la cuenta de WhatsApp conectada, con el
 * mismo token de la conexión. No guarda nada: devuelve el id para que el
 * formulario lo llene y el dueño decida guardar.
 */
export const POST = withAuth(async (session) => {
  if (!atribucionEnabled()) return atribucionDisabledResponse();
  const credentials = await getCredentialsByOrg(session.organizationId);
  if (!credentials) {
    return apiError(409, "sin_whatsapp", "Primero conecta WhatsApp");
  }
  try {
    const r = await obtenerOCrearDataset({
      wabaId: credentials.wabaId,
      token: credentials.token,
    });
    return Response.json(r);
  } catch (err) {
    const msg =
      err instanceof MetaApiError
        ? `Meta no lo permitió: ${err.message}. Revisa que el token tenga el permiso whatsapp_business_manage_events.`
        : "No se pudo obtener el conjunto de datos";
    return apiError(502, "meta_dataset", msg);
  }
});
