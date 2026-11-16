"use client";

import type { RevisionSemanalDto } from "@/lib/revision-semanal";
import { formatMoneyCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Section, Subhead } from "./section";

const pct = (t: number | null) => (t === null ? "—" : `${Math.round(t * 100)} %`);

/**
 * 073 — La revisión de cada lunes: dónde se cae el embudo esta semana, qué
 * suele explicarlo y cuánta plata espera una decisión.
 */
export function SemanaSection({
  data,
  loading,
  error,
  currency,
}: {
  data: RevisionSemanalDto | null;
  loading: boolean;
  error: string | null;
  currency: string;
}) {
  const total = data?.etapas.reduce((s, e) => s + e.entradas, 0) ?? 0;
  return (
    <Section
      id="semana"
      title="Revisión de la semana"
      hint="Últimos 7 días: cuántos entraron a cada etapa y dónde se cae más. Para revisarla en equipo cada lunes."
      loading={loading}
      error={error}
      hasData={!!data}
      empty={!!data && total === 0}
      emptyText="Esta semana nadie cambió de etapa."
    >
      {data && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <Subhead>Paso entre etapas</Subhead>
            <ul className="space-y-1.5">
              {data.pasos.map((p) => {
                const esCaida = data.caida?.desde === p.desde && data.caida?.hasta === p.hasta;
                return (
                  <li
                    key={`${p.desde}-${p.hasta}`}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
                      esCaida && "bg-warning-tint"
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {p.desde} → {p.hasta}
                      <span className="ml-1.5 text-xs text-text-3">
                        ({p.entradasDesde} → {p.entradasHasta})
                      </span>
                    </span>
                    <span className={cn("shrink-0 tabular-nums font-semibold", esCaida && "text-warning-text")}>
                      {pct(p.tasa)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0 space-y-5">
            <div>
              <Subhead>Dónde se cae más</Subhead>
              {data.caida ? (
                <>
                  <p className="text-sm font-semibold">
                    {data.caida.desde} → {data.caida.hasta}: {pct(data.caida.tasa)}
                  </p>
                  <p className="mt-1 text-sm text-text-2">{data.caida.diagnostico}</p>
                </>
              ) : (
                <p className="text-sm text-text-3">Todavía hay muy pocos movimientos para decirlo.</p>
              )}
            </div>
            <div>
              <Subhead>Plata sobre la mesa</Subhead>
              <p className="text-xl font-bold tabular-nums">
                {formatMoneyCents(data.sobreLaMesa.cents, currency) ?? "—"}
              </p>
              <p className="text-xs text-text-3">
                {data.sobreLaMesa.leads === 0
                  ? "Nadie en demo agendada, no asistió ni seguimiento."
                  : `${data.sobreLaMesa.leads} ${data.sobreLaMesa.leads === 1 ? "lead" : "leads"} en demo agendada, no asistió o seguimiento`}
                {data.sobreLaMesa.sinValor > 0 && ` · ${data.sobreLaMesa.sinValor} sin valor`}
              </p>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
