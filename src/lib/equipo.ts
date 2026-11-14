"use client";

import { useEffect, useState } from "react";

/**
 * 067 — El equipo (quién puede ser responsable de un lead) y las acciones de
 * la Bandeja sobre una o varias conversaciones.
 */

export type MiembroDto = { userId: string; name: string };

let cache: Promise<MiembroDto[]> | null = null;

function cargarEquipo(): Promise<MiembroDto[]> {
  cache ??= fetch("/api/settings/team")
    .then((r) => (r.ok ? r.json() : { members: [] }))
    .then((d: { members?: { userId?: string; name: string }[] }) =>
      (d.members ?? [])
        .filter((m): m is { userId: string; name: string } => typeof m.userId === "string")
        .map((m) => ({ userId: m.userId, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
    )
    .catch(() => {
      cache = null; // que el siguiente intento vuelva a pedirlo
      return [];
    });
  return cache;
}

/** Los miembros del equipo; `null` mientras carga. Se pide una vez por pestaña. */
export function useEquipo(): MiembroDto[] | null {
  const [equipo, setEquipo] = useState<MiembroDto[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void cargarEquipo().then((e) => {
      if (vivo) setEquipo(e);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return equipo;
}

export type AccionLote =
  | { accion: "archivar"; archivado: boolean }
  | { accion: "asignar"; userId: string | null }
  | { accion: "etapa"; stageId: string; lossReason?: string };

/** Devuelve el mensaje de error, o null si salió bien. */
export async function aplicarLote(ids: string[], accion: AccionLote): Promise<string | null> {
  const res = await fetch("/api/conversations/lote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, ...accion }),
  }).catch(() => null);
  if (res?.ok) return null;
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? "No se pudo aplicar";
}

/** «Robinson Buitrago» → «Robinson». */
export function nombreCorto(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}
