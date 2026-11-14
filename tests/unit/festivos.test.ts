import { describe, expect, it } from "vitest";
import { diasCerrados, domingoDePascua, festivosDe } from "@/lib/festivos";
import { buildCandidateSlots } from "@/server/agenda/availability";
import {
  DEFAULT_CALENDAR_SETTINGS,
  normalizeClosedDates,
  type CalendarSettings,
} from "@/server/agenda/settings";

/** 067 — Festivos de Colombia y días cerrados de la agenda. */

describe("domingoDePascua", () => {
  it("calcula la Pascua de varios años", () => {
    expect(domingoDePascua(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(domingoDePascua(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
    expect(domingoDePascua(2025).toISOString().slice(0, 10)).toBe("2025-04-20");
  });
});

describe("festivosDe CO", () => {
  it("2026: 18 festivos con los trasladados al lunes", () => {
    const f = festivosDe("CO", 2026);
    expect(f).toHaveLength(18);
    expect(f).toEqual(
      expect.arrayContaining([
        "2026-01-01",
        "2026-01-12", // Reyes (6 ene, martes) → lunes 12
        "2026-03-23", // San José (19 mar, jueves) → lunes 23
        "2026-04-02", // Jueves Santo
        "2026-04-03", // Viernes Santo
        "2026-05-01",
        "2026-05-18", // Ascensión
        "2026-06-08", // Corpus Christi
        "2026-06-15", // Sagrado Corazón
        "2026-06-29", // San Pedro y San Pablo (lunes)
        "2026-07-20",
        "2026-08-07",
        "2026-08-17", // Asunción (15 ago, sábado) → lunes 17
        "2026-10-12", // Día de la Raza (lunes)
        "2026-11-02", // Todos los Santos (1 nov, domingo) → lunes 2
        "2026-11-16", // Independencia de Cartagena (11 nov, miércoles) → lunes 16
        "2026-12-08",
        "2026-12-25",
      ])
    );
  });

  it("2027: los del primer trimestre", () => {
    const f = festivosDe("CO", 2027);
    for (const d of ["2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26"]) {
      expect(f).toContain(d);
    }
  });
});

describe("diasCerrados", () => {
  it("une festivos y fechas a mano, cruzando el año", () => {
    const s = diasCerrados("2026-12-20", "2027-01-15", {
      pais: "CO",
      cerradas: ["2026-12-31"],
    });
    expect(s.has("2026-12-25")).toBe(true);
    expect(s.has("2026-12-31")).toBe(true);
    expect(s.has("2027-01-11")).toBe(true);
  });

  it("sin país solo cierra lo escrito a mano", () => {
    const s = diasCerrados("2026-11-01", "2026-11-30", { pais: null, cerradas: [] });
    expect(s.has("2026-11-16")).toBe(false);
  });
});

describe("buildCandidateSlots con días cerrados", () => {
  const base: CalendarSettings = {
    ...DEFAULT_CALENDAR_SETTINGS,
    timezone: "America/Bogota",
  };

  it("el lunes festivo no abre aunque el horario sí", () => {
    // 2026-11-16 es lunes festivo en Colombia; 2026-11-17 martes hábil.
    const conFestivos = buildCandidateSlots(
      { ...base, holidayCountry: "CO" },
      "2026-11-16",
      "2026-11-17"
    );
    const dias = new Set(conFestivos.map((s) => s.startUtc.slice(0, 10)));
    expect(dias.has("2026-11-16")).toBe(false);
    expect(dias.has("2026-11-17")).toBe(true);

    const sinFestivos = buildCandidateSlots(base, "2026-11-16", "2026-11-16");
    expect(sinFestivos.length).toBeGreaterThan(0);
  });

  it("una fecha cerrada a mano tampoco abre", () => {
    const slots = buildCandidateSlots(
      { ...base, closedDates: ["2026-11-17"] },
      "2026-11-17",
      "2026-11-17"
    );
    expect(slots).toHaveLength(0);
  });
});

describe("normalizeClosedDates", () => {
  it("descarta lo inválido, quita repetidos y ordena", () => {
    expect(
      normalizeClosedDates(["2026-12-31", "2026-02-30", "x", 5, "2026-12-24", "2026-12-31"])
    ).toEqual(["2026-12-24", "2026-12-31"]);
    expect(normalizeClosedDates(null)).toEqual([]);
  });
});
