"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNativo } from "@/components/ui/select-nativo";
import { Switch } from "@/components/ui/switch";
import type { AjustesSeguimiento, PasoSeguimiento, ReglaResponsable } from "@/lib/crm-reglas";
import { cn } from "@/lib/utils";

type Datos = {
  ajustes: { responsable: ReglaResponsable; seguimiento: AjustesSeguimiento };
  equipo: { userId: string; name: string }[];
  plantillas: { id: string; name: string; body: string }[];
  ultimos: { createdAt: string; step: number; ok: boolean; error: string | null; nombre: string }[];
};

const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso)
  );

async function guardar(cuerpo: unknown): Promise<string | null> {
  const res = await fetch("/api/settings/crm", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  }).catch(() => null);
  if (res?.ok) return null;
  const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return d?.error?.message ?? "No se pudo guardar";
}

/**
 * 071 — A quién le cae cada lead nuevo y qué pasa cuando un lead deja de
 * contestar. Las dos cosas son del equipo comercial; por eso van juntas.
 */
export function SeguimientoClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/crm").catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 403 ? "Solo quien administra ve estos ajustes." : "No se pudo cargar.");
      return;
    }
    setDatos((await res.json()) as Datos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <p className="text-sm text-text-3">{error}</p>;
  if (!datos) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <Reparto datos={datos} onGuardado={cargar} />
      <Seguimiento datos={datos} onGuardado={cargar} />
    </div>
  );
}

function Reparto({ datos, onGuardado }: { datos: Datos; onGuardado: () => Promise<void> }) {
  const inicial = datos.ajustes.responsable;
  const [modo, setModo] = useState<ReglaResponsable["modo"]>(inicial.modo);
  const [fijo, setFijo] = useState(inicial.modo === "fijo" ? inicial.userId : (datos.equipo[0]?.userId ?? ""));
  const [rotacion, setRotacion] = useState<string[]>(inicial.modo === "rotacion" ? inicial.userIds : []);
  const [estado, setEstado] = useState<string | null>(null);

  async function enviar() {
    const responsable =
      modo === "fijo"
        ? { modo, userId: fijo }
        : modo === "rotacion"
          ? { modo, userIds: rotacion }
          : { modo };
    if (modo === "rotacion" && rotacion.length === 0) return setEstado("Elige al menos una persona");
    const e = await guardar({ responsable });
    setEstado(e ?? "Guardado.");
    if (!e) await onGuardado();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Responsable de los leads nuevos</CardTitle>
        <CardDescription>
          Quién queda a cargo cuando alguien escribe por primera vez. Se puede cambiar después en cada chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["nadie", "Nadie"],
              ["fijo", "Una persona"],
              ["rotacion", "En rotación"],
            ] as [ReglaResponsable["modo"], string][]
          ).map(([valor, titulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setModo(valor)}
              aria-pressed={modo === valor}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                modo === valor ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
              )}
            >
              {titulo}
            </button>
          ))}
        </div>
        {modo === "fijo" && (
          <SelectNativo value={fijo} onChange={(e) => setFijo(e.target.value)} envoltura="max-w-xs" aria-label="Persona">
            {datos.equipo.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </SelectNativo>
        )}
        {modo === "rotacion" && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-3">Uno por uno, en este orden:</p>
            {datos.equipo.map((p) => (
              <label key={p.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rotacion.includes(p.userId)}
                  onChange={(e) =>
                    setRotacion((r) => (e.target.checked ? [...r, p.userId] : r.filter((x) => x !== p.userId)))
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void enviar()}>
            Guardar
          </Button>
          {estado && <span className="text-xs text-text-3">{estado}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Seguimiento({ datos, onGuardado }: { datos: Datos; onGuardado: () => Promise<void> }) {
  const s = datos.ajustes.seguimiento;
  const primera = datos.plantillas[0]?.id ?? "";
  const [enabled, setEnabled] = useState(s.enabled);
  const [pasos, setPasos] = useState<PasoSeguimiento[]>(
    s.pasos.length > 0
      ? s.pasos
      : [
          { dias: 2, templateId: primera },
          { dias: 5, templateId: primera },
        ]
  );
  const [archivar, setArchivar] = useState(String(s.archivarDias));
  const [estado, setEstado] = useState<string | null>(null);

  const cambiarPaso = (i: number, cambio: Partial<PasoSeguimiento>) =>
    setPasos((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));

  async function enviar() {
    const validos = pasos.filter((p) => p.templateId && p.dias >= 1);
    const e = await guardar({
      seguimiento: { enabled, pasos: validos, archivarDias: Math.max(0, Number(archivar) || 0) },
    });
    setEstado(e ?? "Guardado.");
    if (!e) await onGuardado();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seguimiento automático</CardTitle>
        <CardDescription>
          Si un lead deja de contestar, le escribe solo con una plantilla aprobada y, al final, archiva el chat. Si
          contesta, el conteo vuelve a empezar. Solo en horario hábil (8:00 a 19:00, lunes a sábado, sin festivos) y
          nunca en chats con una persona al frente, de prueba, ganados o perdidos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border bg-subtle px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{enabled ? "Encendido" : "Apagado"}</p>
            <p className="text-xs text-text-3">Cada plantilla enviada la cobra Meta como conversación nueva.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} label="Seguimiento automático" />
        </div>

        {datos.plantillas.length === 0 && (
          <p className="text-sm text-warning-text">
            No hay plantillas aprobadas. Crea una en Ajustes → Plantillas y espera a que Meta la apruebe.
          </p>
        )}

        {pasos.map((p, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Label htmlFor={`dias-${i}`}>Paso {i + 1}: a los</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`dias-${i}`}
                  inputMode="numeric"
                  value={String(p.dias)}
                  onChange={(e) => cambiarPaso(i, { dias: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })}
                  className="w-16"
                />
                <span className="text-xs text-text-3">días</span>
              </div>
            </div>
            <SelectNativo
              value={p.templateId}
              onChange={(e) => cambiarPaso(i, { templateId: e.target.value })}
              aria-label={`Plantilla del paso ${i + 1}`}
            >
              <option value="">Elige una plantilla</option>
              {datos.plantillas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectNativo>
            <Button variant="ghost" size="sm" onClick={() => setPasos((ps) => ps.filter((_, j) => j !== i))}>
              Quitar
            </Button>
          </div>
        ))}
        {pasos.length < 3 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPasos((ps) => [...ps, { dias: (ps.at(-1)?.dias ?? 0) + 3, templateId: primera }])}
          >
            Agregar paso
          </Button>
        )}

        <div className="flex items-center gap-2">
          <Label htmlFor="archivar">Archivar a los</Label>
          <Input
            id="archivar"
            inputMode="numeric"
            value={archivar}
            onChange={(e) => setArchivar(e.target.value.replace(/\D/g, ""))}
            className="w-16"
          />
          <span className="text-xs text-text-3">días sin respuesta (0 = no archivar)</span>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void enviar()}>
            Guardar
          </Button>
          {estado && <span className="text-xs text-text-3">{estado}</span>}
        </div>

        {datos.ultimos.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Lo último que hizo</p>
            {datos.ultimos.map((u, i) => (
              <p key={i} className="text-xs text-text-2">
                {fecha(u.createdAt)} · {u.nombre} · {u.step === 0 ? "archivado" : `paso ${u.step}`}
                {u.ok ? "" : ` · no se envió: ${u.error ?? "error"}`}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
