import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 067 — `<select>` nativo vestido como los botones en píldora: mismo borde,
 * mismo alto y una flecha propia en vez de la del navegador. Sigue siendo un
 * select de verdad (rueda nativa en el celular, teclado, lector de pantalla).
 */
type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  tamano?: "sm" | "md";
  /** Clases del contenedor (ancho, márgenes); `className` va al select. */
  envoltura?: string;
};

export function SelectNativo({ tamano = "md", envoltura, className, ...props }: Props) {
  return (
    <div className={cn("relative", envoltura)}>
      <select
        className={cn(
          "w-full cursor-pointer appearance-none truncate rounded-full border border-border-strong bg-card pl-3.5 pr-8 font-semibold text-foreground transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          tamano === "sm" ? "h-8 text-xs" : "h-9 text-[13px]",
          className
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3"
        strokeWidth={1.8}
      />
    </div>
  );
}
