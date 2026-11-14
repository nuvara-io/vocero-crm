# 067 — Bandeja para el equipo comercial (fork de núvara)

Fork `nuvara-io/vocero-crm`, rama `nuvara`, sobre la 2.7.0.

## Problema

La Bandeja mezcla a quien ya compró, a quien se perdió y a quien hay que
volver a escribirle; nadie sabe quién del equipo lleva cada lead, y la agenda
ofrecía citas en festivos de Colombia.

## Qué trae

1. **Archivar** desde el chat (panel «Responsable») o en lote. Lo archivado
   sale de «Todas» y «No leídas» y vive en la pestaña «Archivadas». Si el
   contacto escribe de nuevo, se desarchiva solo (ingesta).
   Reusa `contact.archived_at`, que ya existía para Contactos.
2. **Responsable** del lead (`lead.assigned_user_id`, solo miembros del
   equipo): selector en el panel, chip con el nombre en la fila, texto
   «Robinson hace el seguimiento» y filtro «Responsable» (cualquiera, sin
   responsable o una persona). Un solo campo para demostración, cierre y
   seguimiento.
3. **Seguimiento pendiente**: filtro «Sin respuesta hace N días o más» (1, 2,
   3, 7) y chip «Sin respuesta · N d» desde 2 días. Regla pura en
   `src/lib/filtros-bandeja.ts`: le escribimos de último, etapa abierta y sin
   archivar.
4. **Acciones en lote** («Seleccionar»): archivar o desarchivar, mover de
   etapa (con motivo si es perdida, por la puerta `moveLeadToStage`), asignar
   responsable y mandar una plantilla aprobada con 0 o 1 variable (el primer
   nombre; si no lo hay, un texto de respaldo). Ruta
   `POST /api/conversations/lote`; la plantilla va una por una por
   `/messages/template`.
5. **Días sin citas** en Ajustes → Agenda: festivos de Colombia (Ley Emiliani,
   `src/lib/festivos.ts`) y fechas cerradas a mano
   (`calendar_settings.holiday_country`, `closed_dates`). El motor los salta
   en `buildCandidateSlots`, así que también los respeta el cerebro.
6. **Aviso de la plataforma** `POST /api/bot/plataforma` (llave del bot):
   `registrado` mueve a la etapa abierta «Registrado» y `activado` a la
   primera ganada y archiva. Solo hacia adelante e idempotente. Busca por
   teléfono o por el correo de la ficha.

## Migración

`drizzle/0027_nuvara_asignado_festivos.sql`, aditiva y re-ejecutable.

## Verificación

- `pnpm typecheck && pnpm lint && pnpm test` (1.471 pruebas).
- En vivo contra `pnpm dev` + Postgres local: asignar desde el panel, archivar
  y ver «Archivadas», lote de responsable, lote de etapa con y sin motivo,
  ruta de la plataforma (adelante, sin retroceso, idempotente) y festivos en
  «Próximos huecos».
- Sin probar en vivo: el desarchivado al recibir un mensaje (cubierto en
  código) y el envío de plantillas en lote contra Meta.
