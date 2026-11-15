import { notFound, redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { periodoDe } from "@/lib/comisiones";
import { businessTimezone } from "@/server/analytics/period";
import { comisionesEnabled } from "@/server/comisiones/flag";
import { ComisionesClient } from "@/components/comisiones/comisiones-client";

export const dynamic = "force-dynamic";

/** 068 — Comisiones del equipo comercial. Solo con la bandera COMISIONES. */
export default async function ComisionesPage() {
  if (!comisionesEnabled()) notFound();
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const tz = await businessTimezone(session.organizationId);
  return <ComisionesClient mesActual={periodoDe(new Date(), tz)} />;
}
