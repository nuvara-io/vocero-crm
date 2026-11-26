"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Send, Sparkles, X } from "lucide-react";
import type { EnvioDto } from "@/lib/envios";
import { nombreLegible } from "@/lib/plantilla-variables";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SelectNativo } from "@/components/ui/select-nativo";
import { useEvents } from "@/components/use-events";

/**
 * 085 — «Próximos envíos»: lo que el equipo programó y lo que mandará el
 * seguimiento automático, por día. Aquí se cancela, se mueve o se omite
 * antes de que salga.
 */

const ESTADO_LABEL: Record<EnvioDto["estado"], string> = {
  pendiente: "Pendiente",
  enviando: "Saliendo",
  enviado: "Enviado",
  cancelado: "Cancelado",
  error: "No salió",
};

function diaDe(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function EnviosClient() {
  const [envios, setEnvios] = useState<EnvioDto[] | null>(null);
  const [tz, setTz] = useState("America/Bogota");
  const [dias, setDias] = useState(14);
  const [origen, setOrigen] = useState<"todos" | "programado" | "automatico">("todos");
  const [error, setError] = useState<string | null>(null);
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [nuevaHora, setNuevaHora] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/envios?dias=${dias}`).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { envios: EnvioDto[]; timezone: string } | null) : null;
    if (!data) {
      setError("No se pudieron cargar los envíos.");
      return;
    }
    setError(null);
    setTz(data.timezone);
    setEnvios(data.envios);
  }, [dias]);

  useEffect(() => {
    void cargar();
  }, [cargar]);
  useEvents({ onReconnect: () => void cargar() });

  async function accion(e: EnvioDto, body?: Record<string, unknown>) {
    const res =
      e.origen === "automatico"
        ? await fetch("/api/envios/omitir", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ conversationId: e.conversationId, paso: e.paso ?? 0, ancla: e.ancla, templateId: e.plantilla?.id ?? null }),
          }).catch(() => null)
        : await fetch(`/api/envios/${e.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? { action: "cancelar" }),
          }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo hacer el cambio");
      return;
    }
    setMoviendo(null);
    await cargar();
  }

  const visibles = useMemo(
    () => (envios ?? []).filter((e) => origen === "todos" || e.origen === origen),
    [envios, origen]
  );
  const porDia = useMemo(() => {
    const m = new Map<string, EnvioDto[]>();
    for (const e of visibles) {
      const d = diaDe(e.cuando, tz);
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return [...m.entries()];
  }, [visibles, tz]);
  const hoy = diaDe(new Date().toISOString(), tz);
  const pendientes = (envios ?? []).filter((e) => e.estado === "pendiente").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <div className="mr-auto">
          <h2 className="text-[17px] font-bold tracking-tight">Próximos envíos</h2>
          <p className="text-xs text-text-3">
            {pendientes} por salir · lo programado por el equipo y lo que mandará el seguimiento automático
          </p>
        </div>
        <SelectNativo tamano="sm" value={origen} onChange={(e) => setOrigen(e.target.value as typeof origen)} aria-label="Qué envíos ver">
          <option value="todos">Todos</option>
          <option value="programado">Programados</option>
          <option value="automatico">Automáticos</option>
        </SelectNativo>
        <SelectNativo tamano="sm" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Cuántos días">
          <option value={7}>7 días</option>
          <option value={14}>14 días</option>
          <option value={30}>30 días</option>
        </SelectNativo>
      </header>

      {error && <p role="alert" className="mx-4 mt-3 rounded-sm bg-danger-tint px-3 py-2 text-sm text-danger-text sm:mx-6">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4">
        {envios === null ? (
          <p className="p-6 text-sm text-text-3">Cargando…</p>
        ) : porDia.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            className="rounded-lg border bg-card p-8"
            title="Nada por salir"
            description="Programa una plantilla desde el chat con «Programar», o configura el seguimiento en Ajustes → Reparto y seguimiento."
          />
        ) : (
          <div className="space-y-4">
            {porDia.map(([dia, lista]) => (
              <section key={dia} className="overflow-hidden rounded-lg border bg-card">
                <h3 className="border-b bg-subtle px-4 py-2 text-[13px] font-semibold first-letter:uppercase">
                  {dia === hoy
                    ? "Hoy"
                    : new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(lista[0]!.cuando))}
                  <span className="ml-2 font-mono text-[11px] font-normal text-text-3">{lista.length}</span>
                </h3>
                <ul className="divide-y">
                  {lista.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <span className="w-[4.5rem] shrink-0 whitespace-nowrap font-mono text-[12px] text-text-2">
                        {new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(e.cuando))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          <Link href={`/inbox?contact=${e.contacto.id}`} className="truncate hover:underline">
                            {e.contacto.nombre || "Sin nombre"}
                          </Link>
                        </span>
                        <span className="block truncate text-xs text-text-3">
                          {e.accion === "enviar" ? (
                            <>
                              <Send className="mr-1 inline h-3 w-3" strokeWidth={1.8} />
                              {nombreLegible(e.plantilla?.nombre ?? "")}
                            </>
                          ) : e.accion === "archivar" ? (
                            "Archiva el chat (fin de la secuencia)"
                          ) : (
                            "Pasa a Perdido (fin de la secuencia)"
                          )}
                          {e.origen === "automatico"
                            ? ` · automático${e.etapa ? ` · ${e.etapa}` : ""} · desde las 8:00 si cae de noche`
                            : ` · programado${e.quien ? ` por ${e.quien}` : ""}`}
                          {e.error ? ` · ${e.error}` : ""}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          e.origen === "automatico" ? "border-info-soft bg-info-tint text-info-text" : "border-brand-soft bg-brand-tint text-brand-text",
                          e.estado === "error" && "border-danger-soft bg-danger-tint text-danger-text",
                          (e.estado === "enviado" || e.estado === "cancelado") && "border-border-strong bg-chip text-text-3"
                        )}
                      >
                        {e.origen === "automatico" && <Sparkles className="mr-1 inline h-3 w-3" strokeWidth={1.8} />}
                        {e.origen === "automatico" ? "Automático" : ESTADO_LABEL[e.estado]}
                      </span>
                      {e.estado === "pendiente" && (
                        <span className="flex shrink-0 items-center gap-1">
                          {e.origen === "programado" &&
                            (moviendo === e.id ? (
                              <>
                                <Input
                                  type="datetime-local"
                                  value={nuevaHora}
                                  onChange={(x) => setNuevaHora(x.target.value)}
                                  className="h-8 w-auto text-xs"
                                  aria-label="Nueva fecha y hora"
                                />
                                <Button
                                  size="sm"
                                  disabled={!nuevaHora}
                                  onClick={() => void accion(e, { action: "mover", sendAt: new Date(nuevaHora).toISOString() })}
                                >
                                  Mover
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => { setMoviendo(e.id); setNuevaHora(""); }}>
                                <CalendarClock className="h-3.5 w-3.5" /> Mover
                              </Button>
                            ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger-text"
                            onClick={() => void accion(e)}
                            title={e.origen === "automatico" ? "El seguimiento se salta este paso" : "No se envía"}
                          >
                            <X className="h-3.5 w-3.5" /> {e.origen === "automatico" ? (e.accion === "enviar" ? "Omitir" : "No hacerlo") : "Cancelar"}
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="px-1 text-xs text-text-3">
              Lo automático es lo que pasaría si el cliente no contesta antes: si contesta, se recalcula. El
              recordatorio de demo y el mensaje de «no asistió» no aparecen aquí; se configuran en Ajustes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
