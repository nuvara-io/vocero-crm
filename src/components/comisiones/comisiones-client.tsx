"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, UserRoundSearch, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SelectNativo } from "@/components/ui/select-nativo";
import { porcentajeLegible } from "@/lib/comisiones";
import { mesLegible, pesos } from "@/lib/pesos";
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
};

type Liquidacion = {
  salesCount: number;
  salesTotalCents: number;
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Comisiones</h2>
          <p className="text-xs text-text-3">
            Primer pago de cada cliente, con el pago ya confirmado en la plataforma.
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

        {datos && admin && !datos.cerrado && datos.filas.length > 0 && (
          <p className="rounded-lg border bg-subtle px-4 py-2.5 text-[13px] text-text-2">
            El mes sigue en curso: los números se mueven con cada pago y se aprueban cuando termine.
          </p>
        )}

        {datos && datos.filas.length === 0 && datos.sinAtribuir.length === 0 && (
          <Card className="border-dashed">
            <EmptyState
              icon={Wallet}
              title="Sin ventas este mes"
              description={
                admin
                  ? "Cuando la plataforma confirme el primer pago de un cliente, aparece aquí con la persona que lo trajo. Las condiciones de cada quien se ponen en Ajustes → Equipo."
                  : "Cuando un cliente tuyo haga su primer pago, aparece aquí."
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
  const avance = l.baseCents > 0 ? Math.min(100, Math.round((l.salesTotalCents / l.baseCents) * 100)) : 100;

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
            {l.salesCount === 1 ? "1 venta" : `${l.salesCount} ventas`} · {pesos(l.salesTotalCents)}
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
              : `Le faltan ${pesos(l.faltaCents)} para la base de ${pesos(l.baseCents)}.`}
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
  const anulada = Boolean(venta.voidedAt);

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
            {venta.attributionSource ? ` · ${FUENTE[venta.attributionSource]}` : ""}
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
