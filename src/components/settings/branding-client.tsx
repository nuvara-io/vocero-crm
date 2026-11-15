"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import {
  ACCENT_PRESETS,
  ajusteDeContraste,
  DEFAULT_BRANDING,
  esNeutro,
  isValidHex,
  RADIO_BOTON,
  resolveAccentSet,
  resolveNavAccentSet,
  type AccentSet,
  type Branding,
  type FormaBoton,
  type LogoFondo,
} from "@/lib/branding";
import {
  CURRENCY_GROUPS,
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  type Currency,
} from "@/lib/money";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/components/use-theme";
import { BrandLogo, BrandTile } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { navItemClass } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Los tokens del acento, para sobreescribirlos SOLO dentro de una caja. */
function accentVars(s: AccentSet): React.CSSProperties {
  return {
    "--accent": s.accent,
    "--accent-hover": s.hover,
    "--accent-soft": s.soft,
    "--accent-tint": s.tint,
    "--accent-text": s.text,
    "--accent-fg": s.fg,
  } as React.CSSProperties;
}

export function BrandingClient({
  favicon = null,
  kicker = "CRM · WhatsApp",
}: {
  /** 028 — La etiqueta bajo el logo, la misma que enseña el menú. */
  kicker?: string;
  /**
   * Logo subido, solo para la vista previa: se sube y se quita en su propia
   * tarjeta. Llega del servidor y no del fetch de abajo a propósito: esa
   * tarjeta hace `router.refresh()` al subir o quitar, la página vuelve a
   * pasar la prop y la vista previa cambia sin recargar. Leído una sola vez
   * al montar, se quedaría con el logo de antes.
   */
  favicon?: Branding["favicon"];
}) {
  const router = useRouter();
  const mode = useResolvedTheme();
  const [name, setName] = useState("");
  const [accent, setAccent] = useState<string>(DEFAULT_BRANDING.accent);
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY);
  // 070 — Fondo del logo y botones.
  const [logoBackground, setLogoBackground] = useState<LogoFondo>(DEFAULT_BRANDING.logoBackground);
  const [buttonColor, setButtonColor] = useState<string | null>(null);
  const [buttonShape, setButtonShape] = useState<FormaBoton>(DEFAULT_BRANDING.buttonShape);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { branding: Branding } | null) => {
        if (d) {
          setName(d.branding.name);
          setAccent(d.branding.accent);
          if (d.branding.currency) setCurrency(d.branding.currency);
          setLogoBackground(d.branding.logoBackground ?? DEFAULT_BRANDING.logoBackground);
          setButtonColor(d.branding.buttonColor ?? null);
          setButtonShape(d.branding.buttonShape ?? DEFAULT_BRANDING.buttonShape);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // La vista previa muestra el acento tal como se verá en el tema activo: los
  // presets están pensados para fondo claro y en oscuro se aclaran. La barra
  // lateral es azul marino en los dos temas y lleva su propio cálculo.
  const previewSet = resolveAccentSet(accent, mode);
  const navSet = resolveNavAccentSet(accent);
  // 070 — Los botones: su color propio o el acento, con su forma.
  const buttonSet = resolveAccentSet(buttonColor && isValidHex(buttonColor) ? buttonColor : accent, mode);
  const buttonVars = {
    "--btn": buttonSet.accent,
    "--btn-hover": buttonSet.hover,
    "--btn-fg": buttonSet.fg,
    "--btn-radius": RADIO_BOTON[buttonShape],
  } as React.CSSProperties;
  const marca = { name: name.trim() || DEFAULT_BRANDING.name, accent, favicon, logoBackground };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), accent, currency, logoBackground, buttonColor, buttonShape }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    setSaved(true);
    // Re-renderiza el árbol server (layout raíz inyecta el acento y el título)
    router.refresh();
  }

  if (!loaded) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Marca del CRM</CardTitle>
          <CardDescription>
            Este CRM es tuyo: ponle el nombre de tu negocio y tu color. Se
            reflejan en toda la interfaz y en la pantalla de inicio de sesión.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Nombre</Label>
            <Input
              id="brand-name"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vocero"
              className="max-w-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-currency">Moneda del negocio</Label>
            <select
              id="brand-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="h-9 max-w-xs rounded-md border border-input bg-card px-2 text-sm"
            >
              {CURRENCY_GROUPS.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {CURRENCY_OPTIONS.filter((c) => c.group === g.id).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name} ({c.where})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-text-3">
              Es la única que el Pipeline suma. Los montos capturados en otra
              moneda se muestran, pero quedan fuera del total de su columna.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Color de acento</Label>
            <SelectorColor valor={accent} onCambio={setAccent} mode={mode} />
            <p className="text-xs text-text-3">
              Es el color de la marca: menú activo, enlaces, casillas y, si no les pones uno propio, los botones.
              Con un color personalizado los tonos suaves se calculan solos y se ajusta el contraste.
            </p>
            {esNeutro(accent) && ajusteDeContraste(accent).ajustado && (
              <p className="rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-xs text-warning-text">
                Un color tan claro no se lee como acento y se vuelve gris. Si lo que quieres es el logo sobre
                blanco, elige «Fondo claro» en «Fondo del logo» y deja aquí un color de tu marca.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Fondo del logo</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["acento", "Color de acento", "El degradado del acento, como el ícono de la app."],
                  ["claro", "Fondo claro", "Blanco: para un logo con sus propios colores."],
                  ["transparente", "Sin fondo", "Solo el logo, sobre lo que haya detrás."],
                ] as [LogoFondo, string, string][]
              ).map(([valor, titulo, ayuda]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setLogoBackground(valor)}
                  aria-pressed={logoBackground === valor}
                  className={cn(
                    "flex min-w-[10rem] flex-1 items-center gap-3 rounded-lg border p-2.5 text-left transition-colors",
                    logoBackground === valor ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
                  )}
                  style={accentVars(previewSet)}
                >
                  <BrandTile
                    branding={{ ...marca, logoBackground: valor }}
                    className="h-9 w-9 rounded-[11px] text-[15px]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{titulo}</span>
                    <span className="block text-[11.5px] leading-snug text-text-3">{ayuda}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Botones</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setButtonColor(null)}
                aria-pressed={buttonColor === null}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  buttonColor === null ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
                )}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: previewSet.accent }} />
                Igual al acento
              </button>
              <button
                type="button"
                onClick={() => setButtonColor(buttonColor ?? accent)}
                aria-pressed={buttonColor !== null}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  buttonColor !== null ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
                )}
              >
                Color propio
              </button>
            </div>
            {buttonColor !== null && (
              <SelectorColor valor={buttonColor} onCambio={setButtonColor} mode={mode} />
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[12.5px] font-medium text-text-2">Forma</span>
              {(
                [
                  ["pildora", "Píldora"],
                  ["redondeado", "Redondeado"],
                  ["recto", "Recto"],
                ] as [FormaBoton, string][]
              ).map(([valor, titulo]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setButtonShape(valor)}
                  aria-pressed={buttonShape === valor}
                  className={cn(
                    "flex items-center gap-2 border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    buttonShape === valor ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
                  )}
                  style={{ borderRadius: RADIO_BOTON[valor] }}
                >
                  {titulo}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-3">
              El texto del botón se pone blanco o negro solo, según lo que se lea mejor.
            </p>
          </div>

          {/* Vista previa: el bicolor real en miniatura, con lo que se está
              eligiendo (aún sin guardar). A la izquierda la barra, con la
              misma clase (`nav-dark`) y el mismo renglón activo que la de
              verdad; a la derecha la página en el tema activo, con el logo
              sobre fondo claro y los controles que se pintan con la marca. */}
          <div
            aria-label="Vista previa de la marca"
            className="flex flex-col overflow-hidden rounded-md border border-border-strong sm:flex-row"
          >
            <div
              className="nav-dark shrink-0 bg-subtle p-3 text-foreground sm:w-60"
              style={accentVars(navSet)}
            >
              <div className="px-2 pt-0.5">
                <BrandLogo branding={marca} />
                <span className="kicker mt-2 block">{kicker}</span>
              </div>
              <span className={cn(navItemClass(true), "mt-3")}>
                <Inbox className="h-[17px] w-[17px] text-brand" strokeWidth={1.8} />
                <span className="flex-1">Bandeja</span>
              </span>
            </div>
            <div
              className="flex flex-1 flex-col gap-3 border-t border-border-strong bg-background p-4 sm:border-l sm:border-t-0"
              style={{ ...accentVars(previewSet), ...buttonVars }}
            >
              <BrandLogo branding={marca} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" type="button">
                  Botón principal
                </Button>
                <Button size="sm" variant="outline" type="button">
                  Secundario
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="flex items-center gap-1.5">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border-[1.5px] border-primary bg-primary text-[11px] font-bold text-primary-foreground">
                    ✓
                  </span>
                  Casilla
                </span>
                <Badge>Etiqueta</Badge>
                <span className="font-semibold text-brand-ink underline underline-offset-2">Enlace</span>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm" style={{ color: previewSet.text }}>Marca guardada ✓</p>}
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar marca"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 070 — Elegir un color: los presets, un personalizado que SÍ muestra el
 * color elegido, y el código hex escrito a mano. Si el color se va a ajustar
 * por contraste, lo dice con el tono que va a quedar.
 */
function SelectorColor({
  valor,
  onCambio,
  mode,
}: {
  valor: string;
  onCambio: (hex: string) => void;
  mode: "light" | "dark";
}) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  const esPreset = valor.toLowerCase() in ACCENT_PRESETS;
  const ajuste = ajusteDeContraste(valor);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(ACCENT_PRESETS).map(([hex, preset]) => (
          <button
            key={hex}
            type="button"
            onClick={() => onCambio(hex)}
            title={preset.label}
            aria-pressed={valor.toLowerCase() === hex}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              valor.toLowerCase() === hex ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
            )}
          >
            <span className="h-4 w-4 rounded-full" style={{ background: resolveAccentSet(hex, mode).accent }} />
            {preset.label}
          </button>
        ))}
        <label
          className={cn(
            "relative flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
            !esPreset ? "border-text-2 bg-secondary" : "border-border-strong hover:bg-accent"
          )}
        >
          <span
            className="h-4 w-4 rounded-full border border-black/15"
            style={{ background: isValidHex(valor) ? valor : DEFAULT_BRANDING.accent }}
          />
          Personalizado
          <input
            type="color"
            value={isValidHex(valor) ? valor : DEFAULT_BRANDING.accent}
            onChange={(e) => onCambio(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Elegir un color personalizado"
          />
        </label>
        <Input
          value={texto}
          onChange={(e) => {
            const v = e.target.value.trim();
            setTexto(v);
            const hex = v.startsWith("#") ? v : `#${v}`;
            if (isValidHex(hex)) onCambio(hex.toLowerCase());
          }}
          aria-label="Código del color (hex)"
          placeholder="#0d5bff"
          className="h-8 w-28 font-mono text-xs"
          maxLength={7}
        />
      </div>
      {ajuste.ajustado && (
        <p className="flex items-center gap-2 text-xs text-warning-text">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/15" style={{ background: ajuste.resultado }} />
          Ese color es muy claro para leerse sobre fondo blanco: se verá como {ajuste.resultado}.
        </p>
      )}
    </div>
  );
}
