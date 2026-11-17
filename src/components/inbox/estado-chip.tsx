import { cn } from "@/lib/utils";
import { ESTADOS_CHAT, type EstadoChat, type TonoEstado } from "@/lib/filtros-bandeja";

/** 076 — Colores de cada tono con los tokens del tema (siguen al modo oscuro). */
const TONO: Record<TonoEstado, { chip: string; punto: string }> = {
  neutral: { chip: "border-border-strong bg-chip text-text-2", punto: "bg-text-3" },
  success: { chip: "border-success-soft bg-success-tint text-success-text", punto: "bg-success" },
  brand: { chip: "border-brand-soft bg-brand-tint text-brand-text", punto: "bg-brand" },
  info: { chip: "border-info-soft bg-info-tint text-info-text", punto: "bg-info" },
  danger: { chip: "border-danger-soft bg-danger-tint text-danger-text", punto: "bg-danger" },
  warning: { chip: "border-warning-soft bg-warning-tint text-warning-text", punto: "bg-warning" },
};

export function EstadoChip({
  estado,
  detalle,
  className,
}: {
  estado: EstadoChat;
  /** Texto extra después del estado, p. ej. «3 d». */
  detalle?: string | null;
  className?: string;
}) {
  const { label, tono } = ESTADOS_CHAT[estado];
  const t = TONO[tono];
  return (
    <span
      data-estado={estado}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        t.chip,
        className
      )}
    >
      <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", t.punto)} />
      {label}
      {detalle ? <span className="font-normal opacity-80">· {detalle}</span> : null}
    </span>
  );
}
