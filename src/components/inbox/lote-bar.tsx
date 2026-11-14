"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowRightLeft, Send } from "lucide-react";
import type { ConversationDto, LossReason, StageDto, TemplateDto } from "@/lib/types";
import { LOSS_REASON_LABEL } from "@/lib/types";
import { countVariables } from "@/lib/templates";
import { aplicarLote, type MiembroDto } from "@/lib/equipo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectNativo } from "@/components/ui/select-nativo";

/**
 * 067 — Acciones sobre las conversaciones elegidas en la Bandeja: archivar,
 * mover de etapa, asignar responsable y mandar una plantilla a cada una.
 *
 * La plantilla se manda una por una por la MISMA ruta que el envío individual
 * (`/messages/template`): hereda la regla de la ventana, el guardarraíl del
 * Laboratorio y los avisos de error de Meta, en vez de un camino paralelo.
 */

/** Primer nombre «humano» del contacto, o null si el nombre no lo parece. */
export function primerNombre(nombre: string): string | null {
  const palabra = nombre.trim().split(/\s+/)[0] ?? "";
  return /^\p{L}[\p{L}'-]{1,}$/u.test(palabra) ? palabra : null;
}

export function LoteBar({
  conversaciones,
  enArchivadas,
  equipo,
  onHecho,
  onRefrescar,
}: {
  conversaciones: ConversationDto[];
  enArchivadas: boolean;
  equipo: MiembroDto[];
  /** Tras archivar, mover o asignar: se limpia la selección. */
  onHecho: () => void;
  /** Tras mandar plantillas: se recarga la lista pero el resultado sigue a la vista. */
  onRefrescar: () => void;
}) {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [panel, setPanel] = useState<null | "etapa" | "plantilla">(null);
  const [stageId, setStageId] = useState("");
  const [lossReason, setLossReason] = useState<LossReason | "">("");
  const [templateId, setTemplateId] = useState("");
  const [respaldo, setRespaldo] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/pipeline/stages")
      .then((r) => (r.ok ? r.json() : { stages: [] }))
      .then((d: { stages?: StageDto[] }) => setStages(d.stages ?? []))
      .catch(() => setStages([]));
    void fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) =>
        // En lote solo caben plantillas sin variables o con una (el nombre).
        setTemplates(
          (d.templates ?? []).filter((t) => t.status === "approved" && countVariables(t.body) <= 1)
        )
      )
      .catch(() => setTemplates([]));
  }, []);

  const ids = conversaciones.map((c) => c.id);
  const n = ids.length;
  const etapa = stages.find((s) => s.id === stageId) ?? null;
  const plantilla = templates.find((t) => t.id === templateId) ?? null;
  const usaNombre = plantilla ? countVariables(plantilla.body) === 1 : false;
  const sinNombre = conversaciones.filter((c) => !primerNombre(c.contact.name)).length;

  async function correr(accion: Parameters<typeof aplicarLote>[1], hecho: string) {
    setTrabajando(true);
    setMensaje(null);
    const err = await aplicarLote(ids, accion);
    setTrabajando(false);
    if (err) {
      setMensaje(err);
      return;
    }
    setMensaje(hecho);
    onHecho();
  }

  async function mandarPlantilla() {
    if (!plantilla) return;
    setTrabajando(true);
    setMensaje(null);
    let enviadas = 0;
    const fallidas: string[] = [];
    // En fila, no en paralelo: Meta limita la ráfaga y así un error no tumba
    // a los demás.
    for (const c of conversaciones) {
      const variables = usaNombre ? [primerNombre(c.contact.name) ?? respaldo.trim()] : [];
      const res = await fetch(`/api/conversations/${c.id}/messages/template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: plantilla.id, variables }),
      }).catch(() => null);
      if (res?.ok) enviadas++;
      else fallidas.push(c.contact.name);
    }
    setTrabajando(false);
    setMensaje(
      fallidas.length === 0
        ? `Plantilla enviada a ${enviadas}.`
        : `Enviada a ${enviadas}; falló con ${fallidas.length}: ${fallidas.slice(0, 3).join(", ")}${fallidas.length > 3 ? "…" : ""}.`
    );
    if (enviadas > 0) onRefrescar();
  }

  return (
    <div
      className="space-y-2.5 border-t border-border-strong bg-card px-3 pb-3 pt-2.5 shadow-[0_-6px_16px_-10px_rgba(15,23,42,0.25)]"
      role="region"
      aria-label="Acciones en lote"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-primary px-2.5 py-0.5 text-[12px] font-semibold text-primary-foreground">
          {n} {n === 1 ? "elegida" : "elegidas"}
        </span>
        {trabajando && <span className="text-[12px] text-text-3">Aplicando…</span>}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={trabajando}
          onClick={() =>
            void correr(
              { accion: "archivar", archivado: !enArchivadas },
              enArchivadas ? "Sacadas de archivadas." : "Archivadas."
            )
          }
        >
          {enArchivadas ? (
            <ArchiveRestore className="h-4 w-4" strokeWidth={1.7} />
          ) : (
            <Archive className="h-4 w-4" strokeWidth={1.7} />
          )}
          {enArchivadas ? "Desarchivar" : "Archivar"}
        </Button>
        <Button
          size="sm"
          variant={panel === "etapa" ? "default" : "outline"}
          className="w-full"
          disabled={trabajando}
          aria-expanded={panel === "etapa"}
          onClick={() => setPanel(panel === "etapa" ? null : "etapa")}
        >
          <ArrowRightLeft className="h-4 w-4" strokeWidth={1.7} />
          Etapa
        </Button>
        <SelectNativo
          tamano="sm"
          aria-label="Asignar responsable a las elegidas"
          disabled={trabajando}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const userId = v === "__nadie" ? null : v;
            const quien = equipo.find((m) => m.userId === userId)?.name;
            void correr(
              { accion: "asignar", userId },
              quien ? `Ahora ${quien} hace el seguimiento.` : "Quedaron sin responsable."
            );
          }}
        >
          <option value="">Responsable…</option>
          {equipo.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
          <option value="__nadie">Sin responsable</option>
        </SelectNativo>
        <Button
          size="sm"
          variant={panel === "plantilla" ? "default" : "outline"}
          className="w-full"
          disabled={trabajando}
          aria-expanded={panel === "plantilla"}
          onClick={() => setPanel(panel === "plantilla" ? null : "plantilla")}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
          Plantilla
        </Button>
      </div>

      {panel === "etapa" && (
        <div className="space-y-2 rounded-xl border bg-subtle p-2.5">
          <SelectNativo
            aria-label="Etapa destino"
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
          >
            <option value="">Mover a…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectNativo>
          {etapa?.kind === "lost" && (
            <SelectNativo
              aria-label="Motivo de la pérdida"
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value as LossReason | "")}
              >
              <option value="">¿Por qué se perdió?</option>
              {(Object.keys(LOSS_REASON_LABEL) as LossReason[]).map((k) => (
                <option key={k} value={k}>
                  {LOSS_REASON_LABEL[k]}
                </option>
              ))}
            </SelectNativo>
          )}
          <Button
            size="sm"
            className="w-full"
            disabled={trabajando || !etapa || (etapa.kind === "lost" && !lossReason)}
            onClick={() =>
              etapa &&
              void correr(
                {
                  accion: "etapa",
                  stageId: etapa.id,
                  ...(etapa.kind === "lost" && lossReason ? { lossReason } : {}),
                },
                `Movidas a ${etapa.name}.`
              )
            }
          >
            Mover {n}
          </Button>
        </div>
      )}

      {panel === "plantilla" && (
        <div className="space-y-2 rounded-xl border bg-subtle p-2.5">
          {templates.length === 0 ? (
            <p className="text-[12px] text-text-3">
              No hay plantillas aprobadas sin variables o con una sola (el nombre).
            </p>
          ) : (
            <>
              <SelectNativo
                aria-label="Plantilla a enviar"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                  >
                <option value="">Elige la plantilla…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectNativo>
              {plantilla && (
                <p className="whitespace-pre-wrap rounded-lg border bg-card p-2.5 text-[12px] text-text-2">
                  {plantilla.body}
                </p>
              )}
              {usaNombre && sinNombre > 0 && (
                <label className="block space-y-1 text-[12px]">
                  <span>
                    {sinNombre} sin un nombre que sirva. En vez del nombre, usar:
                  </span>
                  <Input
                    value={respaldo}
                    onChange={(e) => setRespaldo(e.target.value)}
                    placeholder="p. ej. de nuevo"
                  />
                </label>
              )}
              <Button
                size="sm"
                className="w-full"
                disabled={
                  trabajando || !plantilla || (usaNombre && sinNombre > 0 && !respaldo.trim())
                }
                onClick={() => void mandarPlantilla()}
              >
                {trabajando ? "Enviando…" : `Enviar a ${n}`}
              </Button>
            </>
          )}
        </div>
      )}

      {mensaje && <p className="text-[12px] text-text-2">{mensaje}</p>}
    </div>
  );
}
