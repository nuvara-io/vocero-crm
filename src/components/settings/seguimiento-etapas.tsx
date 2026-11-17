"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectNativo } from "@/components/ui/select-nativo";
import type { FinalEtapa, SecuenciaEtapa } from "@/lib/crm-reglas";

/**
 * 077 — La secuencia de cada etapa: no es lo mismo quien nunca contestó que
 * quien ya creó la cuenta. Las etapas sin secuencia no reciben seguimiento.
 */

type Etapa = { id: string; name: string; kind: "open" | "won" | "lost" };
type Plantilla = { id: string; name: string };

const FINAL_LABEL: Record<FinalEtapa, string> = {
  archivar: "archivar",
  perdido: "pasar a Perdido",
  nada: "no hacer nada",
};

const sinTildes = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** La estrategia acordada (17-nov), por nombre de etapa y de plantilla. */
const RECOMENDADA: {
  etapas: string[];
  pasos: { dias: number; plantilla: string }[];
  finalDias: number;
  final: FinalEtapa;
}[] = [
  {
    etapas: ["nuevo", "en conversacion"],
    pasos: [
      { dias: 3, plantilla: "retomar_conversacion_valeria" },
      { dias: 7, plantilla: "prueba_gratis_20_valeria" },
    ],
    finalDias: 10,
    final: "archivar",
  },
  {
    etapas: ["calificado"],
    pasos: [
      { dias: 2, plantilla: "retomar_conversacion_valeria" },
      { dias: 5, plantilla: "invitar_demostracion" },
    ],
    finalDias: 10,
    final: "perdido",
  },
  {
    etapas: ["no asistio"],
    pasos: [{ dias: 1, plantilla: "reagendar_demostracion" }],
    finalDias: 7,
    final: "perdido",
  },
  {
    etapas: ["demo hecha", "seguimiento"],
    pasos: [
      { dias: 2, plantilla: "despues_demostracion" },
      { dias: 5, plantilla: "retomar_conversacion_valeria" },
    ],
    finalDias: 10,
    final: "perdido",
  },
  {
    etapas: ["registrado"],
    pasos: [
      { dias: 2, plantilla: "reactivar_conversacion_valeria" },
      { dias: 5, plantilla: "ponte_al_dia_recarga" },
    ],
    finalDias: 0,
    final: "nada",
  },
];

/** Arma la recomendación con las etapas y plantillas que existen. */
export function secuenciasRecomendadas(
  etapas: readonly Etapa[],
  plantillas: readonly Plantilla[]
): { secuencias: SecuenciaEtapa[]; faltan: string[] } {
  const faltan = new Set<string>();
  const secuencias: SecuenciaEtapa[] = [];
  for (const r of RECOMENDADA) {
    for (const nombre of r.etapas) {
      const etapa = etapas.find((e) => e.kind === "open" && sinTildes(e.name) === nombre);
      if (!etapa) continue;
      const pasos = r.pasos.flatMap((p) => {
        const t = plantillas.find((x) => x.name === p.plantilla);
        if (!t) {
          faltan.add(p.plantilla);
          return [];
        }
        return [{ dias: p.dias, templateId: t.id }];
      });
      secuencias.push({ stageId: etapa.id, pasos, finalDias: r.finalDias, final: r.final });
    }
  }
  return { secuencias, faltan: [...faltan] };
}

export function SeguimientoEtapas({
  etapas,
  plantillas,
  valor,
  onChange,
}: {
  etapas: Etapa[];
  plantillas: Plantilla[];
  valor: SecuenciaEtapa[];
  onChange: (v: SecuenciaEtapa[]) => void;
}) {
  const abiertas = etapas.filter((e) => e.kind === "open");
  const de = (id: string) => valor.find((v) => v.stageId === id);
  const cambiar = (id: string, cambio: Partial<SecuenciaEtapa> | null) => {
    if (cambio === null) return onChange(valor.filter((v) => v.stageId !== id));
    const actual = de(id) ?? { stageId: id, pasos: [], finalDias: 10, final: "archivar" as FinalEtapa };
    const nuevo = { ...actual, ...cambio };
    onChange(de(id) ? valor.map((v) => (v.stageId === id ? nuevo : v)) : [...valor, nuevo]);
  };

  return (
    <div className="space-y-2">
      {abiertas.map((e) => {
        const s = de(e.id);
        return (
          <div key={e.id} className="rounded-lg border bg-card px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={Boolean(s)}
                onChange={(ev) => cambiar(e.id, ev.target.checked ? {} : null)}
              />
              {e.name}
              {!s && <span className="text-xs font-normal text-text-3">· sin seguimiento</span>}
            </label>
            {s && (
              <div className="mt-2 space-y-2 pl-6">
                {s.pasos.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-text-3">Día</span>
                    <Input
                      aria-label={`${e.name}: días del paso ${i + 1}`}
                      inputMode="numeric"
                      value={String(p.dias)}
                      onChange={(ev) =>
                        cambiar(e.id, {
                          pasos: s.pasos.map((x, j) =>
                            j === i ? { ...x, dias: Math.max(1, Number(ev.target.value.replace(/\D/g, "")) || 1) } : x
                          ),
                        })
                      }
                      className="h-8 w-14"
                    />
                    <SelectNativo
                      tamano="sm"
                      envoltura="min-w-0 flex-1"
                      aria-label={`${e.name}: plantilla del paso ${i + 1}`}
                      value={p.templateId}
                      onChange={(ev) =>
                        cambiar(e.id, {
                          pasos: s.pasos.map((x, j) => (j === i ? { ...x, templateId: ev.target.value } : x)),
                        })
                      }
                    >
                      <option value="">Elige una plantilla</option>
                      {plantillas.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </SelectNativo>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cambiar(e.id, { pasos: s.pasos.filter((_, j) => j !== i) })}
                    >
                      Quitar
                    </Button>
                  </div>
                ))}
                {s.pasos.length < 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      cambiar(e.id, {
                        pasos: [...s.pasos, { dias: (s.pasos.at(-1)?.dias ?? 0) + 3, templateId: "" }],
                      })
                    }
                  >
                    Agregar paso
                  </Button>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-text-3">Al día</span>
                  <Input
                    aria-label={`${e.name}: días para la acción final`}
                    inputMode="numeric"
                    value={String(s.finalDias)}
                    onChange={(ev) => cambiar(e.id, { finalDias: Number(ev.target.value.replace(/\D/g, "")) || 0 })}
                    className="h-8 w-14"
                  />
                  <span className="text-text-3">sin respuesta:</span>
                  <SelectNativo
                    tamano="sm"
                    aria-label={`${e.name}: acción final`}
                    value={s.final}
                    onChange={(ev) => cambiar(e.id, { final: ev.target.value as FinalEtapa })}
                  >
                    {(Object.keys(FINAL_LABEL) as FinalEtapa[]).map((f) => (
                      <option key={f} value={f}>
                        {FINAL_LABEL[f]}
                      </option>
                    ))}
                  </SelectNativo>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
