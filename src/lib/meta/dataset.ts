import { graphRequest } from "@/lib/meta/client";

/**
 * 077 — El conjunto de datos (dataset) de la cuenta de WhatsApp.
 *
 * La Conversions API de mensajería publica en el dataset ligado a la WABA.
 * Meta expone `GET {waba}/dataset` (el que ya existe) y `POST {waba}/dataset`
 * (lo crea si no hay). Con esto el negocio no tiene que ir al Administrador
 * de eventos a buscar un número: un botón lo trae.
 *
 * La respuesta del GET llega como `{ data: [{ id, name }] }` o `{ id }` según
 * la versión; se aceptan las dos.
 */
type DatasetResponse = {
  id?: string;
  data?: Array<{ id?: string; name?: string }>;
};

export function idDeDataset(res: DatasetResponse | null | undefined): string | null {
  if (!res) return null;
  if (typeof res.id === "string" && res.id) return res.id;
  const first = Array.isArray(res.data) ? res.data[0] : undefined;
  return typeof first?.id === "string" && first.id ? first.id : null;
}

export async function obtenerOCrearDataset(input: {
  wabaId: string;
  token: string;
}): Promise<{ datasetId: string; creado: boolean }> {
  const existente = await graphRequest<DatasetResponse>(
    `${input.wabaId}/dataset`,
    { token: input.token }
  );
  const id = idDeDataset(existente);
  if (id) return { datasetId: id, creado: false };

  const creado = await graphRequest<DatasetResponse>(`${input.wabaId}/dataset`, {
    method: "POST",
    token: input.token,
    body: {},
  });
  const nuevo = idDeDataset(creado);
  if (!nuevo) throw new Error("Meta no devolvió el id del conjunto de datos");
  return { datasetId: nuevo, creado: true };
}
