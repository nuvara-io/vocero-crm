import { TeamClient } from "@/components/settings/team-client";
import { CondicionesComerciales } from "@/components/settings/condiciones-comerciales";
import { getSessionOrNull } from "@/lib/auth/session";
import { canConfigure } from "@/lib/auth/roles";
import { comisionesEnabled } from "@/server/comisiones/flag";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const session = await getSessionOrNull();
  // 068 — Las condiciones comerciales solo con la bandera y para quien administra.
  const condiciones = comisionesEnabled() && canConfigure(session?.role);
  return (
    <div className="max-w-2xl space-y-6">
      <TeamClient />
      {condiciones && <CondicionesComerciales />}
    </div>
  );
}
