# 071 — CRM bien armado (fork de núvara)

Pedido (2026-11-15): «haz todo» sobre la lista de ajustes del CRM.

## Qué trae

1. **Texto limpio para WhatsApp.** `limpiarTextoParaWhatsApp` (lib/crm-reglas)
   en `POST /api/bot/messages`: quita LaTeX (`$500 \times \$510$` → `500 × $510`),
   pasa `**negrita**` a `*negrita*` y borra encabezados `###`. No toca precios.
2. **Responsable de los leads nuevos** (Ajustes → Reparto y seguimiento):
   nadie, una persona o rotación. Se aplica al crear el lead por WhatsApp.
3. **Origen deducido** del primer mensaje cuando no hubo anuncio:
   `contact.source_hint` = `web` (texto del enlace de la página/redes) o
   `meta` (saludo automático de Meta). Se ve en Contactos y en Resultados.
4. **Etapas que exigen cita** (`pipeline_stage.requires_booking`, botón con
   calendario en «Etapas del pipeline»): el cerebro no puede mover un lead ahí
   sin una cita `agendada` a futuro (409 `requiere_cita`). Una persona sí.
   El resultado de la demo ya existía en la cita (realizada, no asistió…).
5. **Plantillas ocultas** (`template.hidden`): «Ocultar del chat» en Ajustes →
   Plantillas; solo en el CRM, en Meta sigue igual.
6. **Seguimiento automático** (apagado por defecto): pasos con N días y una
   plantilla aprobada, y archivar a los N días. Ancla = primer mensaje nuestro
   tras su última respuesta; si contesta, vuelve a empezar. Horario hábil
   (8–19 h, lunes a sábado, sin festivos CO), tope de 25 por pasada cada
   15 min, nunca con una persona al frente, de prueba, ganados o perdidos.
   Bitácora en `followup_send`.

Migración `0030_crm_bien_armado.sql`, aditiva y re-ejecutable. Los ajustes
viven en `organization.metadata.crm`.

## Verificación

- Pruebas: `tests/unit/crm-reglas.test.ts` (14) + suite completa.
- En vivo local (WhatsApp simulado): rotación web→Valeria, meta→Yuli,
  otro→Valeria con la pista correcta; etapa bloqueada sin cita y libre con
  cita; seguimiento: paso 1 al día 4, sin repetir, paso 2, archivado al día
  11; domingo y festivo (16 nov) fuera de horario.

## Operación (2026-11-15)

- **Imagen en GitHub:** el workflow `Imagen` del fork estaba apagado (GitHub
  apaga los workflows al hacer fork). Se encendió y el repo tiene escritura
  sobre el paquete `ghcr.io/nuvara-io/vocero-crm`. Cada etiqueta `v*` publica
  la imagen amd64 (`2.7.0-nuvara.N` y `sha-…`). Ya no hace falta construir
  en el Mac.
- **Respaldo:** servicio `respaldo` en el compose de Dokploy: `pg_dump -Fc`
  diario a las 08:00 UTC, guarda 14 en el volumen `vocero_respaldos`; en la
  primera corrida restauró la copia en una base temporal (47 contactos) y la
  borró. Las copias viven en el mismo servidor: falta un destino externo (S3).
- **Seguridad:** better-auth 1.6.23 → 1.7.12 (alertas críticas). Exige
  `invitation.created_at` (migración 0031).
