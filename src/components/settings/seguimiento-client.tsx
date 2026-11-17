"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNativo } from "@/components/ui/select-nativo";
import { Switch } from "@/components/ui/switch";
import type {
  AjustesNoAsistio,
  AjustesRecordatorio,
  AjustesSeguimiento,
  PasoSeguimiento,
  ReglaResponsable,
  SecuenciaEtapa,
} from "@/lib/crm-reglas";
import { SeguimientoEtapas, secuenciasRecomendadas } from "@/components/settings/seguimiento-etapas";
import { cn } from "@/lib/utils";

type Datos = {
  ajustes: {
    responsable: ReglaResponsable;
    seguimiento: AjustesSeguimiento;
    prospeccion?: AjustesSeguimiento;
    valorDemoCents?: number | null;
    noAsistio?: AjustesNoAsistio;
    recordatorio?: AjustesRecordatorio;
  };
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
      <Seguimiento datos={datos} onGuardado={cargar} clave="prospeccion" />
      <Demos datos={datos} onGuardado={cargar} />
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

function Seguimiento({
  datos,
  onGuardado,
  clave = "seguimiento",
}: {
  datos: Datos;
  onGuardado: () => Promise<void>;
  /** 072 — `prospeccion`: su propio seguimiento, sin archivar y en horario de ley. */
  clave?: "seguimiento" | "prospeccion";
}) {
  const esProspeccion = clave === "prospeccion";
  const s = (esProspeccion ? datos.ajustes.prospeccion : datos.ajustes.seguimiento) ?? {
    enabled: false,
    pasos: [],
    archivarDias: 0,
  };
  const primera = datos.plantillas[0]?.id ?? "";
  const [enabled, setEnabled] = useState(s.enabled);
  const [pasos, setPasos] = useState<PasoSeguimiento[]>(
    s.pasos.length > 0
      ? s.pasos
      : [
          { dias: 2, templateId: primera },
          { dias: esProspeccion ? 6 : 5, templateId: primera },
        ]
  );
  const [archivar, setArchivar] = useState(String(s.archivarDias));
  const [estado, setEstado] = useState<string | null>(null);
  // 077 — Secuencia por etapa y chats atendidos por una persona.
  const [porEtapa, setPorEtapa] = useState<SecuenciaEtapa[]>(s.porEtapa ?? []);
  const [incluirAtendidos, setIncluirAtendidos] = useState(s.incluirAtendidos === true);
  const [etapas, setEtapas] = useState<{ id: string; name: string; kind: "open" | "won" | "lost" }[]>([]);
  useEffect(() => {
    if (esProspeccion) return;
    fetch("/api/pipeline/stages")
      .then((r) => (r.ok ? r.json() : { stages: [] }))
      .then((d: { stages?: typeof etapas }) => setEtapas(d.stages ?? []))
      .catch(() => {});
  }, [esProspeccion]);
  const porEtapaActiva = !esProspeccion && porEtapa.length > 0;

  function cargarRecomendacion() {
    const r = secuenciasRecomendadas(etapas, datos.plantillas);
    setPorEtapa(r.secuencias);
    setIncluirAtendidos(true);
    setEstado(
      r.faltan.length > 0
        ? `Cargada. Faltan plantillas por aprobar en Meta: ${r.faltan.join(", ")} (esos pasos quedaron fuera).`
        : "Cargada. Revisa y guarda."
    );
  }

  const cambiarPaso = (i: number, cambio: Partial<PasoSeguimiento>) =>
    setPasos((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));

  async function enviar() {
    const validos = pasos.filter((p) => p.templateId && p.dias >= 1);
    const e = await guardar({
      [clave]: {
        enabled,
        pasos: validos,
        archivarDias: esProspeccion ? 0 : Math.max(0, Number(archivar) || 0),
        ...(esProspeccion
          ? {}
          : {
              porEtapa: porEtapa.map((x) => ({
                ...x,
                pasos: x.pasos.filter((p) => p.templateId && p.dias >= 1),
              })),
              incluirAtendidos,
            }),
      },
    });
    setEstado(e ?? "Guardado.");
    if (!e) await onGuardado();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{esProspeccion ? "Seguimiento de prospectos" : "Seguimiento automático"}</CardTitle>
        {esProspeccion ? (
          <CardDescription>
            Para prospectos con permiso que no han contestado: día 2 un dato útil, día 6 el último mensaje con una
            salida clara. Después no se les escribe más. Solo en horario de la Ley 2300 y nunca a quien pidió la baja.
          </CardDescription>
        ) : (
        <CardDescription>
          Si un lead deja de contestar, le escribe solo con una plantilla aprobada y, al final, archiva el chat. Si
          contesta, el conteo vuelve a empezar. Solo en horario hábil (8:00 a 19:00, lunes a sábado, sin festivos) y
          nunca en chats con una persona al frente, de prueba, ganados o perdidos. Los prospectos llevan el suyo.
        </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border bg-subtle px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{enabled ? "Encendido" : "Apagado"}</p>
            <p className="text-xs text-text-3">Cada plantilla enviada la cobra Meta como conversación nueva.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} label={esProspeccion ? "Seguimiento de prospectos" : "Seguimiento automático"} />
        </div>

        {datos.plantillas.length === 0 && (
          <p className="text-sm text-warning-text">
            No hay plantillas aprobadas. Crea una en Ajustes → Plantillas y espera a que Meta la apruebe.
          </p>
        )}

        {!esProspeccion && (
          <div className="space-y-3 rounded-lg border px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Secuencia por etapa</p>
                <p className="text-xs text-text-3">
                  Cada situación con su mensaje. Los días cuentan desde que entró a la etapa o desde tu último mensaje
                  sin respuesta. Las etapas sin marcar no reciben nada.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={cargarRecomendacion} disabled={etapas.length === 0}>
                Cargar recomendación
              </Button>
            </div>
            <SeguimientoEtapas etapas={etapas} plantillas={datos.plantillas} valor={porEtapa} onChange={setPorEtapa} />
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={incluirAtendidos}
                onChange={(e) => setIncluirAtendidos(e.target.checked)}
              />
              <span>
                Incluir chats que atiende una persona. Solo reciben las plantillas de su etapa; nunca se les escribe
                si contestaron.
              </span>
            </label>
          </div>
        )}

        {!porEtapaActiva && pasos.map((p, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Label htmlFor={`${clave}-dias-${i}`}>Paso {i + 1}: a los</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${clave}-dias-${i}`}
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
        {!porEtapaActiva && pasos.length < 3 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPasos((ps) => [...ps, { dias: (ps.at(-1)?.dias ?? 0) + 3, templateId: primera }])}
          >
            Agregar paso
          </Button>
        )}

        {!esProspeccion && !porEtapaActiva && (
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
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void enviar()}>
            Guardar
          </Button>
          {estado && <span className="text-xs text-text-3">{estado}</span>}
        </div>

        {!esProspeccion && datos.ultimos.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Lo último que hizo</p>
            {datos.ultimos.map((u, i) => (
              <p key={i} className="text-xs text-text-2">
                {fecha(u.createdAt)} · {u.nombre} ·{" "}
                {u.step === 0
                  ? "acción final"
                  : u.step === 201
                    ? "recordatorio de demo"
                    : u.step > 100
                      ? "no asistió"
                      : `paso ${u.step}`}
                {u.ok ? "" : ` · no se envió: ${u.error ?? "error"}`}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const NO_ASISTIO_VACIO: AjustesNoAsistio = { enabled: false, minutos: 10, plantilla1: null, dias2: 1, plantilla2: null };

/**
 * 073 — Lo que pasa alrededor de la demo: el valor con que entra un lead a
 * «Demo agendada» y la recuperación de quien no asistió.
 */
function Demos({ datos, onGuardado }: { datos: Datos; onGuardado: () => Promise<void> }) {
  const n = datos.ajustes.noAsistio ?? NO_ASISTIO_VACIO;
  const [valor, setValor] = useState(
    datos.ajustes.valorDemoCents ? String(Math.round(datos.ajustes.valorDemoCents / 100)) : ""
  );
  const [enabled, setEnabled] = useState(n.enabled);
  const [minutos, setMinutos] = useState(String(n.minutos));
  const [plantilla1, setPlantilla1] = useState(n.plantilla1 ?? "");
  const [dias2, setDias2] = useState(String(n.dias2));
  const [plantilla2, setPlantilla2] = useState(n.plantilla2 ?? "");
  const [estado, setEstado] = useState<string | null>(null);
  // 077 — Recordatorio N minutos antes de la demo.
  const rec = datos.ajustes.recordatorio ?? { enabled: false, minutos: 15, plantilla: null };
  const [recEnabled, setRecEnabled] = useState(rec.enabled);
  const [recMinutos, setRecMinutos] = useState(String(rec.minutos));
  const [recPlantilla, setRecPlantilla] = useState(
    rec.plantilla ?? datos.plantillas.find((t) => t.name === "recordatorio_demostracion")?.id ?? ""
  );

  async function enviar() {
    if (enabled && !plantilla1) return setEstado("Elige la plantilla del primer mensaje");
    if (recEnabled && !recPlantilla) return setEstado("Elige la plantilla del recordatorio");
    const pesos = Number(valor.replace(/\D/g, ""));
    const e = await guardar({
      valorDemoCents: pesos > 0 ? pesos * 100 : null,
      noAsistio: {
        enabled,
        minutos: Math.min(240, Math.max(1, Number(minutos) || 10)),
        plantilla1: plantilla1 || null,
        dias2: Math.min(14, Math.max(1, Number(dias2) || 1)),
        plantilla2: plantilla2 || null,
      },
      recordatorio: {
        enabled: recEnabled,
        minutos: Math.min(240, Math.max(5, Number(recMinutos) || 15)),
        plantilla: recPlantilla || null,
      },
    });
    setEstado(e ?? "Guardado.");
    if (!e) await onGuardado();
  }

  const selectPlantilla = (valorSel: string, set: (v: string) => void, etiqueta: string, vacio: string) => (
    <SelectNativo value={valorSel} onChange={(e) => set(e.target.value)} aria-label={etiqueta}>
      <option value="">{vacio}</option>
      {datos.plantillas.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </SelectNativo>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demos</CardTitle>
        <CardDescription>
          Al marcar una cita como realizada o no asistió, el lead pasa solo a «Demo hecha» o «No asistió». Quien no
          asistió no se pierde: recibe un mensaje, pasa a «Seguimiento» y, si no contesta, un segundo mensaje.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="valor-demo">Valor esperado del trato al agendar la demo</Label>
          <Input
            id="valor-demo"
            inputMode="numeric"
            placeholder="Sin valor"
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
            className="w-32"
          />
          <span className="text-xs text-text-3">
            pesos: lo que pagaría si compra (la demo es gratis). Solo si el lead no tiene valor todavía.
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-subtle px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Recordatorio antes de la demo: {recEnabled ? "encendido" : "apagado"}</p>
            <p className="text-xs text-text-3">
              Le llega con su nombre, el día, la hora y el enlace de la reunión. Una vez por cita; si se reagenda, sale
              de nuevo.
            </p>
          </div>
          <Switch checked={recEnabled} onCheckedChange={setRecEnabled} label="Recordatorio antes de la demo" />
        </div>
        <div className="grid items-end gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="rec-minutos">Enviar</Label>
            <div className="flex items-center gap-2">
              <Input
                id="rec-minutos"
                inputMode="numeric"
                value={recMinutos}
                onChange={(e) => setRecMinutos(e.target.value.replace(/\D/g, ""))}
                className="w-16"
              />
              <span className="text-xs text-text-3">min antes</span>
            </div>
          </div>
          {selectPlantilla(recPlantilla, setRecPlantilla, "Plantilla del recordatorio", "Elige una plantilla")}
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-subtle px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Recuperar a quien no asistió: {enabled ? "encendido" : "apagado"}</p>
            <p className="text-xs text-text-3">Solo con plantillas aprobadas por Meta y en horario hábil.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} label="Recuperar a quien no asistió" />
        </div>

        <div className="grid items-end gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="na-minutos">Primer mensaje a los</Label>
            <div className="flex items-center gap-2">
              <Input
                id="na-minutos"
                inputMode="numeric"
                value={minutos}
                onChange={(e) => setMinutos(e.target.value.replace(/\D/g, ""))}
                className="w-16"
              />
              <span className="text-xs text-text-3">min</span>
            </div>
          </div>
          {selectPlantilla(plantilla1, setPlantilla1, "Plantilla del primer mensaje", "Elige una plantilla")}
        </div>
        <div className="grid items-end gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="na-dias">Si no contesta, a los</Label>
            <div className="flex items-center gap-2">
              <Input
                id="na-dias"
                inputMode="numeric"
                value={dias2}
                onChange={(e) => setDias2(e.target.value.replace(/\D/g, ""))}
                className="w-16"
              />
              <span className="text-xs text-text-3">días</span>
            </div>
          </div>
          {selectPlantilla(plantilla2, setPlantilla2, "Plantilla del segundo mensaje", "Sin segundo mensaje")}
        </div>

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
