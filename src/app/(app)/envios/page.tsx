import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { EnviosClient } from "@/components/envios/envios-client";

export const dynamic = "force-dynamic";

/** 085 — Lo que va a salir: plantillas programadas y seguimiento automático. */
export default async function EnviosPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <EnviosClient />;
}
