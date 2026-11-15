# 072 — Prospección por WhatsApp con permiso (fork de núvara)

Pedido (2026-11-15): un flujo para ir dejando prospectos (la lista de firmas
contables del equipo, en Excel) y hablarles desde el CRM. Reglas del cerebro
de núvara, tema `prospeccion-por-whatsapp`.

## Qué trae (bandera `PROSPECCION`, apagada por defecto)

1. **Importar la lista** (Prospección → Importar lista): el `.xlsx` del equipo
   (hoja «Firmas») o un CSV con «Firma» y «WhatsApp publicado». Lectura en el
   navegador con `read-excel-file` y validación de nuevo en el servidor
   (`leerHojaDeFirmas`). Cada firma entra como contacto con su ficha (ciudad,
   región, servicios, tamaño, programa, sitio, encaje, notas, Harvey), el
   agente apagado, lead en «Prospecto» y responsable según Reparto. Quien ya
   está en el CRM por número no se toca y se reporta. Aviso de «no escribir
   por dos canales» si Harvey tiene un correo en borrador.
2. **Etapas** «Prospecto» → «Permiso pedido» → «Permiso sí» al principio del
   pipeline (se crean solas). Motivos de pérdida nuevos: «No dio permiso» y
   «Pidió la baja».
3. **Pantalla Prospección**: embudo (firmas, permisos pedidos, permisos sí,
   escritas, respondieron, demos, bajas), aviso de salud (>10 % de bajas),
   filtros por estado, encaje y región; orden encaje Alto primero; llamar,
   sitio, «Pedí permiso», «Dio permiso» (canal + texto aceptado, con fecha y
   quién, Ley 1581), «No dio permiso», «Baja» y «Escribir por WhatsApp».
4. **Bloqueos en `sendTemplate`** (vale para chat, lote y seguimiento):
   supresión (cualquier contacto), prospecto sin permiso, horario Ley 2300
   (L–V 7–19, sáb 8–15, sin domingos ni festivos) y tope de 20 prospectos
   nuevos por día. Errores 409 con mensaje claro.
5. **Respuestas**: «No me interesa», «baja», «no me escriban»… de un
   prospecto → lista de supresión y Perdido. Cualquier otra respuesta saca al
   prospecto de las etapas de prospección a «En conversación».
6. **Seguimiento de prospectos** (Ajustes → Reparto y seguimiento): pasos
   propios (día 2, día 6), nunca archiva, en horario de ley; el seguimiento
   general ya no los toca.

Migración `0032_prospeccion.sql`, aditiva y re-ejecutable.

## Verificación

- Pruebas: `tests/unit/prospeccion.test.ts` (13) + suite completa (1.528).
- El Excel real (73 firmas) se lee completo, sin problemas, con el aviso de
  Harvey en 1.
- En vivo local con firmas inventadas y WhatsApp simulado: importación (3
  nuevas + 1 ya en el CRM), etapas, bloqueo sin permiso / fuera de horario /
  suprimido, respuesta normal → «En conversación», «No me interesa» →
  Perdido + supresión.

## Por definir (cerebro)

Número (CRM o WhatsApp Business aparte), quién llama, plantillas a Meta
(`primer_contacto_firma`, `seguimiento_prospecto` con botón «No me
interesa», confirmación y recordatorio de demo) y el código `FIRMASWA`.
