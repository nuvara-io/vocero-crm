import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { esPeriodo } from "@/lib/comisiones";
import { comisionesDisabledResponse, comisionesEnabled } from "@/server/comisiones/flag";
import { csvDelMes, resumenMes } from "@/server/comisiones/liquidaciones";

export const dynamic = "force-dynamic";

/** 068 — El mes en CSV, para pagar. */
export const GET = withAuth(async (session, req: Request) => {
  if (!comisionesEnabled()) return comisionesDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra puede exportar");
  const periodo = new URL(req.url).searchParams.get("periodo") ?? "";
  if (!esPeriodo(periodo)) return apiError(422, "invalid_period", "Usa el formato AAAA-MM");
  const csv = csvDelMes(await resumenMes(session.organizationId, periodo));
  // BOM para que Excel lea las tildes.
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="comisiones-${periodo}.csv"`,
    },
  });
});
