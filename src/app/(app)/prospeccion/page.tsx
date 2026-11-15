import { notFound } from "next/navigation";
import { prospeccionEnabled } from "@/server/prospeccion-flag";
import { ProspeccionClient } from "@/components/prospeccion/prospeccion-client";

export const dynamic = "force-dynamic";

/** 072 — Prospección por WhatsApp: lista, permiso, primer mensaje y embudo. */
export default function ProspeccionPage() {
  if (!prospeccionEnabled()) notFound();
  return <ProspeccionClient />;
}
