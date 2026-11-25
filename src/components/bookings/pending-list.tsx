"use client";

import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PASO_LABEL, estaVencido } from "@/lib/seguimiento-demo";
import { longDayLabel } from "@/lib/time/calendar";
import { dayIsoInTz } from "@/lib/time/slots";
import { cn } from "@/lib/utils";
import { bookingTitle, type Booking } from "./booking-look";

/** 082 — Lo que falta por hacer después de las demos, de cualquier fecha. */
export function PendingList({
  bookings,
  timezone,
  today,
  selectedId,
  onSelect,
}: {
  bookings: Booking[];
  timezone: string;
  today: string;
  selectedId: string | null;
  onSelect: (b: Booking) => void;
}) {
  if (bookings.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        className="min-h-0 flex-1 rounded-lg border bg-card p-8"
        title="Nada por hacer"
        description="Abre una cita y elige qué sigue: aparecerá aquí hasta que la marques como hecha."
      />
    );
  }
  return (
    <ul className="min-h-0 flex-1 divide-y overflow-auto rounded-lg border bg-card">
      {bookings.map((b) => {
        const s = b.siguiente!;
        const vencido = estaVencido(s.fecha, today);
        return (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onSelect(b)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-soft",
                b.id === selectedId && "bg-row-hover"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{bookingTitle(b)}</span>
                <span className="block truncate text-xs text-text-3">Cita del {longDayLabel(dayIsoInTz(new Date(b.scheduledAtUtc), timezone))}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs font-semibold text-text-2">{PASO_LABEL[s.paso]}</span>
                <span className={cn("block text-xs", vencido ? "text-danger-text" : "text-text-3")}>
                  {s.fecha ? `${s.fecha === today ? "Hoy" : longDayLabel(s.fecha)}${vencido ? " · vencido" : ""}` : "Sin fecha"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
