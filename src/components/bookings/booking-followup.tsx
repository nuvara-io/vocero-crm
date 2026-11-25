"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NOTA_MAX, type NotaDto } from "@/lib/notas";
import {
  PASO_LABEL,
  PASOS_DEMO,
  PASOS_PENDIENTES,
  estaVencido,
  type PasoDemo,
} from "@/lib/seguimiento-demo";
import { longDayLabel } from "@/lib/time/calendar";
import { cn } from "@/lib/utils";
import type { Booking } from "./booking-look";

const pendiente = (p: PasoDemo | null) => (PASOS_PENDIENTES as readonly string[]).includes(p ?? "");

/** 082 — Lo que pasó en la demo y qué sigue. Interno: el cliente no lo ve. */
export function BookingFollowup({
  booking: b,
  timezone,
  today,
  onSaved,
}: {
  booking: Booking;
  timezone: string;
  today: string;
  onSaved: () => Promise<void>;
}) {
  const actual = b.siguiente ?? null;
  const [notas, setNotas] = useState<NotaDto[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [texto, setTexto] = useState("");
  const [paso, setPaso] = useState<PasoDemo | null>(actual?.paso ?? null);
  const [fecha, setFecha] = useState(actual?.fecha ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/bookings/${b.id}/seguimiento`).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { notas: NotaDto[] } | null) : null;
    setFallo(!data);
    if (data) setNotas(data.notas);
  }, [b.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function enviar(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${b.id}/seguimiento`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      setBusy(false);
      return false;
    }
    await Promise.all([cargar(), onSaved()]);
    setBusy(false);
    return true;
  }

  const fechaFinal = pendiente(paso) ? fecha || null : null;
  const cambioPaso = paso !== (actual?.paso ?? null) || fechaFinal !== (actual?.fecha ?? null);
  const vencido = actual && !actual.hecho && estaVencido(actual.fecha, today);

  async function guardar() {
    const ok = await enviar({
      ...(texto.trim() ? { texto: texto.trim() } : {}),
      ...(cambioPaso ? { paso, fecha: fechaFinal } : {}),
    });
    if (ok) setTexto("");
  }

  return (
    <section className="space-y-3 border-b p-4" aria-label="Notas y seguimiento">
      <p className="kicker">Notas y seguimiento</p>

      {actual && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm",
            actual.hecho
              ? "bg-success-tint text-success-text"
              : vencido
                ? "bg-danger-tint text-danger-text"
                : "bg-subtle text-text-2"
          )}
        >
          <span>
            <strong className={cn("font-semibold", actual.hecho && "line-through")}>
              {PASO_LABEL[actual.paso]}
            </strong>
            {actual.fecha && ` · ${longDayLabel(actual.fecha)}`}
            {vencido && " · vencido"}
            {actual.hecho && " · hecho"}
          </span>
          {pendiente(actual.paso) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void enviar({ hecho: !actual.hecho })}
            >
              {actual.hecho ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {actual.hecho ? "Reabrir" : "Hecho"}
            </Button>
          )}
        </div>
      )}

      <Textarea
        aria-label="Nota de la demo"
        rows={3}
        maxLength={NOTA_MAX}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="¿Qué pasó en la demo? Interés, dudas, qué se le ofreció…"
      />

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-2">¿Qué sigue?</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué sigue">
          {PASOS_DEMO.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={paso === p}
              onClick={() => setPaso(paso === p ? null : p)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft",
                paso === p ? "border-brand bg-brand-tint text-brand-text" : "hover:bg-accent"
              )}
            >
              {PASO_LABEL[p]}
            </button>
          ))}
        </div>
        {pendiente(paso) && (
          <label className="flex items-center gap-2 pt-1 text-xs text-text-2">
            ¿Cuándo?
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="h-8 w-auto"
            />
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-sm bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-3">Solo lo ve el equipo. La nota queda también en el chat.</p>
        <Button size="sm" disabled={busy || (!texto.trim() && !cambioPaso)} onClick={() => void guardar()}>
          Guardar
        </Button>
      </div>

      {fallo && <p className="text-sm text-danger-text">No se pudieron cargar las notas.</p>}
      {notas && notas.length > 0 && (
        <ul className="space-y-2">
          {notas.map((n) => (
            <li key={n.id} className="rounded-sm bg-warning-tint px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">{n.texto}</p>
              <p className="mt-1 text-xs text-text-3">
                {n.autor?.nombre ?? "Alguien del equipo"} ·{" "}
                {new Date(n.createdAt).toLocaleString("es-CO", {
                  timeZone: timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
