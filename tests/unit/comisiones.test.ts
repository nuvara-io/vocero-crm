import { describe, expect, it } from "vitest";
import {
  atribuir,
  bpsDesdeTexto,
  comisionDe,
  liquidar,
  normalizarCodigo,
  perfilVigente,
  periodoDe,
  periodoSiguiente,
  ultimoDiaDe,
} from "@/lib/comisiones";

/**
 * 068 — Reglas de comisión acordadas el 2026-11-14: base mensual, 5 % sobre
 * todo si se alcanza, solo la primera venta y solo con el pago confirmado.
 */

const vendedora = { comisiona: true, rateBps: 500, monthlyBaseCents: 50_000_000 };
const socio = { comisiona: false, rateBps: 0, monthlyBaseCents: 0 };

describe("liquidar", () => {
  it("bajo la base no comisiona nada, y dice cuánto falta", () => {
    const l = liquidar({ ventasCents: [8_000_000, 8_000_000], perfil: vendedora });
    expect(l.reached).toBe(false);
    expect(l.commissionCents).toBe(0);
    expect(l.faltaCents).toBe(34_000_000);
    expect(l.salesTotalCents).toBe(16_000_000);
  });

  it("justo en la base cobra el 5 % de todo", () => {
    const l = liquidar({ ventasCents: [25_000_000, 25_000_000], perfil: vendedora });
    expect(l.reached).toBe(true);
    expect(l.commissionCents).toBe(2_500_000);
    expect(l.faltaCents).toBe(0);
  });

  it("sobre la base, el 5 % es sobre TODO lo del mes, no solo el excedente", () => {
    const l = liquidar({ ventasCents: [40_000_000, 20_000_000], perfil: vendedora });
    expect(l.commissionCents).toBe(3_000_000);
  });

  it("un socio cuenta sus ventas pero no comisiona", () => {
    const l = liquidar({ ventasCents: [90_000_000], perfil: socio });
    expect(l.salesTotalCents).toBe(90_000_000);
    expect(l.comisiona).toBe(false);
    expect(l.commissionCents).toBe(0);
    expect(l.faltaCents).toBe(0);
  });

  it("sin perfil tampoco comisiona", () => {
    expect(liquidar({ ventasCents: [90_000_000], perfil: null }).commissionCents).toBe(0);
  });

  it("base en cero y sin ventas no regala nada", () => {
    const l = liquidar({ ventasCents: [], perfil: { ...vendedora, monthlyBaseCents: 0 } });
    expect(l.reached).toBe(false);
    expect(l.commissionCents).toBe(0);
  });

  it("los descuentos de pagos anulados se restan de la comisión", () => {
    const l = liquidar({
      ventasCents: [60_000_000],
      perfil: vendedora,
      ajustesCents: [-400_000],
    });
    expect(l.brutaCents).toBe(3_000_000);
    expect(l.adjustmentCents).toBe(-400_000);
    expect(l.commissionCents).toBe(2_600_000);
  });

  it("un descuento puede dejar el mes negativo aunque no llegue a la base", () => {
    const l = liquidar({ ventasCents: [], perfil: vendedora, ajustesCents: [-400_000] });
    expect(l.commissionCents).toBe(-400_000);
  });
});

describe("perfilVigente", () => {
  const v = (validFrom: string, rateBps: number, at = "2026-01-01T00:00:00Z") => ({
    validFrom,
    rateBps,
    createdAt: new Date(at),
  });

  it("toma la versión más reciente que ya empezó", () => {
    const versiones = [v("2026-01-01", 500), v("2026-03-01", 700)];
    expect(perfilVigente(versiones, "2026-02-28")?.rateBps).toBe(500);
    expect(perfilVigente(versiones, "2026-03-31")?.rateBps).toBe(700);
  });

  it("subir el % en marzo no cambia enero", () => {
    const versiones = [v("2026-01-01", 500), v("2026-03-01", 700)];
    expect(perfilVigente(versiones, ultimoDiaDe("2026-01"))?.rateBps).toBe(500);
  });

  it("antes de la primera versión no hay perfil", () => {
    expect(perfilVigente([v("2026-05-01", 500)], "2026-04-30")).toBeNull();
  });

  it("dos versiones el mismo día: gana la última guardada", () => {
    const versiones = [
      v("2026-05-01", 500, "2026-05-01T10:00:00Z"),
      v("2026-05-01", 600, "2026-05-01T11:00:00Z"),
    ];
    expect(perfilVigente(versiones, "2026-05-15")?.rateBps).toBe(600);
  });
});

describe("atribuir", () => {
  const duenos = new Map([["YULI", "u_yuli"]]);

  it("el código gana sobre el responsable", () => {
    expect(atribuir({ codigo: " yuli ", duenosDeCodigo: duenos, responsableUserId: "u_rob" })).toEqual({
      userId: "u_yuli",
      fuente: "codigo",
    });
  });

  it("código desconocido cae al responsable", () => {
    expect(atribuir({ codigo: "OTRO", duenosDeCodigo: duenos, responsableUserId: "u_rob" })).toEqual({
      userId: "u_rob",
      fuente: "responsable",
    });
  });

  it("sin código ni responsable queda sin atribuir", () => {
    expect(atribuir({ codigo: null, duenosDeCodigo: duenos, responsableUserId: null })).toEqual({
      userId: null,
      fuente: null,
    });
  });
});

describe("fechas y formatos", () => {
  it("el periodo se corta en la zona del negocio, no en UTC", () => {
    // 1 de diciembre 02:00 UTC = 30 de noviembre 21:00 en Bogotá.
    const instante = new Date("2026-12-01T02:00:00Z");
    expect(periodoDe(instante, "America/Bogota")).toBe("2026-11");
    expect(periodoDe(instante, "UTC")).toBe("2026-12");
  });

  it("último día y periodo siguiente", () => {
    expect(ultimoDiaDe("2026-02")).toBe("2026-02-28");
    expect(ultimoDiaDe("2028-02")).toBe("2028-02-29");
    expect(periodoSiguiente("2026-12")).toBe("2027-01");
    expect(periodoSiguiente("2026-01")).toBe("2026-02");
  });

  it("códigos y porcentajes", () => {
    expect(normalizarCodigo(" yu li ")).toBe("YULI");
    expect(normalizarCodigo("x")).toBeNull();
    expect(normalizarCodigo("con/barra")).toBeNull();
    expect(bpsDesdeTexto("5")).toBe(500);
    expect(bpsDesdeTexto("4,5")).toBe(450);
    expect(bpsDesdeTexto("120")).toBeNull();
    expect(comisionDe(8_000_000, 500)).toBe(400_000);
  });
});

import { appNavGroups } from "@/lib/nav";

describe("menú", () => {
  const hrefs = (comisiones: boolean) =>
    appNavGroups({ comisiones, role: "member" }).flatMap((g) => g.items.map((i) => i.href));

  it("Comisiones solo aparece con la bandera", () => {
    expect(hrefs(false)).not.toContain("/comisiones");
    expect(hrefs(true)).toContain("/comisiones");
  });
});

import { netoDe } from "@/lib/comisiones";

describe("069 — sobre el neto", () => {
  it("quita el IVA incluido", () => {
    expect(netoDe(11_900_000, 1900)).toBe(10_000_000);
    expect(netoDe(8_000_000, 0)).toBe(8_000_000);
  });

  it("la base se mide con el neto: $119.000 pagados no llegan a una base de $110.000", () => {
    const l = liquidar({
      ventasCents: [11_900_000],
      perfil: { comisiona: true, rateBps: 500, monthlyBaseCents: 11_000_000 },
      ivaBps: 1900,
    });
    expect(l.salesNetCents).toBe(10_000_000);
    expect(l.reached).toBe(false);
    expect(l.faltaCents).toBe(1_000_000);
  });

  it("el 5 % va sobre el neto de todo el mes", () => {
    const l = liquidar({
      ventasCents: [11_900_000, 11_900_000],
      perfil: { comisiona: true, rateBps: 500, monthlyBaseCents: 10_000_000 },
      ivaBps: 1900,
    });
    expect(l.salesNetCents).toBe(20_000_000);
    expect(l.commissionCents).toBe(1_000_000);
  });
});

describe("069 — ventas por otro canal", () => {
  const duenos = new Map([["YULI", "u_yuli"]]);

  it("quien la registró a mano gana sobre el responsable del lead", () => {
    expect(
      atribuir({ codigo: null, duenosDeCodigo: duenos, registradaPor: "u_ana", responsableUserId: "u_rob" })
    ).toEqual({ userId: "u_ana", fuente: "manual" });
  });

  it("el código del cliente gana sobre el registro a mano", () => {
    expect(
      atribuir({ codigo: "YULI", duenosDeCodigo: duenos, registradaPor: "u_ana", responsableUserId: null })
    ).toEqual({ userId: "u_yuli", fuente: "codigo" });
  });
});
