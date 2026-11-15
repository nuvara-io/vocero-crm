"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Phone, ShieldAlert, Target, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SelectNativo } from "@/components/ui/select-nativo";
import { StartConversation } from "@/components/contacts/start-conversation";
import {
  CANALES_PERMISO,
  horarioLey2300,
  leerHojaDeFirmas,
  rangoEncaje,
  TEXTO_PERMISO_SUGERIDO,
  TOPE_DIARIO_PROSPECTOS,
  type CanalPermiso,
  type FilaProspecto,
  type ProblemaFila,
} from "@/lib/prospeccion";
import { cn } from "@/lib/utils";

type Prospecto = {
  contactId: string;
  conversationId: string | null;
  nombre: string;
  telefono: string | null;
  lista: string;
  etapa: string | null;
  responsable: string | null;
  ficha: Record<string, unknown>;
  permisoPedido: string | null;
  permiso: { fecha: string; canal: string | null; texto: string | null } | null;
  primerContacto: string | null;
  suprimido: string | null;
  respondio: boolean;
  demo: boolean;
};

type Embudo = {
  firmas: number;
  permisosPedidos: number;
  permisosSi: number;
  contactados: number;
  respondieron: number;
  demos: number;
  bajas: number;
  bajasDeContactados: number;
};

type Estado = "por_pedir" | "pedido" | "con_permiso" | "contactado" | "respondio" | "baja";

const ESTADOS: Record<Estado, string> = {
  por_pedir: "Por pedir permiso",
  pedido: "Permiso pedido",
  con_permiso: "Con permiso, sin escribir",
  contactado: "Escrito, sin respuesta",
  respondio: "Respondió",
  baja: "No / baja",
};

function estadoDe(p: Prospecto): Estado {
  if (p.suprimido) return "baja";
  if (p.respondio) return "respondio";
  if (p.primerContacto) return "contactado";
  if (p.permiso) return "con_permiso";
  if (p.permisoPedido) return "pedido";
  return "por_pedir";
}

const txt = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso)
  );

async function enviar(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res?.ok) return null;
  const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return d?.error?.message ?? "No se pudo guardar";
}

/**
 * 072 — Prospección por WhatsApp. El orden es el del cerebro: primero el
 * permiso (por llamada, formulario o LinkedIn), y solo con el permiso, el
 * primer WhatsApp, uno a uno y en horario de la Ley 2300.
 */
export function ProspeccionClient() {
  const [datos, setDatos] = useState<{ prospectos: Prospecto[]; embudo: Embudo; admin: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado | "">("por_pedir");
  const [encaje, setEncaje] = useState("");
  const [region, setRegion] = useState("");
  const [buscar, setBuscar] = useState("");
  const [importando, setImportando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/prospeccion").catch(() => null);
    if (!res?.ok) return setError("No se pudo cargar la prospección.");
    setError(null);
    setDatos(await res.json());
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const regiones = useMemo(
    () => [...new Set((datos?.prospectos ?? []).map((p) => txt(p.ficha.region)).filter(Boolean))].sort(),
    [datos]
  );

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (datos?.prospectos ?? [])
      .filter((p) => !estado || estadoDe(p) === estado)
      .filter((p) => !encaje || txt(p.ficha.encaje) === encaje)
      .filter((p) => !region || txt(p.ficha.region) === region)
      .filter((p) => !q || `${p.nombre} ${txt(p.ficha.ciudad)} ${p.telefono ?? ""}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          rangoEncaje(txt(a.ficha.encaje)) - rangoEncaje(txt(b.ficha.encaje)) ||
          txt(a.ficha.region).localeCompare(txt(b.ficha.region)) ||
          a.nombre.localeCompare(b.nombre)
      );
  }, [datos, estado, encaje, region, buscar]);

  const e = datos?.embudo;
  const tasaBajas = e && e.contactados > 0 ? e.bajasDeContactados / e.contactados : 0;
  const enHorario = horarioLey2300(new Date());

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Prospección</h2>
          <p className="text-xs text-text-3">
            Primero el permiso, después el WhatsApp: uno a uno, máximo {TOPE_DIARIO_PROSPECTOS} nuevos al día.
          </p>
        </div>
        {datos?.admin && (
          <Button variant="outline" onClick={() => setImportando((v) => !v)} aria-expanded={importando}>
            <Upload className="h-4 w-4" strokeWidth={1.8} />
            Importar lista
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {importando && (
          <Importar
            onListo={async () => {
              setImportando(false);
              await cargar();
            }}
          />
        )}

        {e && e.firmas > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ["Firmas", e.firmas],
                ["Permiso pedido", e.permisosPedidos],
                ["Permiso sí", e.permisosSi],
                ["Escritas", e.contactados],
                ["Respondieron", e.respondieron],
                ["Demos", e.demos],
                ["Bajas", e.bajas],
              ] as [string, number][]
            ).map(([t, n]) => (
              <Card key={t} className="px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{t}</p>
                <p className="text-xl font-bold tabular-nums">{n}</p>
              </Card>
            ))}
          </div>
        )}

        {tasaBajas > 0.1 && (
          <p className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint px-4 py-2.5 text-[13px] text-danger-text">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            Más de 1 de cada 10 escritas terminó en baja. Pausen la prospección nueva y revisen la lista y los
            mensajes antes de seguir: los reportes pueden suspender el número.
          </p>
        )}
        {!enHorario && (
          <p className="rounded-lg border bg-subtle px-4 py-2.5 text-[13px] text-text-2">
            Ahora no es horario para escribir (Ley 2300: lunes a viernes 7:00–19:00, sábados 8:00–15:00, sin
            domingos ni festivos). Se pueden registrar permisos; los mensajes esperan.
          </p>
        )}

        {datos && datos.prospectos.length === 0 && !importando && (
          <Card className="border-dashed">
            <EmptyState
              icon={Target}
              title="Sin prospectos todavía"
              description="Importa la lista de firmas (el Excel del equipo o un CSV con las columnas «Firma» y «WhatsApp publicado»)."
            />
          </Card>
        )}

        {datos && datos.prospectos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <SelectNativo tamano="sm" value={estado} onChange={(ev) => setEstado(ev.target.value as Estado | "")} aria-label="Estado">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v} ({datos.prospectos.filter((p) => estadoDe(p) === k).length})
                </option>
              ))}
            </SelectNativo>
            <SelectNativo tamano="sm" value={encaje} onChange={(ev) => setEncaje(ev.target.value)} aria-label="Encaje">
              <option value="">Todo encaje</option>
              <option value="Alto">Encaje alto</option>
              <option value="Medio">Encaje medio</option>
              <option value="Bajo">Encaje bajo</option>
            </SelectNativo>
            <SelectNativo tamano="sm" value={region} onChange={(ev) => setRegion(ev.target.value)} aria-label="Región">
              <option value="">Todas las regiones</option>
              {regiones.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectNativo>
            <Input
              className="h-8 w-48 text-xs"
              placeholder="Buscar firma o ciudad"
              value={buscar}
              onChange={(ev) => setBuscar(ev.target.value)}
            />
            <span className="text-xs text-text-3">{visibles.length} en la vista</span>
          </div>
        )}

        <div className="space-y-2">
          {visibles.map((p) => (
            <FilaProspecto key={p.contactId} p={p} onCambio={cargar} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilaProspecto({ p, onCambio }: { p: Prospecto; onCambio: () => Promise<void> }) {
  const [panel, setPanel] = useState<"" | "permiso" | "escribir">("");
  const [canal, setCanal] = useState<CanalPermiso>("llamada");
  const [texto, setTexto] = useState(TEXTO_PERMISO_SUGERIDO);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const est = estadoDe(p);
  const f = p.ficha;
  const encaje = txt(f.encaje);

  async function accion(body: unknown) {
    setOcupado(true);
    const e = await enviar(`/api/prospeccion/${p.contactId}`, body);
    setOcupado(false);
    setError(e);
    if (!e) {
      setPanel("");
      await onCambio();
    }
  }

  return (
    <Card className={cn("p-4", est === "baja" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold">{p.nombre}</p>
            {encaje && (
              <Badge variant={encaje === "Alto" ? "success" : encaje === "Medio" ? "secondary" : "outline"}>
                Encaje {encaje.toLowerCase()}
              </Badge>
            )}
            <Badge variant={est === "baja" ? "destructive" : est === "respondio" ? "success" : "secondary"}>
              {ESTADOS[est]}
            </Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-text-2">
            {[txt(f.ciudad), txt(f.servicios), txt(f.tamano)].filter(Boolean).join(" · ")}
          </p>
          {txt(f.programa) && <p className="text-xs text-text-3">Programa: {txt(f.programa)}</p>}
          {txt(f.aviso) && <p className="mt-1 text-xs font-medium text-warning-text">{txt(f.aviso)}</p>}
          {p.permiso && (
            <p className="mt-1 text-xs text-text-3">
              Permiso {fecha(p.permiso.fecha)} por {CANALES_PERMISO[p.permiso.canal as CanalPermiso] ?? p.permiso.canal}
            </p>
          )}
          {p.responsable && <p className="text-xs text-text-3">Responsable: {p.responsable}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.telefono && (
            <a
              href={`tel:+${p.telefono}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--btn-radius,9999px)] border border-border-strong px-3 text-xs font-semibold hover:border-foreground"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={1.8} />+{p.telefono}
            </a>
          )}
          {txt(f.sitio) && (
            <a
              href={txt(f.sitio)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--btn-radius,9999px)] border border-border-strong px-3 text-xs font-semibold hover:border-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
              Sitio
            </a>
          )}
        </div>
      </div>

      {est !== "baja" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {est === "por_pedir" && (
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void accion({ accion: "permiso_pedido" })}>
              Pedí permiso
            </Button>
          )}
          {!p.permiso && (
            <Button size="sm" disabled={ocupado} onClick={() => setPanel(panel === "permiso" ? "" : "permiso")}>
              Dio permiso
            </Button>
          )}
          {p.permiso && !p.respondio && (
            <Button size="sm" onClick={() => setPanel(panel === "escribir" ? "" : "escribir")}>
              {p.primerContacto ? "Escribir de nuevo" : "Escribir por WhatsApp"}
            </Button>
          )}
          {p.conversationId && (
            <Link
              href={`/inbox/${p.conversationId}`}
              className="text-xs font-semibold text-brand-ink underline underline-offset-2"
            >
              Abrir chat
            </Link>
          )}
          {!p.permiso && (
            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => void accion({ accion: "permiso_no" })}>
              No dio permiso
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => void accion({ accion: "baja" })}>
            Baja
          </Button>
        </div>
      )}

      {panel === "permiso" && (
        <div className="mt-3 space-y-2 rounded-lg border bg-subtle p-3">
          <p className="text-[13px] font-semibold">¿Por dónde dio el permiso y qué aceptó?</p>
          <SelectNativo tamano="sm" value={canal} onChange={(ev) => setCanal(ev.target.value as CanalPermiso)} envoltura="max-w-xs" aria-label="Canal del permiso">
            {Object.entries(CANALES_PERMISO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectNativo>
          <textarea
            value={texto}
            onChange={(ev) => setTexto(ev.target.value)}
            rows={3}
            className="w-full rounded-md border border-border-strong bg-card px-3 py-2 text-[13px]"
            aria-label="Texto que aceptó"
          />
          <p className="text-xs text-text-3">Queda guardado con la fecha y quién lo registró (Ley 1581).</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={ocupado || texto.trim().length < 10} onClick={() => void accion({ accion: "permiso_si", canal, texto })}>
              Guardar permiso
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel("")}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {panel === "escribir" && (
        <div className="mt-3 rounded-lg border bg-subtle p-3">
          <StartConversation
            contactId={p.contactId}
            onStarted={async () => {
              setPanel("");
              await onCambio();
            }}
          />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Card>
  );
}

function Importar({ onListo }: { onListo: () => Promise<void> }) {
  const [filas, setFilas] = useState<unknown[][] | null>(null);
  const [vista, setVista] = useState<{ filas: FilaProspecto[]; problemas: ProblemaFila[] } | null>(null);
  const [lista, setLista] = useState("");
  const [estado, setEstado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ creados: number; yaEnCrm: { nombre: string; etapa: string | null }[] } | null>(null);

  async function leer(file: File) {
    setEstado(null);
    setResultado(null);
    setLista(file.name.replace(/\.(xlsx|csv)$/i, ""));
    let datos: unknown[][] = [];
    if (/\.xlsx$/i.test(file.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const hojas = await readXlsxFile(file);
      const hoja =
        hojas.find((h) => /firmas/i.test(h.sheet)) ??
        hojas.find((h) => h.data.some((r) => r.some((c) => String(c ?? "").trim().toLowerCase() === "firma")));
      datos = (hoja?.data ?? []) as unknown[][];
    } else {
      const { parseCsv } = await import("@/lib/contact-import");
      datos = parseCsv(await file.text());
    }
    const limpias = datos.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c ?? null)));
    setFilas(limpias);
    setVista(leerHojaDeFirmas(limpias));
  }

  async function importar() {
    if (!filas) return;
    setEstado("Importando…");
    const res = await fetch("/api/prospeccion/importar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lista, filas }),
    }).catch(() => null);
    const d = (await res?.json().catch(() => null)) as
      | { creados: number; yaEnCrm: { nombre: string; etapa: string | null }[]; error?: { message?: string } }
      | null;
    if (!res?.ok || !d) return setEstado(d?.error?.message ?? "No se pudo importar");
    setEstado(null);
    setResultado(d);
  }

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div>
        <p className="text-sm font-semibold">Importar lista de firmas</p>
        <p className="text-[13px] text-text-3">
          El Excel del equipo (hoja «Firmas») o un CSV con «Firma» y «WhatsApp publicado». Quien ya esté en el CRM
          no se duplica. Entran en «Prospecto», con el agente apagado y la ficha llena.
        </p>
      </div>
      <input
        type="file"
        accept=".xlsx,.csv"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) void leer(f);
        }}
        className="text-sm"
        aria-label="Archivo de la lista"
      />
      {vista && !resultado && (
        <div className="space-y-2">
          <p className="text-[13px]">
            <strong>{vista.filas.length}</strong> firmas listas para importar
            {vista.problemas.length > 0 && `, ${vista.problemas.length} con problemas`}.
          </p>
          {vista.problemas.slice(0, 8).map((p) => (
            <p key={p.linea} className="text-xs text-warning-text">
              Renglón {p.linea} {p.nombre}: {p.motivo}
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-72 text-xs" value={lista} onChange={(ev) => setLista(ev.target.value)} aria-label="Nombre de la lista" />
            <Button size="sm" disabled={vista.filas.length === 0 || lista.trim().length < 2} onClick={() => void importar()}>
              Importar {vista.filas.length}
            </Button>
          </div>
        </div>
      )}
      {estado && <p className="text-sm text-text-2">{estado}</p>}
      {resultado && (
        <div className="space-y-1 text-[13px]">
          <p>
            Listo: <strong>{resultado.creados}</strong> prospectos nuevos.
          </p>
          {resultado.yaEnCrm.length > 0 && (
            <>
              <p className="text-text-2">{resultado.yaEnCrm.length} ya estaban en el CRM y no se tocaron:</p>
              {resultado.yaEnCrm.slice(0, 12).map((y) => (
                <p key={y.nombre} className="text-xs text-text-3">
                  {y.nombre}
                  {y.etapa ? ` · ${y.etapa}` : ""}
                </p>
              ))}
            </>
          )}
          <Button size="sm" onClick={() => void onListo()}>
            Ver la lista
          </Button>
        </div>
      )}
    </Card>
  );
}
