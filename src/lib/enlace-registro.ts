/**
 * 080 — El enlace de registro PERSONAL de cada lead: el de la campaña más
 * `c=<id del lead>`. La plataforma guarda ese `c` al registrarse y lo devuelve
 * en sus avisos, así el CRM mueve al lead exacto (sin depender de teléfono ni
 * correo, que el registro no siempre trae).
 */

export type AjustesRegistro = {
  /** Página de registro de la plataforma, p. ej. https://app.nuvara.com.co/signup */
  url: string | null;
  /** Código de campaña que va en el enlace (p. ej. NUVARA20); null = sin código. */
  codigo: string | null;
};

export const REGISTRO_POR_DEFECTO: AjustesRegistro = { url: null, codigo: null };

export function enlaceRegistro(ajustes: AjustesRegistro, leadId: string | null | undefined): string | null {
  if (!ajustes.url || !leadId) return null;
  let u: URL;
  try {
    u = new URL(ajustes.url);
  } catch {
    return null;
  }
  if (ajustes.codigo) u.searchParams.set("code", ajustes.codigo);
  u.searchParams.set("c", leadId);
  return u.toString();
}

export function normalizarRegistro(raw: unknown): AjustesRegistro {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url.trim()) ? r.url.trim() : null;
  const codigo =
    typeof r.codigo === "string" && r.codigo.trim() ? r.codigo.trim().toUpperCase().slice(0, 60) : null;
  return { url, codigo };
}
