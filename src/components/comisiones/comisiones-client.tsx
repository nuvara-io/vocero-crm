"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Download, Plus, UserRoundSearch, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SelectNativo } from "@/components/ui/select-nativo";
import { CANALES, CANALES_MANUALES, esCanal, porcentajeLegible } from "@/lib/comisiones";
import { centavosDesdePesos, mesLegible, pesos } from "@/lib/pesos";
import { cn } from "@/lib/utils";

type Venta = {
  id: string;
  customerName: string | null;
  platformOrgId: string;
  amountCents: number;
  paidAt: string;
  referralCode: string | null;
  attributionSource: "codigo" | "responsable" | "manual" | null;
  voidedAt: string | null;
  voidReason: string | null;
  origin: "plataforma" | "manual";
  channel: string | null;
  status: "por_confirmar" | "confirmada" | "rechazada" | "reemplazada";
  customerEmail: string | null;
  note: string | null;
  reviewNote: string | null;
  createdByName: string | null;
};

type Liquidacion = {
  salesCount: number;
  salesTotalCents: number;
  ivaBps: number;
  salesNetCents: number;
  baseCents: number;
  rateBps: number;
  comisiona: boolean;
  reached: boolean;
  faltaCents: number;
  brutaCents: number;
  adjustmentCents: number;
  commissionCents: number;
};

type Fila = {
  userId: string;
  name: string;
  email: string;
  estado: "pendiente" | "aprobada" | "pagada";
  liquidacion: Liquidacion;
  approvedAt: string | null;
  approvedByName: string | null;
  paidAt: string | null;
  paidByName: string | null;
  note: string | null;
  ventas: Venta[];
  descuentos: (Venta & { adjustmentCents: number })[];
};

type Resumen = {
  period: string;
  cerrado: boolean;
  filas: Fila[];
  sinAtribuir: Venta[];
  porConfirmar: (Venta & { attributedUserId: string | null; attributedName: string | null })[];
  ivaBps: number;
  admin: boolean;
  equipo: { userId: string; name: string }[];
  yo: string;
};

function mover(periodo: string, delta: number): string {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(new Date(iso));

const FUENTE: Record<string, string> = {
  codigo: "Por código",
  responsable: "Por responsable",
  manual: "Asignada a mano",
};

async function enviar(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res?.ok) return null;
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? "No se pudo guardar. Revisa tu conexión.";
}

/**
 * 068 — Comisiones del mes. Quien administra ve a todo el equipo, aprueba,
 * marca pagado, reasigna y exporta; una vendedora ve solo su avance.
 */
export function ComisionesClient({ mesActual }: { mesActual: string }) {
  const [periodo, setPeriodo] = useState(mesActual);
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch(`/api/comisiones?periodo=${periodo}`).catch(() => null);
    const body = (await res?.json().catch(() => null)) as (Resumen & { error?: { message?: string } }) | null;
    setCargando(false);
    if (!res?.ok || !body) {
      setError(body?.error?.message ?? "No se pudo cargar. Revisa tu conexión.");
      return;
    }
    setError(null);
    setDatos(body);
  }, [periodo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const admin = datos?.admin ?? false;
  const [registrando, setRegistrando] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Comisiones</h2>
          <p className="text-xs text-text-3">
            Primer pago de cada cliente, sobre el valor neto (sin IVA).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-border-strong bg-card">
            <button
              aria-label="Mes anterior"
              onClick={() => setPeriodo((p) => mover(p, -1))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <span className="min-w-[9.5rem] text-center text-[13px] font-semibold">
              {mesLegible(periodo)}
            </span>
            <button
              aria-label="Mes siguiente"
              disabled={periodo >= mesActual}
              onClick={() => setPeriodo((p) => mover(p, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
          {datos && (
            <Button variant="outline" onClick={() => setRegistrando((v) => !v)} aria-expanded={registrando}>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              Registrar venta
            </Button>
          )}
          {admin && (
            <a
              href={`/api/comisiones/export?periodo=${periodo}`}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-semibold hover:border-foreground"
            >
              <Download className="h-4 w-4" strokeWidth={1.8} />
              Exportar
            </a>
          )}
        </div>
      </header>

      <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6", cargando && "opacity-60")}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {registrando && datos && (
          <RegistrarVenta
            admin={admin}
            equipo={datos.equipo}
            yo={datos.yo}
            onCerrar={() => setRegistrando(false)}
            onGuardada={async () => {
              setRegistrando(false);
              await cargar();
            }}
          />
        )}

        {datos && datos.porConfirmar.length > 0 && (
          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-warning-text" strokeWidth={1.8} />
              <p className="text-sm font-semibold">Por confirmar · {datos.porConfirmar.length}</p>
            </div>
            <p className="mb-3 text-[13px] text-text-3">
              {admin
                ? "Ventas registradas a mano porque entraron por otro WhatsApp u otro canal. Solo cuentan cuando las confirmas."
                : "Ventas que registraste a mano. Cuentan cuando las confirme quien administra."}
            </p>
            <div className="space-y-2">
              {datos.porConfirmar.map((v) => (
                <FilaPorConfirmar key={v.id} venta={v} admin={admin} onCambio={cargar} />
              ))}
            </div>
          </Card>
        )}

        {datos && admin && !datos.cerrado && datos.filas.length > 0 && (
          <p className="rounded-lg border bg-subtle px-4 py-2.5 text-[13px] text-text-2">
            El mes sigue en curso: los números se mueven con cada pago y se aprueban cuando termine.
          </p>
        )}

        {datos && datos.filas.length === 0 && datos.sinAtribuir.length === 0 && datos.porConfirmar.length === 0 && (
          <Card className="border-dashed">
            <EmptyState
              icon={Wallet}
              title="Sin ventas este mes"
              description={
                admin
                  ? "Cuando la plataforma confirme el primer pago de un cliente, aparece aquí con la persona que lo trajo. Las condiciones de cada quien se ponen en Ajustes → Equipo."
                  : "Cuando un cliente tuyo haga su primer pago, aparece aquí. Si entró por otro WhatsApp u otro canal, regístralo con «Registrar venta»."
              }
            />
          </Card>
        )}

        {datos?.filas.map((f) => (
          <TarjetaPersona
            key={f.userId}
            fila={f}
            periodo={datos.period}
            cerrado={datos.cerrado}
            admin={admin}
            propia={f.userId === datos.yo}
            equipo={datos.equipo}
            onCambio={cargar}
          />
        ))}

        {admin && datos && datos.sinAtribuir.length > 0 && (
          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <UserRoundSearch className="h-4 w-4 text-warning-text" strokeWidth={1.8} />
              <p className="text-sm font-semibold">Sin atribuir · {datos.sinAtribuir.length}</p>
            </div>
            <p className="mb-3 text-[13px] text-text-3">
              El cliente no escribió un código y no encontramos su contacto con responsable. Asígnala a quien la
              trajo.
            </p>
            <div className="space-y-2">
              {datos.sinAtribuir.map((v) => (
                <FilaVenta key={v.id} venta={v} admin equipo={datos.equipo} reasignable onCambio={cargar} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: Fila["estado"] }) {
  if (estado === "pagada") return <Badge variant="success">Pagada</Badge>;
  if (estado === "aprobada") return <Badge variant="default">Aprobada</Badge>;
  return <Badge variant="secondary">Pendiente</Badge>;
}

function TarjetaPersona({
  fila,
  periodo,
  cerrado,
  admin,
  propia,
  equipo,
  onCambio,
}: {
  fila: Fila;
  periodo: string;
  cerrado: boolean;
  admin: boolean;
  propia: boolean;
  equipo: Resumen["equipo"];
  onCambio: () => Promise<void>;
}) {
  const [abierta, setAbierta] = useState(!admin);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const l = fila.liquidacion;
  const avance = l.baseCents > 0 ? Math.min(100, Math.round((l.salesNetCents / l.baseCents) * 100)) : 100;

  async function accion(nombre: "aprobar" | "pagar" | "reabrir") {
    if (nombre === "reabrir" && !window.confirm("¿Reabrir este mes? Se vuelve a calcular con los datos de hoy.")) return;
    setOcupado(true);
    const e = await enviar("/api/comisiones/liquidaciones", { userId: fila.userId, periodo, accion: nombre });
    setOcupado(false);
    setError(e);
    if (!e) await onCambio();
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold">{propia && !admin ? "Tu mes" : fila.name}</p>
            <EstadoBadge estado={fila.estado} />
          </div>
          <p className="mt-0.5 text-[13px] text-text-3">
            {l.salesCount === 1 ? "1 venta" : `${l.salesCount} ventas`} · {pesos(l.salesNetCents)} neto
            {l.ivaBps > 0 && l.salesTotalCents > 0 ? ` (pagado ${pesos(l.salesTotalCents)})` : ""}
            {l.comisiona ? ` · ${porcentajeLegible(l.rateBps)} desde ${pesos(l.baseCents)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Comisión</p>
          <p
            className={cn(
              "text-xl font-bold tabular-nums tracking-tight",
              l.commissionCents < 0 && "text-danger-text"
            )}
          >
            {l.comisiona || l.adjustmentCents !== 0 ? pesos(l.commissionCents) : "No comisiona"}
          </p>
        </div>
      </div>

      {l.comisiona && fila.estado === "pendiente" && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-subtle">
            <div
              className={cn("h-full rounded-full", l.reached ? "bg-success" : "bg-primary")}
              style={{ width: `${avance}%` }}
            />
          </div>
          <p className="mt-1.5 text-[13px] text-text-2">
            {l.reached
              ? `Llegó a la base: comisiona sobre todo lo del mes.`
              : `Le faltan ${pesos(l.faltaCents)} netos para la base de ${pesos(l.baseCents)}.`}
          </p>
        </div>
      )}

      {l.adjustmentCents !== 0 && (
        <p className="mt-2 text-[13px] text-danger-text">
          Descuento de {pesos(-l.adjustmentCents)} por pagos anulados de meses ya aprobados.
        </p>
      )}

      {fila.estado !== "pendiente" && (
        <p className="mt-2 text-xs text-text-3">
          Aprobada {fila.approvedAt ? fecha(fila.approvedAt) : ""}
          {fila.approvedByName ? ` por ${fila.approvedByName}` : ""}
          {fila.paidAt ? ` · pagada ${fecha(fila.paidAt)}${fila.paidByName ? ` por ${fila.paidByName}` : ""}` : ""}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(fila.ventas.length > 0 || fila.descuentos.length > 0) && (
          <Button variant="ghost" size="sm" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", abierta && "rotate-180")} />
            {abierta ? "Ocultar ventas" : "Ver ventas"}
          </Button>
        )}
        {admin && fila.estado === "pendiente" && cerrado && (
          <Button size="sm" disabled={ocupado} onClick={() => void accion("aprobar")}>
            Aprobar {pesos(l.commissionCents)}
          </Button>
        )}
        {admin && fila.estado === "aprobada" && (
          <>
            <Button size="sm" disabled={ocupado} onClick={() => void accion("pagar")}>
              Marcar pagada
            </Button>
            <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void accion("reabrir")}>
              Reabrir
            </Button>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {abierta && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {fila.ventas.map((v) => (
            <FilaVenta
              key={v.id}
              venta={v}
              admin={admin}
              equipo={equipo}
              reasignable={admin && fila.estado === "pendiente"}
              onCambio={onCambio}
            />
          ))}
          {fila.descuentos.map((d) => (
            <div key={`d-${d.id}`} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-text-2">
                Anulado: {d.customerName ?? d.platformOrgId} ({fecha(d.paidAt)})
              </span>
              <span className="tabular-nums text-danger-text">{pesos(d.adjustmentCents)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function FilaVenta({
  venta,
  admin,
  equipo,
  reasignable,
  onCambio,
}: {
  venta: Venta;
  admin: boolean;
  equipo: Resumen["equipo"];
  reasignable: boolean;
  onCambio: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anulada = Boolean(venta.voidedAt) || venta.status === "rechazada";

  async function guardar() {
    setOcupado(true);
    const e = await enviar(`/api/comisiones/ventas/${venta.id}/atribucion`, {
      userId: destino || null,
      motivo,
    });
    setOcupado(false);
    setError(e);
    if (!e) {
      setEditando(false);
      await onCambio();
    }
  }

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("truncate text-[13px] font-semibold", anulada && "line-through opacity-60")}>
            {venta.customerName ?? `Cliente ${venta.platformOrgId}`}
          </p>
          <p className="text-xs text-text-3">
            {fecha(venta.paidAt)}
            {venta.channel && esCanal(venta.channel)
              ? ` · ${CANALES[venta.channel]}`
              : venta.attributionSource
                ? ` · ${FUENTE[venta.attributionSource]}`
                : ""}
            {venta.status === "por_confirmar" ? " · Por confirmar" : ""}
            {venta.status === "rechazada" ? ` · Rechazada${venta.reviewNote ? `: ${venta.reviewNote}` : ""}` : ""}
            {venta.referralCode ? ` (${venta.referralCode})` : ""}
            {anulada ? ` · Anulada: ${venta.voidReason ?? ""}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-[13px] font-semibold tabular-nums", anulada && "line-through opacity-60")}>
            {pesos(venta.amountCents)}
          </span>
          {admin && reasignable && !anulada && !editando && (
            <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
              {venta.attributionSource ? "Reasignar" : "Asignar"}
            </Button>
          )}
        </div>
      </div>
      {editando && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto_auto]">
          <SelectNativo tamano="sm" value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Persona">
            <option value="">Sin atribuir</option>
            {equipo.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </SelectNativo>
          <Input
            className="h-8 text-xs"
            placeholder="Motivo (queda registrado)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button size="sm" disabled={ocupado || motivo.trim().length < 3} onClick={() => void guardar()}>
            Guardar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
          {error && <p className="text-sm text-destructive sm:col-span-4">{error}</p>}
        </div>
      )}
    </div>
  );
}

const hoyISO = () => new Date().toLocaleDateString("en-CA");

function RegistrarVenta({
  admin,
  equipo,
  yo,
  onCerrar,
  onGuardada,
}: {
  admin: boolean;
  equipo: Resumen["equipo"];
  yo: string;
  onCerrar: () => void;
  onGuardada: () => Promise<void>;
}) {
  const [persona, setPersona] = useState(yo);
  const [cliente, setCliente] = useState("");
  const [email, setEmail] = useState("");
  const [canal, setCanal] = useState<string>("whatsapp_otro");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const montoCents = centavosDesdePesos(monto);
    if (!montoCents) return setError("Escribe lo que pagó el cliente, en pesos");
    setGuardando(true);
    const e = await enviar("/api/comisiones/ventas", {
      userId: admin ? persona : undefined,
      cliente,
      email: email.trim() || null,
      canal,
      montoCents,
      pagadoEn: fecha,
      nota: nota.trim() || null,
    });
    setGuardando(false);
    setError(e);
    if (!e) await onGuardada();
  }

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div>
        <p className="text-sm font-semibold">Registrar una venta de otro canal</p>
        <p className="text-[13px] text-text-3">
          Para un cliente que entró por otro WhatsApp, Instagram, una llamada o un referido.
          {admin ? " La que registras tú queda confirmada." : " Queda por confirmar hasta que la revise quien administra."}
          {" "}Si después paga en la plataforma con ese correo, el pago real la reemplaza.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {admin && (
          <label className="space-y-1.5 text-[13px] font-medium">
            <span>Quién la hizo</span>
            <SelectNativo value={persona} onChange={(e) => setPersona(e.target.value)}>
              {equipo.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </SelectNativo>
          </label>
        )}
        <label className="space-y-1.5 text-[13px] font-medium">
          <span>Canal</span>
          <SelectNativo value={canal} onChange={(e) => setCanal(e.target.value)}>
            {CANALES_MANUALES.map((c) => (
              <option key={c} value={c}>
                {CANALES[c]}
              </option>
            ))}
          </SelectNativo>
        </label>
        <label className="space-y-1.5 text-[13px] font-medium">
          <span>Cliente</span>
          <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre de la empresa" />
        </label>
        <label className="space-y-1.5 text-[13px] font-medium">
          <span>Correo con el que se registró</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
        </label>
        <label className="space-y-1.5 text-[13px] font-medium">
          <span>Lo que pagó (pesos, con IVA)</span>
          <Input inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="80.000" />
        </label>
        <label className="space-y-1.5 text-[13px] font-medium">
          <span>Fecha del pago</span>
          <Input type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1.5 text-[13px] font-medium">
        <span>Nota</span>
        <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. escribió al WhatsApp personal de Yuli" />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={guardando || cliente.trim().length < 2} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Registrar"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

function FilaPorConfirmar({
  venta,
  admin,
  onCambio,
}: {
  venta: Resumen["porConfirmar"][number];
  admin: boolean;
  onCambio: () => Promise<void>;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revisar(accion: "confirmar" | "rechazar") {
    setOcupado(true);
    const e = await enviar(`/api/comisiones/ventas/${venta.id}/revision`, { accion, nota: motivo.trim() || null });
    setOcupado(false);
    setError(e);
    if (!e) await onCambio();
  }

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{venta.customerName ?? "Cliente sin nombre"}</p>
          <p className="text-xs text-text-3">
            {fecha(venta.paidAt)}
            {venta.channel && esCanal(venta.channel) ? ` · ${CANALES[venta.channel]}` : ""}
            {admin && venta.attributedName ? ` · ${venta.attributedName}` : ""}
            {venta.customerEmail ? ` · ${venta.customerEmail}` : ""}
          </p>
          {venta.note && <p className="mt-0.5 text-xs text-text-2">{venta.note}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tabular-nums">{pesos(venta.amountCents)}</span>
          {admin && !rechazando && (
            <>
              <Button size="sm" disabled={ocupado} onClick={() => void revisar("confirmar")}>
                Confirmar
              </Button>
              <Button variant="outline" size="sm" disabled={ocupado} onClick={() => setRechazando(true)}>
                Rechazar
              </Button>
            </>
          )}
        </div>
      </div>
      {rechazando && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input
            className="h-8 text-xs"
            placeholder="Por qué se rechaza (lo ve quien la registró)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button size="sm" variant="destructive" disabled={ocupado || motivo.trim().length < 3} onClick={() => void revisar("rechazar")}>
            Rechazar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRechazando(false)}>
            Cancelar
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
