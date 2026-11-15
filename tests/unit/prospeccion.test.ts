import { describe, expect, it } from "vitest";
import {
  bloqueoDePlantilla,
  horarioLey2300,
  leerHojaDeFirmas,
  normalizarTelefono,
  pideBaja,
  rangoEncaje,
} from "@/lib/prospeccion";

const bogota = (iso: string) => new Date(`${iso}-05:00`);

describe("072 — horario de la Ley 2300", () => {
  it("lunes a viernes de 7:00 a 19:00", () => {
    expect(horarioLey2300(bogota("2026-11-17T07:00:00"))).toBe(true);
    expect(horarioLey2300(bogota("2026-11-17T06:59:00"))).toBe(false);
    expect(horarioLey2300(bogota("2026-11-17T18:59:00"))).toBe(true);
    expect(horarioLey2300(bogota("2026-11-17T19:00:00"))).toBe(false);
  });

  it("sábado de 8:00 a 15:00", () => {
    expect(horarioLey2300(bogota("2026-11-21T08:00:00"))).toBe(true);
    expect(horarioLey2300(bogota("2026-11-21T07:30:00"))).toBe(false);
    expect(horarioLey2300(bogota("2026-11-21T15:00:00"))).toBe(false);
  });

  it("nunca domingos ni festivos", () => {
    expect(horarioLey2300(bogota("2026-11-15T10:00:00"))).toBe(false);
    expect(horarioLey2300(bogota("2026-11-16T10:00:00"))).toBe(false);
  });
});

describe("072 — bloqueoDePlantilla", () => {
  const habil = bogota("2026-11-17T10:00:00");
  const base = { prospectList: "firmas", consentAt: new Date(), doNotContactAt: null, firstContactAt: null };

  it("un contacto normal no tiene bloqueo", () => {
    const contacto = { ...base, prospectList: null, consentAt: null };
    expect(bloqueoDePlantilla({ contacto, ahora: habil, primerosContactosHoy: 99 })).toBeNull();
  });

  it("la supresión manda sobre todo, prospecto o no", () => {
    const contacto = { ...base, prospectList: null, doNotContactAt: new Date() };
    expect(bloqueoDePlantilla({ contacto, ahora: habil, primerosContactosHoy: 0 })?.code).toBe("suprimido");
  });

  it("prospecto sin permiso no", () => {
    expect(bloqueoDePlantilla({ contacto: { ...base, consentAt: null }, ahora: habil, primerosContactosHoy: 0 })?.code).toBe(
      "sin_permiso"
    );
  });

  it("con permiso, solo en horario", () => {
    expect(bloqueoDePlantilla({ contacto: base, ahora: bogota("2026-11-17T20:00:00"), primerosContactosHoy: 0 })?.code).toBe(
      "fuera_de_horario"
    );
    expect(bloqueoDePlantilla({ contacto: base, ahora: habil, primerosContactosHoy: 0 })).toBeNull();
  });

  it("el tope diario cuenta solo a los nuevos", () => {
    expect(bloqueoDePlantilla({ contacto: base, ahora: habil, primerosContactosHoy: 20 })?.code).toBe("tope_diario");
    const yaContactado = { ...base, firstContactAt: new Date() };
    expect(bloqueoDePlantilla({ contacto: yaContactado, ahora: habil, primerosContactosHoy: 20 })).toBeNull();
  });
});

describe("072 — pideBaja", () => {
  it("el botón y las frases comunes", () => {
    for (const t of ["No me interesa", "baja", "Por favor no me escriban más", "Quiero darme de baja", "No quiero recibir más mensajes", "dejen de escribirme"]) {
      expect(pideBaja(t)).toBe(true);
    }
  });

  it("no confunde una pregunta normal", () => {
    for (const t of ["¿Cuánto cuesta?", "No me interesa por ahora el plan grande, pero cuéntame del pequeño", "baja el precio?", null]) {
      expect(pideBaja(t)).toBe(false);
    }
  });
});

describe("072 — leerHojaDeFirmas", () => {
  const encabezado = [
    "Firma",
    "Ciudad",
    "Región",
    "Servicios",
    "Señal de tamaño",
    "Programa contable que menciona",
    "WhatsApp publicado",
    "Sitio web",
    "Dónde se ve el WhatsApp",
    "Verificado el",
    "Encaje para núvara",
    "Por qué ese encaje",
    "Notas de la búsqueda",
    "Harvey (exportación del 05/11)",
    "¿Registrada en núvara?",
  ];

  it("lee el formato del equipo y arma la ficha", () => {
    const { filas, problemas } = leerHojaDeFirmas([
      encabezado,
      ["Alianza Contable", "Bogotá", "Bogotá y Cundinamarca", "outsourcing contable", "atiende pymes", "Siigo", "+57 300 111 2233", "https://a.co", "https://a.co/", "2026-11-15", "Alto", "Lleva varias", null, "No está en Harvey", "Por verificar"],
      ["Asaudit", "Cali", "Valle", "auditoría", null, null, "3001112244", "https://b.co", "https://b.co/", "2026-11-15", "Bajo", "Otro foco", null, "Está en Harvey: correo en borrador sin enviar", "Por verificar"],
      ["Repetida", "Cali", "Valle", "x", null, null, "+573001112244", "", "", "", "Medio", "", "", "", ""],
      ["Sin número", "Cali", "Valle", "x", null, null, "abc", "", "", "", "Medio", "", "", "", ""],
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ nombre: "Alianza Contable", telefono: "573001112233" });
    expect(filas[0]!.ficha).toMatchObject({ ciudad: "Bogotá", encaje: "Alto", programa: "Siigo", sitio: "https://a.co" });
    expect(filas[0]!.ficha).not.toHaveProperty("aviso");
    expect(filas[1]!.ficha.aviso).toMatch(/dos canales/);
    expect(problemas.map((p) => p.motivo)).toEqual(["repetido en el archivo", "teléfono inválido"]);
  });

  it("sin columna Firma lo dice", () => {
    expect(leerHojaDeFirmas([["Nombre", "Tel"]]).problemas[0]?.motivo).toMatch(/Firma/);
  });

  it("teléfonos y orden por encaje", () => {
    expect(normalizarTelefono("+57 (300) 111-2233")).toBe("573001112233");
    expect(normalizarTelefono("3001112233")).toBe("573001112233");
    expect(normalizarTelefono("12345")).toBeNull();
    expect(["Bajo", "Alto", "Medio"].sort((a, b) => rangoEncaje(a) - rangoEncaje(b))).toEqual(["Alto", "Medio", "Bajo"]);
  });
});
