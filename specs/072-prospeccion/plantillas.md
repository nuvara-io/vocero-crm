# Plantillas de Meta para la prospección (072)

Textos para crear en el CRM de núvara (Ajustes → Plantillas → nueva). Salen del
cerebro, tema `prospeccion-por-whatsapp`. Reglas de Meta que ya cumplen: ninguna
empieza ni termina con una variable, no hay dos variables juntas, cada variable
tiene ejemplo. El CRM crea plantillas solo con cuerpo (sin botones), así que la
salida va como texto: «responde BAJA», y el CRM ya la reconoce como baja.

Ya existen y se reusan: `recordatorio_demostracion` (aprobada) y
`contacto_asesora` (aprobada).

---

## 1. `primer_contacto_firma` — Marketing · Español (es)

Primer WhatsApp, el mismo día del sí (paso 2 del cerebro).

```
Hola {{1}}, soy {{2}} de núvara. Gracias por dejarme escribirte. núvara trae las facturas de la DIAN y del correo y prepara la causación con IVA y retenciones; tú revisas y apruebas, y nada se exporta sin tu aprobación. ¿Cuántas empresas llevas más o menos? Si prefieres que no te escriba más, responde BAJA.
```

- {{1}} nombre de quien dio el permiso → ejemplo: `Andrea`
- {{2}} nombre del asesor → ejemplo: `Valeria`

## 2. `prospecto_dato_util` — Marketing · Español (es)

Seguimiento día 2 si no responde: un dato útil.

```
Hola {{1}}, un dato que suele ahorrar sustos en el cierre: cruzar las facturas del mes con la DIAN antes de declarar el IVA. núvara lo hace sola y te muestra lo que falta causar. Si te sirve, te lo enseño en 30 minutos con tus propias facturas. Si prefieres que no te escriba más, responde BAJA.
```

- {{1}} nombre → ejemplo: `Andrea`

## 3. `prospecto_ultimo_mensaje` — Marketing · Español (es)

Seguimiento día 6: último mensaje, con salida clara. Después no se escribe más.

```
Hola {{1}}, este es mi último mensaje para no llenarte el chat. Si en algún momento quieres ver núvara con tus facturas, me escribes por aquí y agendamos una demostración en vivo de 30 minutos, gratis. Si prefieres que no te escriba más, responde BAJA y queda así.
```

- {{1}} nombre → ejemplo: `Andrea`

## 4. `confirmacion_demostracion` — Utilidad · Español (es)

Al agendar (paso 5). Servicio: sin precios ni promociones, para que Meta la deje
como utilidad.

```
Hola {{1}}, quedó agendada tu demostración en vivo de núvara el {{2}} a las {{3}} por Google Meet. Si tienes a mano el RUT de una empresa y el correo donde te llegan las facturas, la hacemos con tus casos reales. Si necesitas cambiar la hora, responde a este mensaje.
```

- {{1}} nombre → ejemplo: `Andrea`
- {{2}} día → ejemplo: `martes 17 de noviembre`
- {{3}} hora → ejemplo: `9:00 a. m.`

---

## Cómo se usan en el CRM

1. Crearlas en Ajustes → Plantillas (se mandan a revisión de Meta; tarda de
   minutos a un par de días).
2. `primer_contacto_firma`: desde Prospección → «Escribir por WhatsApp», solo a
   quien tiene el permiso registrado y en horario de la Ley 2300.
3. `prospecto_dato_util` (día 2) y `prospecto_ultimo_mensaje` (día 6): en Ajustes
   → Reparto y seguimiento → «Seguimiento de prospectos», y encenderlo.
4. `confirmacion_demostracion` al agendar; `recordatorio_demostracion` (ya
   aprobada) el día anterior y una hora antes.
5. Si Meta cambia alguna a otra categoría o la rechaza, el motivo aparece en
   Ajustes → Plantillas.
