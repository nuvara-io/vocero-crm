# 073 — Embudo alrededor de la demo (plantilla «Tu Nuevo Pipeline»)

Pedido (2026-11-15): aplicar al CRM la plantilla de pipeline de
@tudeptodeventas. Lo que entra:

1. **Etapas «Demo hecha», «No asistió», «Seguimiento»** después de «Demo
   agendada» (o de la última etapa abierta). Se crean solas la primera vez que
   se marca el resultado de una cita (`asegurarEtapasDeDemo`).
2. **Marcar la cita mueve el lead**: realizada → «Demo hecha»; no asistió →
   «No asistió» (`alMarcarResultadoDeCita`, desde `PATCH /api/bookings/[id]`).
3. **Valor por defecto de la demo** (Ajustes → Reparto y seguimiento → Demos):
   al entrar a una etapa que exige cita, el lead sin valor toma ese valor.
4. **Recuperar a quien no asistió** (apagado por defecto): plantilla 1 a los N
   minutos (10) de marcarla → el lead pasa a «Seguimiento»; plantilla 2 a los
   N días (1) si no escribió nada después. Solo plantillas aprobadas, en horario
   hábil, nunca a contactos suprimidos ni citas de prueba. Cada paso se reserva
   en `followup_send` (pasos 101/102) antes de enviar: no sale dos veces.
5. **Revisión de la semana** en Resultados: entradas por etapa en 7 días,
   paso entre etapas seguidas, la mayor caída (mín. 3 entradas) con su
   diagnóstico y la plata sobre la mesa (Demo agendada + No asistió +
   Seguimiento).

Sin migración: los ajustes viven en `organization.metadata.crm`.

## Plantillas de Meta (Utilidad, es_CO) para el punto 4

- `no_asistio_demostracion`: «Hola {{1}}, te esperé en la demostración de hoy.
  ¿Te surgió algo? Si quieres, la pasamos para otro día.»
- `reagendar_demostracion`: «{{1}}, ¿te queda bien que reagendemos? Dime día y
  hora y te la dejo agendada.»

## Verificación

- `tests/unit/revision-semanal.test.ts` (4), `tests/unit/embudo-demo-ajustes.test.ts` (4);
  suite completa 1.536.
- En vivo contra la base local (prueba temporal, datos restaurados): etapas
  creadas tras «Interesado», no asistió → «No asistió», nada antes de 10 min,
  a los 11 min plantilla 1 con «María» y lead en «Seguimiento», sin repetir,
  al día plantilla 2, valor por defecto 80.000 al entrar a etapa con cita,
  revisión semanal con conteos.
