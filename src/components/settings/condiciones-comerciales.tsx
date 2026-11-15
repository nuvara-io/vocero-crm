"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { bpsDesdeTexto, porcentajeLegible } from "@/lib/comisiones";
import { centavosDesdePesos, pesos } from "@/lib/pesos";

type Version = {
  comisiona: boolean;
  rateBps: number;
  monthlyBaseCents: number;
  referralCode: string | null;
  validFrom: string;
  createdAt: string;
};

type Persona = {
  userId: string;
  name: string;
  email: string;
  vigente: Version | null;
  versiones: Version[];
};

const fecha = (dia: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${dia}T12:00:00Z`)
  );

/**
 * 068 — Las condiciones comerciales de cada persona: si comisiona, el %, la
 * base del mes y su código de referido. Cada cambio queda como una versión
 * con fecha de inicio; los meses ya pasados no se recalculan.
 */
export function CondicionesComerciales() {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [hoy, setHoy] = useState("");
  const [editando, setEditando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/comisiones/perfiles").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { hoy: string; personas: Persona[] };
    setHoy(data.hoy);
    setPersonas(data.personas);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!personas) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Condiciones comerciales</CardTitle>
        <CardDescription>
          Quién comisiona, con qué porcentaje y desde qué base del mes. Si en el mes llega a la base, comisiona
          sobre todo lo vendido. El código es el que el cliente escribe al activar en la plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {personas.map((p) =>
          editando === p.userId ? (
            <Editor
              key={p.userId}
              persona={p}
              hoy={hoy}
              onCancelar={() => setEditando(null)}
              onGuardado={async () => {
                setEditando(null);
                await cargar();
              }}
            />
          ) : (
            <Resumen key={p.userId} persona={p} hoy={hoy} onEditar={() => setEditando(p.userId)} />
          )
        )}
      </CardContent>
    </Card>
  );
}

function Resumen({ persona, hoy, onEditar }: { persona: Persona; hoy: string; onEditar: () => void }) {
  const [historial, setHistorial] = useState(false);
  const v = persona.vigente;
  const programada = persona.versiones.find((x) => x.validFrom > hoy);
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{persona.name}</p>
          <p className="text-xs text-text-3">
            {!v
              ? "Sin condiciones: sus ventas cuentan, pero no comisiona"
              : v.comisiona
                ? `${porcentajeLegible(v.rateBps)} desde ${pesos(v.monthlyBaseCents)} al mes`
                : "No comisiona"}
            {v ? ` · desde ${fecha(v.validFrom)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {v?.referralCode && <Badge variant="secondary">{v.referralCode}</Badge>}
          {persona.versiones.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setHistorial((h) => !h)} aria-expanded={historial}>
              <History className="h-3.5 w-3.5" strokeWidth={1.8} />
              Historial
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEditar}>
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            Cambiar
          </Button>
        </div>
      </div>
      {programada && (
        <p className="mt-1.5 text-xs text-warning-text">
          Cambio programado desde {fecha(programada.validFrom)}:{" "}
          {programada.comisiona
            ? `${porcentajeLegible(programada.rateBps)} desde ${pesos(programada.monthlyBaseCents)}`
            : "no comisiona"}
        </p>
      )}
      {historial && (
        <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-text-2">
          {persona.versiones.map((x) => (
            <li key={x.createdAt}>
              Desde {fecha(x.validFrom)}:{" "}
              {x.comisiona ? `${porcentajeLegible(x.rateBps)} desde ${pesos(x.monthlyBaseCents)}` : "no comisiona"}
              {x.referralCode ? ` · código ${x.referralCode}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Editor({
  persona,
  hoy,
  onCancelar,
  onGuardado,
}: {
  persona: Persona;
  hoy: string;
  onCancelar: () => void;
  onGuardado: () => Promise<void>;
}) {
  const v = persona.vigente;
  const [comisiona, setComisiona] = useState(v?.comisiona ?? true);
  const [porcentaje, setPorcentaje] = useState(v ? String(v.rateBps / 100).replace(".", ",") : "5");
  const [base, setBase] = useState(v && v.monthlyBaseCents > 0 ? String(v.monthlyBaseCents / 100) : "");
  const [codigo, setCodigo] = useState(v?.referralCode ?? "");
  const [desde, setDesde] = useState(hoy);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const rateBps = comisiona ? bpsDesdeTexto(porcentaje) : 0;
    const monthlyBaseCents = comisiona ? centavosDesdePesos(base) : 0;
    if (rateBps === null) return setError("El porcentaje va de 0 a 100");
    if (monthlyBaseCents === null) return setError("Escribe la base del mes en pesos");
    setGuardando(true);
    const res = await fetch("/api/comisiones/perfiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: persona.userId,
        comisiona,
        rateBps,
        monthlyBaseCents,
        referralCode: codigo.trim() || null,
        validFrom: desde || undefined,
      }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    await onGuardado();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-strong bg-subtle p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{persona.name}</p>
        <div className="flex items-center gap-2 text-[13px] font-medium">
          Comisiona
          <Switch checked={comisiona} onCheckedChange={setComisiona} label="Comisiona" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {comisiona && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`pct-${persona.userId}`}>Porcentaje</Label>
              <Input
                id={`pct-${persona.userId}`}
                inputMode="decimal"
                value={porcentaje}
                onChange={(e) => setPorcentaje(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`base-${persona.userId}`}>Base del mes (pesos)</Label>
              <Input
                id={`base-${persona.userId}`}
                inputMode="numeric"
                placeholder="1.000.000"
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`cod-${persona.userId}`}>Código de referido</Label>
          <Input
            id={`cod-${persona.userId}`}
            placeholder="YULI"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`desde-${persona.userId}`}>Rige desde</Label>
          <Input id={`desde-${persona.userId}`} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-text-3">
        Se guarda como una versión nueva: los meses anteriores a esa fecha siguen con lo que regía entonces.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
