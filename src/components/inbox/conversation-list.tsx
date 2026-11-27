"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Check, CheckSquare, ChevronRight, Clock3, Inbox, SlidersHorizontal, Search, Sparkles, X } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { matchesQuery } from "@/lib/search";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { SelectNativo } from "@/components/ui/select-nativo";
import { EtiquetaPauta } from "@/components/anuncio-origen";
import { PAUTA_CUALQUIERA, PAUTA_SIN, PAUTA_TODAS, nombreDelFiltro, pasaPauta, pautasDe } from "@/lib/anuncios";
import { EmptyState } from "@/components/ui/empty-state";
import { emptyInboxDescription, formatTime, previewText } from "./helpers";
import { EVENTO_BORRADOR, leerBorrador } from "@/lib/borradores";
import { atajoBandeja, esCampoDeTexto, sirveEscribiendo, vecina } from "@/lib/atajos";
import { hayDialogoAbierto } from "@/components/atajos-globales";
import {
  DIAS_SEGUIMIENTO,
  diasDesde,
  enVista,
  estadoDeChat,
  etiquetaVence,
  ordenDeGrupo,
  pideSeguimiento,
  porVencer,
  VISTAS_BANDEJA,
  type VistaBandeja,
} from "@/lib/filtros-bandeja";
import { nombreCorto, useEquipo } from "@/lib/equipo";
import { LoteBar } from "./lote-bar";
import { EstadoChip } from "./estado-chip";
import { MOTIVO_PERFIL_LABEL, type MotivoPerfil } from "@/lib/perfil";
import { GRUPOS_HOY, detalleHoy, grupoHoy, type GrupoHoy } from "@/lib/bandeja-hoy";
import { addDaysISO, dayIsoInTz } from "@/lib/time/slots";

/**
 * Foco por teclado de chips y selector: el anillo de `ui/button`, acento
 * sólido separado del control (el elegido ya ES del color del acento y un
 * anillo pegado se fundiría con él). El suave de los campos
 * (`ring-brand-soft`) queda a ~1.3:1 del fondo: aquí no hay borde que cambie
 * de color para compensarlo, y se veía menos que el del navegador.
 */
const FOCO_SEPARADO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function InboxEmptyState({
  onSeeded,
  channels,
}: {
  onSeeded: () => void;
  channels: readonly Channel[];
}) {
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else setFailed(true);
  }

  return (
    <EmptyState
      icon={Inbox}
      className="h-full"
      title="Sin conversaciones todavía"
      description={emptyInboxDescription(channels.map((ch) => CHANNEL_LABEL[ch]))}
      action={
        !failed && (
          <Button
            size="sm"
            variant="outline"
            disabled={seeding}
            onClick={() => void seed()}
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.7} />
            {seeding ? "Cargando demo…" : "Cargar datos de demostración"}
          </Button>
        )
      }
    />
  );
}

export function ConversationList({
  conversations: conversationsProp,
  timezone,
  channels,
  selectedId,
  onSelect,
  onSeeded,
  onListaCambiada,
}: {
  conversations: ConversationDto[] | null;
  /** 083 — Zona del negocio; sin ella, la del navegador. */
  timezone?: string | null;
  /** Canales encendidos en esta instancia (ADR-001). */
  channels: readonly Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
  /** 067 — Tras una acción en lote: la Bandeja recarga su lista. */
  onListaCambiada?: () => void;
}) {
  const [query, setQuery] = useState("");
  // 052 (enmienda) — Pestañas y un botón «Filtrar» con lo demás. 067 suma
  // «Archivadas»: lo archivado no sale en las otras dos.
  // 075 — Vistas por lo que toca hacer (antes «Todas | No leídas | Archivadas»).
  // 083 — «Hoy» es la vista de entrada: lo que toca hacer, por grupos.
  const [vista, setVista] = useState<VistaBandeja>("hoy");
  const [plegados, setPlegados] = useState<Set<GrupoHoy>>(
    () => new Set(GRUPOS_HOY.filter((g) => g.plegado).map((g) => g.id))
  );
  const [soloNoLeidas, setSoloNoLeidas] = useState(false);
  // 067 — Responsable ("all" | "none" | userId) y días de seguimiento (0 = sin filtro).
  const [responsable, setResponsable] = useState<string>("all");
  const [diasSeguimiento, setDiasSeguimiento] = useState(0);
  const equipo = useEquipo();
  // 067 — Modo selección para las acciones en lote.
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const ahora = new Date();
  const [soloPorVencer, setSoloPorVencer] = useState(false);
  // 087 — Filtro por pauta ("all" | "sin" | "cualquiera" | clave del anuncio).
  const [pauta, setPauta] = useState<string>(PAUTA_TODAS);
  const [menuFiltros, setMenuFiltros] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // El menú se cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!menuFiltros) return;
    const fuera = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFiltros(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFiltros(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [menuFiltros]);
  const [stage, setStage] = useState<string>("all");
  const [inbox, setInbox] = useState<Channel | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);
  // 055 · D3 — Alt+J / Alt+K recorren la lista en el orden que se ve (con los
  // filtros puestos) y «/» lleva al buscador. Se lee lo visible por ref: el
  // oyente se pone una vez.
  const visibleRef = useRef<string[]>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const atajo = atajoBandeja(e);
      if (atajo !== "siguiente" && atajo !== "anterior" && atajo !== "buscar") return;
      if (!sirveEscribiendo(atajo) && esCampoDeTexto(e.target)) return;
      if (hayDialogoAbierto()) return;
      e.preventDefault();
      if (atajo === "buscar") {
        inputRef.current?.focus();
        return;
      }
      const id = vecina(visibleRef.current, selectedRef.current, atajo === "siguiente" ? 1 : -1);
      if (id) onSelectRef.current(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 051 — La lista se repinta cuando un borrador aparece, cambia o se va.
  const [, setBorradores] = useState(0);
  useEffect(() => {
    const avisar = () => setBorradores((v) => v + 1);
    window.addEventListener(EVENTO_BORRADOR, avisar);
    return () => window.removeEventListener(EVENTO_BORRADOR, avisar);
  }, []);

  /**
   * Rescate de lo tecleado ANTES de que hidratara el JS. La caja se pinta en
   * el HTML del servidor, así que se puede escribir en ella mientras carga la
   * página; al montar, React la dejaba vacía y esas pulsaciones se perdían en
   * silencio (el usuario veía la lista entera "sin filtrar"). Por eso el input
   * es NO controlado: el DOM manda y aquí solo adoptamos su valor.
   */
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const loading = conversationsProp === null;
  const conversations = conversationsProp ?? [];
  // Solo NOMBRE y TELÉFONO, como cualquier filtro de contactos. Antes también
  // miraba el preview, y como el agente nombra al dueño en sus propios
  // mensajes, buscar ese nombre devolvía media bandeja. Encima era una
  // búsqueda de mensajes a medias: solo el último de cada hilo, no el historial.
  const searched = conversations.filter(
    (c) =>
      matchesQuery(query, {
        text: [c.contact.name],
        phone: c.contact.phone,
      }) && (stage === "all" || c.stageName === stage)
  );
  // La bandeja elegida es el filtro de AFUERA: "Todas" y "No leídas" cuentan
  // dentro de ella, no sobre la suma de los dos canales.
  const inInbox =
    inbox === "all" ? searched : searched.filter((c) => c.channel === inbox);
  const inboxCount = (ch: Channel) =>
    searched.filter((c) => c.channel === ch).length;
  // 018/087 — Las pautas de lo que está en la bandeja, con cuántos chats trae cada una.
  const { pautas, sin: sinPauta, origenes } = pautasDe(inInbox);
  // Con un anuncio u origen puntual elegido, la etiqueta de la fila sobra.
  const pautaPuntual = pauta !== PAUTA_TODAS && pauta !== PAUTA_SIN && pauta !== PAUTA_CUALQUIERA;
  // 052 — A la ventana le quedan 2 h o menos.
  const venciendo = inInbox.filter(porVencer);
  // Lo del menú «Filtrar» se aplica antes de las pestañas: «Todas» y «No
  // leídas» cuentan dentro de lo filtrado.
  const filtrado = inInbox.filter(
    (c) =>
      (!soloPorVencer || porVencer(c)) &&
      pasaPauta(c, pauta) &&
      (responsable === "all" ||
        (responsable === "none" ? c.assignee === null : c.assignee?.id === responsable)) &&
      (diasSeguimiento === 0 || pideSeguimiento(c, diasSeguimiento, ahora))
  );
  const enLaVista = (v: VistaBandeja) =>
    filtrado.filter((c) => enVista(c, v) && (!soloNoLeidas || c.unreadCount > 0));
  // 083 — «Hoy»: cada chat en su grupo; los que no tocan hoy no salen.
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hoy = dayIsoInTz(ahora, tz);
  const manana = addDaysISO(hoy, 1);
  const grupoDe = new Map<string, GrupoHoy>();
  for (const c of filtrado) {
    const g = grupoHoy(c, hoy, manana, ahora);
    if (g) grupoDe.set(c.id, g);
  }
  const ordenHoy = (c: ConversationDto) => {
    const g = GRUPOS_HOY.findIndex((x) => x.id === grupoDe.get(c.id));
    // Las demos, por hora; lo demás conserva lo más reciente arriba.
    const t = grupoDe.get(c.id) === "demos" ? Date.parse(c.agenda?.proxima?.startUtc ?? "") : 0;
    return g * 1e13 + (Number.isNaN(t) ? 0 : t / 1e3);
  };
  // En «Por etapa» y «Clientes» la lista va agrupada por etapa (orden estable:
  // dentro de cada etapa sigue lo más reciente arriba).
  const agrupar = vista === "etapa" || vista === "demo" || vista === "clientes";
  const enHoy = (v: VistaBandeja) =>
    v === "hoy" ? enLaVista(v).filter((c) => grupoDe.has(c.id)) : enLaVista(v);
  const lista =
    vista === "hoy"
      ? [...enHoy("hoy")].sort((a, b) => ordenHoy(a) - ordenHoy(b))
      : agrupar
        ? [...enLaVista(vista)].sort((a, b) => ordenDeGrupo(a.stageName) - ordenDeGrupo(b.stageName))
        : enLaVista(vista);
  // Un grupo plegado deja su encabezado y esconde sus filas.
  const visible = vista === "hoy" ? lista.filter((c) => !plegados.has(grupoDe.get(c.id)!)) : lista;
  const encabezados = vista === "hoy" ? GRUPOS_HOY.filter((g) => lista.some((c) => grupoDe.get(c.id) === g.id)) : [];
  visibleRef.current = visible.map((c) => c.id);
  function plegar(g: GrupoHoy) {
    setPlegados((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }
  const pestanas = VISTAS_BANDEJA.map((v) => ({
    id: v.id,
    label: v.label,
    // En «Hoy» los dormidos no cuentan: el número es lo que toca atender.
    count: v.id === "hoy" ? enHoy("hoy").filter((c) => grupoDe.get(c.id) !== "dormidos").length : enLaVista(v.id).length,
  }))
    // 078 — «¿Fuera de perfil?» solo aparece cuando hay algo que revisar.
    .filter((p) => p.id !== "revisar_perfil" || p.count > 0 || vista === "revisar_perfil");
  const nombreResponsable =
    responsable === "none"
      ? "Sin responsable"
      : (equipo?.find((m) => m.userId === responsable)?.name ?? "…");
  const nFiltros =
    (stage !== "all" ? 1 : 0) +
    (soloPorVencer ? 1 : 0) +
    (pauta !== PAUTA_TODAS ? 1 : 0) +
    (responsable !== "all" ? 1 : 0) +
    (diasSeguimiento > 0 ? 1 : 0) +
    (soloNoLeidas ? 1 : 0);
  function limpiarFiltros() {
    setStage("all");
    setSoloPorVencer(false);
    setPauta(PAUTA_TODAS);
    setResponsable("all");
    setDiasSeguimiento(0);
    setSoloNoLeidas(false);
  }
  // 067 — Lo seleccionado que sigue a la vista (un filtro puede esconderlo).
  const seleccionVisible = visible.filter((c) => seleccion.has(c.id));
  function alternar(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function salirDeSeleccion() {
    setSeleccionando(false);
    setSeleccion(new Set());
  }
  // Con un solo canal encendido no hay bandejas que distinguir: ni marca en
  // los renglones ni filtro. La pantalla queda exactamente como antes de 014.
  const multiChannel = channels.length > 1;

  // Etapas presentes en la bandeja, en el orden en que llegan del pipeline.
  const stages: string[] = [];
  for (const c of conversations) {
    if (c.stageName && !stages.includes(c.stageName)) stages.push(c.stageName);
  }

  function clearQuery() {
    if (inputRef.current) inputRef.current.value = "";
    setQuery("");
    inputRef.current?.focus();
  }

  /**
   * 083 — Una fila en dos renglones: nombre y hora; una sola etiqueta y la
   * vista previa. 087: más la pauta de origen. La etapa y la atención humana viven en el panel
   * del chat: en la lista solo va lo que dice qué hacer.
   */
  function fila(c: ConversationDto) {
    const unread = c.unreadCount > 0;
    const active = selectedId === c.id;
    const grupo = grupoDe.get(c.id) ?? null;
    const detalle = vista === "hoy" && grupo ? detalleHoy(c, grupo, hoy, ahora) : null;
    const estado = estadoDeChat(c, ahora);
    const dias = diasDesde(c.lastMessageAt, ahora);
    const borrador = leerBorrador("responder", c.id);
    return (
      <li key={c.id} className="relative border-b border-border">
        <button
          onClick={() => (seleccionando ? alternar(c.id) : onSelect(c.id))}
          // 055 — Cuál está abierta, para Alt+J/K y los lectores de pantalla.
          aria-current={active ? "true" : undefined}
          aria-pressed={seleccionando ? seleccion.has(c.id) : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 px-4 py-[var(--row-py)] text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            active ? "bg-[var(--bg-active)]" : "hover:bg-row-hover"
          )}
        >
          {seleccionando && (
            <span
              aria-hidden
              className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-colors",
                seleccion.has(c.id) ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-card"
              )}
            >
              {seleccion.has(c.id) && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
          )}
          <span className="relative shrink-0">
            <ContactAvatar name={c.contact.name} seed={c.contact.id} size="md" />
            {c.windowOpen && (
              <span className="absolute bottom-0 right-0 h-[10px] w-[10px] rounded-full border-2 border-background bg-success" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {multiChannel && <ChannelBadge channel={c.channel} />}
                <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
                  {c.contact.name}
                </span>
                {c.assignee && (
                  <span
                    title={`${c.assignee.name} hace el seguimiento`}
                    className="shrink-0 rounded-full bg-brand-tint px-1.5 text-[10.5px] font-semibold text-brand-text"
                  >
                    {nombreCorto(c.assignee.name)}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[10.5px] tracking-[0.02em]",
                  unread ? "font-semibold text-brand-ink" : "text-text-3"
                )}
              >
                {formatTime(c.lastMessageAt)}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              {detalle ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-px text-[10.5px] font-semibold",
                    detalle.urgente
                      ? "border-danger-soft bg-danger-tint text-danger-text"
                      : "border-border-strong bg-chip text-text-2"
                  )}
                >
                  {detalle.texto}
                </span>
              ) : vista !== "hoy" ? (
                <EstadoChip
                  estado={estado}
                  detalle={estado === "recontactar" && dias !== null && dias >= 1 ? `${dias} d` : null}
                  className="shrink-0 px-1.5 py-px text-[10.5px]"
                />
              ) : null}
              {/* 087 — De qué pauta llegó, salvo que ya se esté filtrando por una. */}
              {!pautaPuntual && <EtiquetaPauta anuncio={c.anuncio} origen={c.origen} className="max-w-[8.5rem]" />}
              {porVencer(c) && (
                // 052 — Pasada la ventana, solo con plantilla: se avisa antes.
                <span data-vence title={etiquetaVence(c.windowRemainingMs)} className="shrink-0 text-warning-text">
                  <Clock3 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </span>
              )}
              {c.perfil?.estado === "sospecha" && (
                <span
                  className="shrink-0 rounded-full border border-warning-soft bg-warning-tint px-1.5 py-px text-[10.5px] font-semibold text-warning-text"
                  title={
                    c.perfil.motivo && MOTIVO_PERFIL_LABEL[c.perfil.motivo as MotivoPerfil]
                      ? MOTIVO_PERFIL_LABEL[c.perfil.motivo as MotivoPerfil]
                      : "El filtro cree que no busca un software contable"
                  }
                >
                  ¿Fuera de perfil?
                </span>
              )}
              <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", unread ? "font-medium text-text-2" : "text-text-3")}>
                {borrador ? (
                  <>
                    <span className="font-semibold text-brand-ink">Borrador:</span> {borrador.replace(/\s+/g, " ")}
                  </>
                ) : (
                  previewText(c.preview)
                )}
              </span>
              {unread && (
                <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-brand-fg">
                  {c.unreadCount}
                </span>
              )}
            </span>
          </span>
        </button>
      </li>
    );
  }

  return (
    // 061 · D3 — El buscador en cápsula, aparte y arriba; debajo, la lista en
    // su tarjeta. En el teléfono va igual, sin el marco alrededor.
    <div className="flex h-full flex-col bg-background lg:gap-[var(--hueco)] lg:bg-transparent">
      <div className="px-4 pt-3 lg:p-0">
        <div className="flex items-center gap-2 rounded-full border border-border-strong bg-chip px-3.5 py-[7px] shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft lg:tarjeta lg:rounded-full lg:border-transparent lg:px-4 lg:py-3">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
          <input
            ref={inputRef}
            placeholder="Buscar por nombre o teléfono…"
            aria-label="Buscar conversación"
            defaultValue=""
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
          {query && (
            <button
              onClick={clearQuery}
              aria-label="Limpiar búsqueda"
              className="shrink-0 rounded-full p-0.5 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-background lg:tarjeta lg:overflow-hidden">
      <header className="border-b px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Bandeja</h2>
          <span className="font-mono text-[12px] text-text-3">{conversations.length}</span>
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={() => (seleccionando ? salirDeSeleccion() : setSeleccionando(true))}
              aria-pressed={seleccionando}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors",
                FOCO_SEPARADO,
                multiChannel ? "" : "ml-auto",
                seleccionando
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border-strong text-foreground hover:border-foreground"
              )}
            >
              <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.9} />
              {seleccionando ? "Cancelar" : "Seleccionar"}
            </button>
          )}
          {multiChannel && (
            <div className="ml-auto flex items-center gap-1">
              {channels.map((ch) => {
                const on = inbox === ch;
                return (
                  <button
                    key={ch}
                    onClick={() => setInbox(on ? "all" : ch)}
                    aria-pressed={on}
                    title={
                      on
                        ? "Ver todas las bandejas"
                        : `Ver solo ${CHANNEL_LABEL[ch]}`
                    }
                    className={cn(
                      "flex items-center gap-1 rounded-full border py-[3px] pl-[5px] pr-2 text-[11.5px] font-medium transition-colors",
                      FOCO_SEPARADO,
                      on
                        ? "border-brand bg-brand-veil text-foreground"
                        : "text-text-3 hover:bg-accent",
                      inbox !== "all" && !on && "opacity-45"
                    )}
                  >
                    <ChannelBadge
                      channel={ch}
                      className="h-[13px] w-[13px] rounded-[4px]"
                    />
                    {inboxCount(ch)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* 052 (enmienda) — «Todas | No leídas» y un solo botón «Filtrar»: la
          etapa, «Por vencer» y «De anuncios» viven en su menú, y lo elegido
          se ve abajo como etiquetas que se quitan con ✕. */}
      <div className="border-b px-4">
        <div className="flex items-start gap-2 py-2">
          <div
            role="tablist"
            aria-label="Qué conversaciones ver"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
          >
            {pestanas.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={vista === f.id}
                onClick={() => setVista(f.id)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  FOCO_SEPARADO,
                  vista === f.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border-strong text-text-2 hover:border-text-3 hover:text-foreground"
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "font-mono text-[10.5px] font-medium",
                    vista === f.id ? "text-background/70" : "text-text-3"
                  )}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuFiltros((v) => !v)}
              aria-expanded={menuFiltros}
              aria-haspopup="dialog"
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-[12.5px] font-semibold transition-colors",
                FOCO_SEPARADO,
                nFiltros > 0 ? "text-brand-ink" : "text-text-2 hover:bg-subtle hover:text-foreground"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
              {nFiltros > 0 ? `Filtrar · ${nFiltros}` : "Filtrar"}
            </button>
            {menuFiltros && (
              <div
                role="dialog"
                aria-label="Filtros de la bandeja"
                className="absolute right-0 top-full z-30 mt-1 w-[min(280px,calc(100vw-2rem))] space-y-3 rounded-xl border border-border-strong bg-popover p-3 text-popover-foreground shadow-xl"
              >
                {stages.length > 0 && (
                  <label className="block space-y-1">
                    <span className="kicker text-text-3">Etapa</span>
                    <SelectNativo
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                      aria-label="Filtrar por etapa del embudo"
                    >
                      <option value="all">Toda etapa</option>
                      {stages.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </SelectNativo>
                  </label>
                )}
                <label className="block space-y-1">
                  <span className="kicker text-text-3">Responsable</span>
                  <SelectNativo
                    value={responsable}
                    onChange={(e) => setResponsable(e.target.value)}
                    aria-label="Filtrar por responsable"
                  >
                    <option value="all">Cualquiera</option>
                    <option value="none">Sin responsable</option>
                    {(equipo ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
                <label className="block space-y-1">
                  <span className="kicker text-text-3">Seguimiento pendiente</span>
                  <SelectNativo
                    value={diasSeguimiento}
                    onChange={(e) => setDiasSeguimiento(Number(e.target.value))}
                    aria-label="Filtrar por días sin respuesta"
                  >
                    <option value={0}>Todas</option>
                    {DIAS_SEGUIMIENTO.map((d) => (
                      <option key={d} value={d}>
                        Sin respuesta hace {d} {d === 1 ? "día" : "días"} o más
                      </option>
                    ))}
                  </SelectNativo>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={soloNoLeidas}
                    onChange={(e) => setSoloNoLeidas(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="flex-1">Solo no leídas</span>
                </label>
                {/* Como antes: sin ninguna, la casilla no aparece (salvo que esté marcada). */}
                {(venciendo.length > 0 || soloPorVencer) && (
                  <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={soloPorVencer}
                      onChange={(e) => setSoloPorVencer(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="flex-1">Por vencer</span>
                    <span className="font-mono text-[11px] text-text-3">{venciendo.length}</span>
                  </label>
                )}
                {(inInbox.length > 0 || pauta !== PAUTA_TODAS) && (
                  <label className="block space-y-1">
                    <span className="kicker text-text-3">Pauta</span>
                    <SelectNativo
                      value={pauta}
                      onChange={(e) => setPauta(e.target.value)}
                      aria-label="Filtrar por pauta"
                    >
                      <option value={PAUTA_TODAS}>Toda pauta</option>
                      <optgroup label="Anuncios">
                        <option value={PAUTA_CUALQUIERA}>De cualquier anuncio ({inInbox.length - sinPauta})</option>
                        {pautas.map((p) => (
                          <option key={p.clave} value={p.clave} title={p.titular}>
                            {p.titular} ({p.n})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Sin anuncio">
                        <option value={PAUTA_SIN}>Todo sin anuncio ({sinPauta})</option>
                        {origenes.map((o) => (
                          <option key={o.clave} value={o.clave}>
                            {o.nombre} ({o.n})
                          </option>
                        ))}
                      </optgroup>
                    </SelectNativo>
                  </label>
                )}
                {nFiltros > 0 && (
                  <button
                    type="button"
                    onClick={limpiarFiltros}
                    className="block w-full text-right text-[12.5px] font-semibold text-brand-ink hover:underline"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {nFiltros > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2.5">
            {stage !== "all" && (
              <FiltroPuesto texto={`Etapa: ${stage}`} onQuitar={() => setStage("all")} />
            )}
            {soloPorVencer && (
              <FiltroPuesto texto="Por vencer" onQuitar={() => setSoloPorVencer(false)} />
            )}
            {pauta !== PAUTA_TODAS && (
              <FiltroPuesto texto={nombreDelFiltro(pauta, pautas)} onQuitar={() => setPauta(PAUTA_TODAS)} />
            )}
            {responsable !== "all" && (
              <FiltroPuesto
                texto={`Responsable: ${nombreResponsable}`}
                onQuitar={() => setResponsable("all")}
              />
            )}
            {diasSeguimiento > 0 && (
              <FiltroPuesto
                texto={`Sin respuesta ${diasSeguimiento}+ ${diasSeguimiento === 1 ? "día" : "días"}`}
                onQuitar={() => setDiasSeguimiento(0)}
              />
            )}
          </div>
        )}
      </div>

      {seleccionando && visible.length > 0 && (
        <div className="flex items-center gap-2 border-b px-4 py-2 text-[12.5px]">
          <button
            type="button"
            onClick={() =>
              setSeleccion(
                seleccionVisible.length === visible.length
                  ? new Set()
                  : new Set(visible.map((c) => c.id))
              )
            }
            className="font-semibold text-brand-ink hover:underline"
          >
            {seleccionVisible.length === visible.length ? "Quitar selección" : `Seleccionar las ${visible.length}`}
          </button>
          <span className="ml-auto font-mono text-text-3">{seleccionVisible.length} elegidas</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : conversations.length === 0 ? (
          <InboxEmptyState onSeeded={onSeeded} channels={channels} />
        ) : visible.length === 0 && encabezados.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            {/* 028: un canal en el que nadie ha escrito no es una búsqueda fallida. */}
            {inbox !== "all" &&
            !query &&
            vista === "todas" &&
            nFiltros === 0 &&
            !conversations.some((c) => c.channel === inbox)
              ? `Nadie ha escrito por ${CHANNEL_LABEL[inbox]} todavía.`
              : vista === "hoy" && !query && nFiltros === 0
                ? "Nada pendiente por hoy."
                : "Sin resultados para este filtro."}
          </p>
        ) : (
          <ul>
            {vista === "hoy"
              ? encabezados.map((g) => {
                  const filas = lista.filter((c) => grupoDe.get(c.id) === g.id);
                  const abierto = !plegados.has(g.id);
                  return (
                    <Fragment key={g.id}>
                      <li className="sticky top-0 z-10 border-b border-border bg-subtle/95 backdrop-blur">
                        <button
                          type="button"
                          onClick={() => plegar(g.id)}
                          aria-expanded={abierto}
                          className={cn("flex w-full items-center gap-1.5 px-4 py-1.5 text-left", FOCO_SEPARADO)}
                        >
                          <ChevronRight
                            aria-hidden
                            className={cn("h-3.5 w-3.5 text-text-3 transition-transform", abierto && "rotate-90")}
                            strokeWidth={2}
                          />
                          <span className="kicker flex-1 text-text-2">{g.label}</span>
                          <span className="font-mono text-[11px] text-text-3">{filas.length}</span>
                        </button>
                      </li>
                      {abierto && filas.map((c) => fila(c))}
                    </Fragment>
                  );
                })
              : visible.map((c, i) => {
                  const grupo = agrupar && (i === 0 || visible[i - 1]!.stageName !== c.stageName);
                  return (
                    <Fragment key={c.id}>
                      {grupo && (
                        <li
                          aria-hidden
                          className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-subtle/95 px-4 py-1.5 backdrop-blur"
                        >
                          <span className="kicker text-text-2">{c.stageName ?? "Sin etapa"}</span>
                          <span className="font-mono text-[11px] text-text-3">
                            {visible.filter((x) => x.stageName === c.stageName).length}
                          </span>
                        </li>
                      )}
                      {fila(c)}
                    </Fragment>
                  );
                })}
          </ul>
        )}
      </div>
      {seleccionando && seleccionVisible.length > 0 && (
        <LoteBar
          conversaciones={seleccionVisible}
          enArchivadas={vista === "cerrados" && seleccionVisible.every((c) => c.archivedAt)}
          equipo={equipo ?? []}
          onHecho={() => {
            salirDeSeleccion();
            onListaCambiada?.();
          }}
          onRefrescar={() => onListaCambiada?.()}
        />
      )}
      </div>
    </div>
  );
}

/** 052 (enmienda) — Un filtro puesto desde «Filtrar», con su ✕ para quitarlo. */
function FiltroPuesto({ texto, onQuitar }: { texto: string; onQuitar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-soft bg-brand-tint py-0.5 pl-2.5 pr-1 text-[12px] font-semibold text-brand-text">
      {texto}
      <button
        type="button"
        onClick={onQuitar}
        aria-label={`Quitar filtro ${texto}`}
        className="rounded-full p-0.5 hover:bg-brand-soft"
      >
        <X className="h-3 w-3" strokeWidth={2.2} />
      </button>
    </span>
  );
}
