import { describe, expect, it } from "vitest";
import {
  decidirSeguimiento,
  secuenciaDeEtapa,
  tocaRecordatorio,
  type AjustesSeguimiento,
} from "@/lib/crm-reglas";
import { problemaDeVariable, problemasDePlantilla } from "@/lib/plantilla-variables";
import { normalizar } from "@/server/crm-ajustes";
import { secuenciasRecomendadas } from "@/components/settings/seguimiento-etapas";

/** 077 — Secuencia por etapa, recordatorio de demo y la casilla del nombre. */

const base: AjustesSeguimiento = { enabled: true, pasos: [], archivarDias: 0 };

describe("decidirSeguimiento con acción final", () => {
  const ajustes = { enabled: true, pasos: [{ dias: 2, templateId: "t1" }], archivarDias: 10 };
  it("manda el paso a su día", () => {
    expect(decidirSeguimiento({ ajustes, dias: 2, hechos: new Set(), final: "perdido" })).toEqual({
      accion: "enviar",
      paso: 1,
      templateId: "t1",
    });
  });
  it("al final pasa a Perdido si así se configuró", () => {
    expect(decidirSeguimiento({ ajustes, dias: 10, hechos: new Set([1]), final: "perdido" })).toEqual({
      accion: "perdido",
    });
  });
  it("«no hacer nada» no archiva ni pierde", () => {
    expect(decidirSeguimiento({ ajustes, dias: 30, hechos: new Set([1]), final: "nada" })).toBeNull();
  });
  it("sin `final` sigue archivando como antes", () => {
    expect(decidirSeguimiento({ ajustes, dias: 10, hechos: new Set([1]) })).toEqual({ accion: "archivar" });
  });
});

describe("secuenciaDeEtapa", () => {
  it("sin secuencias por etapa usa la general", () => {
    expect(secuenciaDeEtapa(base, "stg1")).toEqual({ modo: "general" });
  });
  it("con secuencias, una etapa sin la suya no recibe nada", () => {
    const a = { ...base, porEtapa: [{ stageId: "stg1", pasos: [], finalDias: 0, final: "nada" as const }] };
    expect(secuenciaDeEtapa(a, "stg1")?.modo).toBe("etapa");
    expect(secuenciaDeEtapa(a, "demo-agendada")).toBeNull();
  });
});

describe("tocaRecordatorio", () => {
  const cita = new Date("2026-11-18T14:10:00Z");
  it("dentro de los 15 minutos previos, sí", () => {
    expect(tocaRecordatorio({ ahora: new Date("2026-11-18T13:56:00Z"), citaEn: cita, minutos: 15 })).toBe(true);
  });
  it("antes de la ventana, no", () => {
    expect(tocaRecordatorio({ ahora: new Date("2026-11-18T13:50:00Z"), citaEn: cita, minutos: 15 })).toBe(false);
  });
  it("con la cita ya empezada, no (el del 17-nov salió 6 min tarde)", () => {
    expect(tocaRecordatorio({ ahora: new Date("2026-11-18T14:16:00Z"), citaEn: cita, minutos: 15 })).toBe(false);
  });
});

describe("la casilla del nombre", () => {
  it("un nombre pasa", () => {
    expect(problemaDeVariable("nombre", "Leidy")).toBeNull();
    expect(problemaDeVariable("nombre", "María José")).toBeNull();
  });
  it("un párrafo no pasa (caso real del 17-nov)", () => {
    const parrafo =
      "Hola, soy Valeria de núvara. Te recuerdo que hoy tenemos una demostracion de la plataforma a las 9:10am. Si necesitas reagendarla lo podemos hacer";
    expect(problemaDeVariable("nombre", parrafo)).toMatch(/solo el nombre/);
    expect(
      problemasDePlantilla("Hola {{1}}, soy Valeria de núvara. Quedó pendiente tu consulta.", [parrafo])[0]
    ).toMatch(/solo el nombre/);
  });
  it("un enlace largo en la casilla del enlace sí pasa", () => {
    expect(problemaDeVariable("enlace", "https://meet.google.com/dst-sbvd-xyy?authuser=0&hs=122")).toBeNull();
  });
});

describe("normalizar porEtapa", () => {
  it("descarta basura y repetidas, y encendido cuenta las secuencias", () => {
    const a = normalizar({
      seguimiento: {
        enabled: true,
        pasos: [],
        archivarDias: 0,
        incluirAtendidos: true,
        porEtapa: [
          { stageId: "s1", pasos: [{ dias: 2, templateId: "t" }], finalDias: 10, final: "perdido" },
          { stageId: "s1", pasos: [], finalDias: 3, final: "archivar" },
          { stageId: "", pasos: [] },
          { stageId: "s2", pasos: [], finalDias: 5, final: "raro" },
        ],
      },
    });
    expect(a.seguimiento.enabled).toBe(true);
    expect(a.seguimiento.incluirAtendidos).toBe(true);
    expect(a.seguimiento.porEtapa).toEqual([
      { stageId: "s1", pasos: [{ dias: 2, templateId: "t" }], finalDias: 10, final: "perdido" },
      { stageId: "s2", pasos: [], finalDias: 5, final: "archivar" },
    ]);
  });
  it("el recordatorio sin plantilla queda apagado", () => {
    expect(normalizar({ recordatorio: { enabled: true, minutos: 15, plantilla: null } }).recordatorio.enabled).toBe(
      false
    );
  });
});

describe("secuenciasRecomendadas", () => {
  it("arma por nombre y avisa las plantillas que faltan", () => {
    const etapas = [
      { id: "a", name: "Calificado", kind: "open" as const },
      { id: "b", name: "Registrado", kind: "open" as const },
      { id: "c", name: "Demo agendada", kind: "open" as const },
    ];
    const plantillas = [
      { id: "p1", name: "retomar_conversacion_valeria" },
      { id: "p2", name: "reactivar_conversacion_valeria" },
    ];
    const r = secuenciasRecomendadas(etapas, plantillas);
    expect(r.secuencias.map((x) => x.stageId)).toEqual(["a", "b"]);
    expect(r.secuencias[0]).toMatchObject({ final: "perdido", pasos: [{ dias: 2, templateId: "p1" }] });
    expect(r.secuencias[1]).toMatchObject({ final: "nada", finalDias: 0 });
    expect(r.faltan.sort()).toEqual(["invitar_demostracion", "ponte_al_dia_recarga"]);
  });
});

describe("sugerirVariables y el punto de la hora", () => {
  it("no deja «a. m..» cuando la plantilla ya pone punto", async () => {
    const { sugerirVariables } = await import("@/lib/plantilla-variables");
    const body = "Hola {{1}}, tu demo es el {{2}} a las {{3}}. Entra: {{4}} .";
    const v = sugerirVariables(body, 4, {
      nombre: "Ana",
      asesor: null,
      negocio: null,
      cita: { fecha: "martes 18 de noviembre", hora: "9:25 a. m.", enlace: "https://meet.google.com/x" },
    });
    expect(v[2]!.valor).toBe("9:25 a. m");
  });
});

describe("espacio entre pasos (chats viejos)", () => {
  const ajustes = {
    enabled: true,
    pasos: [
      { dias: 3, templateId: "t1" },
      { dias: 7, templateId: "t2" },
    ],
    archivarDias: 10,
  };
  it("un chat de 30 días recibe el paso 1, pero no el 2 a los 15 minutos", () => {
    expect(decidirSeguimiento({ ajustes, dias: 30, hechos: new Set(), diasDesdeUltimo: null })).toMatchObject({ paso: 1 });
    expect(decidirSeguimiento({ ajustes, dias: 30, hechos: new Set([1]), diasDesdeUltimo: 0 })).toBeNull();
  });
  it("el paso 2 sale cuando se cumple la diferencia (4 días)", () => {
    expect(decidirSeguimiento({ ajustes, dias: 34, hechos: new Set([1]), diasDesdeUltimo: 4 })).toMatchObject({ paso: 2 });
  });
  it("la acción final espera su diferencia desde el último paso (3 días)", () => {
    expect(decidirSeguimiento({ ajustes, dias: 35, hechos: new Set([1, 2]), diasDesdeUltimo: 1 })).toBeNull();
    expect(decidirSeguimiento({ ajustes, dias: 37, hechos: new Set([1, 2]), diasDesdeUltimo: 3 })).toEqual({
      accion: "archivar",
    });
  });
});
