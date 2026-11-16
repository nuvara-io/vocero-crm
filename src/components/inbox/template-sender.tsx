"use client";

import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import {
  nombreLegible,
  sugerirVariables,
  trozosDeVistaPrevia,
  type DatosPlantilla,
} from "@/lib/plantilla-variables";
import { cn } from "@/lib/utils";
import type { TemplateDto } from "@/lib/types";
import { countVariables } from "@/lib/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Selector de plantilla aprobada para conversaciones con ventana cerrada
 * (FR-005/FR-051). Sin plantillas aprobadas muestra el estado vacío.
 *
 * 074 — Tarjetas en vez de una lista nativa, los datos de la plantilla
 * llenados con lo que ya sabe el CRM (nombre, quién escribe, la cita) y una
 * vista previa de cómo le llega al cliente.
 */
export function TemplateSender({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [variables, setVariables] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [datos, setDatos] = useState<DatosPlantilla | null>(null);

  // 074 — Lo que el CRM ya sabe del chat, para no reescribirlo en la plantilla.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/conversations/${conversationId}/datos-plantilla`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DatosPlantilla | null) => {
        if (!cancelled) setDatos(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled) {
          setTemplates(
            (d.templates ?? []).filter((t) => t.status === "approved" && !t.hidden)
          );
        }
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Si los datos llegan después de elegir, llenan lo que siga vacío.
  useEffect(() => {
    if (!datos || !selectedId || !templates) return;
    const t = templates.find((x) => x.id === selectedId);
    if (!t) return;
    const sugeridas = sugerirVariables(t.body, countVariables(t.body), datos);
    setEtiquetas(sugeridas.map((v) => v.etiqueta));
    setVariables((prev) => sugeridas.map((v, i) => (prev[i]?.trim() ? prev[i]! : v.valor)));
  }, [datos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (templates === null) {
    return <p className="text-xs text-muted-foreground">Cargando plantillas…</p>;
  }

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay plantillas aprobadas. Créalas en{" "}
        <a href="/settings/templates" className="text-primary hover:underline">
          Configuración → Plantillas
        </a>{" "}
        y espera la aprobación de Meta.
      </p>
    );
  }

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  // El cuerpo puede llevar {{1}}..{{n}}: el número de parámetros es el índice
  // más alto, y Meta los exige todos.
  const variableCount = selected ? countVariables(selected.body) : 0;
  const values = Array.from({ length: variableCount }, (_, i) => variables[i] ?? "");
  const missingValue = values.some((v) => !v.trim());
  const visibles = filtro.trim()
    ? templates.filter((t) =>
        `${t.name} ${t.body}`.toLowerCase().includes(filtro.trim().toLowerCase())
      )
    : templates;

  function elegir(t: TemplateDto) {
    setSelectedId(t.id);
    setError(null);
    const n = countVariables(t.body);
    const sugeridas = datos ? sugerirVariables(t.body, n, datos) : [];
    setEtiquetas(sugeridas.map((v) => v.etiqueta));
    setVariables(sugeridas.map((v) => v.valor));
  }

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(
      `/api/conversations/${conversationId}/messages/template`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: selected.id,
          variables: variableCount > 0 ? values : undefined,
        }),
      }
    );
    setSending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo enviar la plantilla");
      return;
    }
    setSelectedId("");
    setVariables([]);
    onSent();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Elige una plantilla aprobada</p>
        {templates.length > 5 && (
          <div className="relative w-44">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3"
              strokeWidth={1.7}
            />
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar"
              aria-label="Buscar plantilla"
              className="h-8 rounded-full pl-8 text-xs"
            />
          </div>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Plantilla aprobada"
        className="grid max-h-44 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2"
      >
        {visibles.map((t) => {
          const activa = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={activa}
              onClick={() => elegir(t)}
              className={cn(
                "rounded-xl border bg-card px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activa ? "border-brand bg-brand-tint" : "border-border hover:border-border-strong hover:bg-accent"
              )}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                {activa && <Check className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />}
                <span className="truncate">{nombreLegible(t.name)}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-text-3">{t.body}</span>
            </button>
          );
        })}
        {visibles.length === 0 && (
          <p className="text-xs text-text-3">Ninguna plantilla coincide con «{filtro}».</p>
        )}
      </div>

      {selected && (
        <div className="grid gap-3 rounded-xl border bg-subtle p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-2.5">
            {variableCount === 0 ? (
              <p className="text-xs text-text-3">Esta plantilla no lleva datos: sale tal cual.</p>
            ) : (
              values.map((value, i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`template-variable-${i + 1}`} className="text-xs">
                    {etiquetas[i] ?? `Valor de {{${i + 1}}}`}
                  </Label>
                  <Input
                    id={`template-variable-${i + 1}`}
                    value={value}
                    onChange={(e) =>
                      setVariables((prev) => {
                        const next = [...prev];
                        while (next.length < variableCount) next.push("");
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    placeholder="Escríbelo aquí"
                    className={cn("h-8 text-sm", !value.trim() && "border-warning-soft")}
                  />
                </div>
              ))
            )}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Así le llega</p>
            <div className="burbuja-out whitespace-pre-wrap rounded-[18px] rounded-tr-[5px] border border-bubble-out-border bg-bubble-out px-3.5 py-2 text-[13px] leading-[1.45] shadow-sm">
              {trozosDeVistaPrevia(selected.body, values).map((t, i) =>
                t.variable ? (
                  <span
                    key={i}
                    className={cn(
                      "rounded px-0.5 font-semibold",
                      t.vacio ? "bg-warning-tint text-warning-text" : "bg-brand-tint text-brand-text"
                    )}
                  >
                    {t.texto}
                  </span>
                ) : (
                  <span key={i}>{t.texto}</span>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={() => void send()} disabled={!selected || sending || missingValue}>
          {sending ? "Enviando…" : "Enviar plantilla"}
        </Button>
        {selected && missingValue && (
          <span className="text-xs text-warning-text">Llena los datos en amarillo para poder enviarla.</span>
        )}
      </div>
    </div>
  );
}
