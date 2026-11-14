"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Send } from "lucide-react";
import type { ConversationDto, LossReason, StageDto, TemplateDto } from "@/lib/types";
import { LOSS_REASON_LABEL } from "@/lib/types";
import { countVariables } from "@/lib/templates";
import { aplicarLote, type MiembroDto } from "@/lib/equipo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  const select =
    "w-full rounded-md border border-border-strong bg-background px-2 py-1.5 text-[13px]";

  return (
    <div className="space-y-2 border-t bg-subtle px-3 py-2.5" role="region" aria-label="Acciones en lote">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12.5px] font-semibold">{n} elegidas</span>
        <Button
          size="sm"
          variant="outline"
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
          disabled={trabajando}
          onClick={() => setPanel(panel === "etapa" ? null : "etapa")}
        >
          Etapa
        </Button>
        <select
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
          className="h-8 rounded-md border border-border-strong bg-background px-2 text-[12.5px] font-medium"
        >
          <option value="">Responsable…</option>
          {equipo.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
          <option value="__nadie">Sin responsable</option>
        </select>
        <Button
          size="sm"
          variant={panel === "plantilla" ? "default" : "outline"}
          disabled={trabajando}
          onClick={() => setPanel(panel === "plantilla" ? null : "plantilla")}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
          Plantilla
        </Button>
      </div>

      {panel === "etapa" && (
        <div className="space-y-2">
          <select
            aria-label="Etapa destino"
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className={select}
          >
            <option value="">Mover a…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {etapa?.kind === "lost" && (
            <select
              aria-label="Motivo de la pérdida"
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value as LossReason | "")}
              className={select}
            >
              <option value="">¿Por qué se perdió?</option>
              {(Object.keys(LOSS_REASON_LABEL) as LossReason[]).map((k) => (
                <option key={k} value={k}>
                  {LOSS_REASON_LABEL[k]}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
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
        <div className="space-y-2">
          {templates.length === 0 ? (
            <p className="text-[12px] text-text-3">
              No hay plantillas aprobadas sin variables o con una sola (el nombre).
            </p>
          ) : (
            <>
              <select
                aria-label="Plantilla a enviar"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className={select}
              >
                <option value="">Elige la plantilla…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {plantilla && (
                <p className="whitespace-pre-wrap rounded-md border bg-background p-2 text-[12px] text-text-2">
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
