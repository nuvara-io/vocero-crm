"use client";

import { useState } from "react";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 076 — «Marcar activado» desde el chat: cuánto pagó y cuándo. Lo guarda como
 * monto del trato, lo mueve a «Activado» y (si las comisiones están
 * prendidas) registra la venta a tu nombre.
 */
export function ActivarDialog({
  nombre,
  currency,
  montoInicialCents,
  onCancel,
  onSaved,
  leadId,
}: {
  nombre: string;
  currency: string;
  montoInicialCents: number | null;
  leadId: string;
  onCancel: () => void;
  onSaved: (mensaje: string) => void;
}) {
  const hoy = new Date().toLocaleDateString("en-CA");
  const [texto, setTexto] = useState(montoInicialCents ? String(Math.round(montoInicialCents / 100)) : "");
  const [fecha, setFecha] = useState(hoy);
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = texto.trim() ? parseMoneyToCents(texto) : null;
  const invalido = texto.trim().length > 0 && cents === null;

  async function guardar() {
    if (!cents || enviando) return;
    setEnviando(true);
    setError(null);
    const res = await fetch(`/api/pipeline/leads/${leadId}/activar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ montoCents: cents, pagadoEn: fecha, email: email.trim() || null }),
    }).catch(() => null);
    setEnviando(false);
    const data = (await res?.json().catch(() => null)) as {
      venta?: string;
      ventaMensaje?: string | null;
      error?: { message?: string };
    } | null;
    if (!res?.ok) {
      setError(data?.error?.message ?? "No se pudo marcar como activado");
      return;
    }
    const venta =
      data?.venta === "registrada"
        ? "Venta registrada para comisiones."
        : data?.venta === "ya_existia"
          ? "Ya tenía una venta registrada; no se duplicó."
          : data?.venta === "rechazada"
            ? `No se registró la venta: ${data.ventaMensaje ?? "revisa Comisiones"}.`
            : "";
    onSaved(`Quedó en Activado con ${formatMoneyCents(cents, currency)}. ${venta}`.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Marcar activado"
    >
      <div className="w-full max-w-sm rounded-lg border bg-popover p-4 shadow-pop">
        <h3 className="font-semibold">Marcar activado</h3>
        <p className="mt-0.5 text-xs text-text-3">{nombre}</p>

        <label className="mt-3 block text-xs font-medium" htmlFor="activar-monto">
          Cuánto pagó ({currency})
        </label>
        <Input
          id="activar-monto"
          value={texto}
          inputMode="decimal"
          autoFocus
          onChange={(e) => setTexto(e.target.value)}
          placeholder="230000"
          className="mt-1"
        />
        <p className={invalido ? "mt-1 text-xs text-danger-text" : "mt-1 text-xs text-text-3"}>
          {invalido
            ? "No reconozco ese número. Escríbelo como 230000 o 230.000"
            : cents
              ? `Se guardará como ${formatMoneyCents(cents, currency)}`
              : "Es el monto que cuenta para la comisión."}
        </p>

        <label className="mt-3 block text-xs font-medium" htmlFor="activar-fecha">
          Fecha del pago
        </label>
        <Input
          id="activar-fecha"
          type="date"
          value={fecha}
          max={hoy}
          onChange={(e) => setFecha(e.target.value)}
          className="mt-1"
        />

        <label className="mt-3 block text-xs font-medium" htmlFor="activar-email">
          Correo del cliente <span className="font-normal text-text-3">(opcional)</span>
        </label>
        <Input
          id="activar-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="cliente@empresa.com"
          className="mt-1"
        />
        <p className="mt-1 text-xs text-text-3">
          Sirve para que el pago de la plataforma reemplace esta venta y no cuente doble.
        </p>

        {error && <p className="mt-3 text-xs text-danger-text">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={!cents || invalido || enviando} onClick={() => void guardar()}>
            {enviando ? "Guardando…" : "Marcar activado"}
          </Button>
        </div>
      </div>
    </div>
  );
}
