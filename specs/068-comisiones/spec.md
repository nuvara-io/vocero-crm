# 068 — Comisiones del equipo comercial (fork de núvara)

Fork `nuvara-io/vocero-crm`, rama `nuvara`. Estado: **implementado en local, sin commit**, detrás de la bandera `COMISIONES` (apagada por defecto).

## Problema

A la vendedora se le paga 5 % de comisión si en el mes llega a una base; los
socios hacen demostraciones y cierran, pero no comisionan. Hoy el CRM no sabe
quién comisiona, ni cuánto se cobró de verdad, ni cuánto se le debe a quién:
el único monto es `lead.amount_cents`, que lo escribe a mano la misma persona
que cobraría sobre él.

## Reglas acordadas (2026-11-14)

1. **Venta = primer pago que entra** de un cliente en la plataforma (la
   activación). Una sola venta por cliente; las recargas siguientes no
   comisionan.
2. **Cuenta cuando el pago está confirmado**, no cuando el lead pasa a
   «Ganado». El monto lo pone la plataforma, nunca una persona.
3. **Base mensual, 5 % sobre todo:** si las ventas comisionables de la
   vendedora en el mes (hora Bogotá, por fecha del pago) suman la base o más,
   cobra el 5 % de **todo** lo del mes; si no llega, cobra $0.
4. **Quien no comisiona** (socios) sigue apareciendo en ventas y resultados;
   su comisión es $0.

## A quién se le atribuye la venta

En este orden, y se guarda cuál regla decidió:

1. **Código de la vendedora.** La plataforma ya pide «Tengo un código» al
   activar (`org_billing_profiles.activation_code`). Cada vendedora tiene un
   código propio (ej. `YULI`); si el cliente lo usó, la venta es suya. Esto
   resuelve que el registro no pida teléfono.
2. **Responsable del lead** al momento del pago (`lead.assigned_user_id`),
   buscando el contacto por teléfono o correo como ya hace
   `aplicarAvisoPlataforma`.
3. **Sin atribuir.** Queda en una bandeja «Sin atribuir» y un admin la asigna
   a mano, con motivo obligatorio.

Cambiar la atribución de una venta ya registrada deja rastro (quién, de quién
a quién, motivo, cuándo) y no se puede si el mes ya está aprobado.

## Datos (migración `0028_comisiones.sql`, aditiva)

- **`commission_profile`** — versionado, nunca se edita: un cambio es una fila
  nueva con `valid_from`. Así subir el % en marzo no recalcula enero.
  `organization_id, user_id, comisiona bool, rate_bps (500 = 5 %),
  monthly_base_cents, referral_code (único por org, mayúsculas), valid_from
  date, created_by, created_at`.
- **`sale`** — una fila por cliente que pagó.
  `organization_id, platform_org_id (único: idempotencia), contact_id?,
  lead_id?, amount_cents, currency, paid_at, payment_ref (único),
  referral_code?, attributed_user_id?, attribution_source
  (codigo | responsable | manual), voided_at?, void_reason?`.
- **`sale_attribution_change`** — bitácora append-only de cambios de
  atribución.
- **`sale.adjustment_period` / `adjustment_cents`** — el descuento de un
  pago anulado cuando su mes ya estaba aprobado (en qué mes cae y cuánto).
- **`commission_settlement`** — la liquidación de un mes, congelada. Solo
  existe al aprobar: un mes pendiente se calcula al consultarlo.
  `organization_id, user_id, period ('2026-11'), sales_count,
  sales_total_cents, base_cents, rate_bps, reached bool, adjustment_cents,
  commission_cents, status (aprobada | pagada), approved_by/at,
  paid_by/at, note`.
  Único por `(organization_id, user_id, period)`.

El % y la base que aplican son los del perfil vigente el último día del mes;
quedan copiados en la liquidación. Mientras está `pendiente` se recalcula al
abrirla; `aprobada` ya no cambia.

**Pago anulado** (reverso de Wompi): si el mes no está aprobado, la venta se
marca `voided_at` y sale del cálculo. Si ya está aprobado, se descuenta en la
liquidación del mes siguiente como ajuste negativo con su motivo.

## Cómo llega el pago (plataforma → CRM)

Se amplía `POST /api/bot/plataforma` con el estado `pagado`:

```json
{ "avisos": [{ "estado": "pagado", "platformOrgId": "…", "telefono": "…",
  "email": "…", "codigo": "YULI", "montoCents": 8000000,
  "pagadoEn": "2026-11-14T15:02:00-05:00", "referenciaPago": "wompi_…" }] }
```

Idempotente por `platformOrgId`/`referenciaPago`. Además de crear la `sale`,
hace lo mismo que `activado` hoy (mover a la etapa ganada y archivar).

Lado plataforma (PR aparte en `nuvara-io/platform`): emitir el aviso cuando
`ApplyWalletCreditUseCase` activa la organización (primer crédito
confirmado), por outbox con reintentos, más un barrido nocturno que reenvía
los de los últimos 30 días por si el CRM estuvo caído.

## Pantallas

- **Ajustes → Equipo:** por persona, «Comisiona», «%», «Base mensual» y
  «Código», con historial de cambios. Solo dueño/admin.
- **Comisiones** (nueva, dueño/admin): selector de mes; tabla por persona
  con ventas, total, base, «Llegó / Le faltan $X», comisión y estado;
  acciones «Aprobar», «Marcar pagada» y «Exportar» (CSV). Detalle de ventas
  por persona y bandeja «Sin atribuir».
- **Vista de la vendedora:** solo lo suyo — «Llevas $X de $base este mes,
  te faltan $Y», ventas del mes y comisiones pasadas con su estado.

## Fuera de alcance

Recargas, tramos o porcentajes escalonados, varias monedas, comisión
compartida entre dos personas.

## Por confirmar antes de construir

1. **Valor de la base** (en pesos) y si es igual para todas.
2. **¿El 5 % va sobre el pago con IVA o antes de IVA?** La recarga de 80.000
   incluye o no IVA según cómo la cobre la plataforma: hay que mirarlo.
3. **Ventas anteriores al lanzamiento:** ¿se cargan las de noviembre o
   arranca desde cero?
4. **Códigos:** ¿uno por vendedora, lo eligen ustedes (ej. `YULI`)? ¿Los
   socios también tienen código (para medir, sin comisión)?

## Implementación

- Regla pura: `src/lib/comisiones.ts` (pruebas en `tests/unit/comisiones.test.ts`).
- Servidor: `src/server/comisiones/` (`flag.ts`, `perfiles.ts`, `ventas.ts`,
  `liquidaciones.ts`); la búsqueda de contactos se extrajo a
  `buscarContactosPlataforma` en `src/server/bot/plataforma.ts`.
- Rutas: `GET /api/comisiones?periodo=`, `POST /api/comisiones/liquidaciones`
  (aprobar · pagar · reabrir), `GET|POST /api/comisiones/perfiles`,
  `GET|POST /api/comisiones/ventas/[id]/atribucion`,
  `GET /api/comisiones/export?periodo=` (CSV con BOM para Excel).
- Pantallas: `/comisiones` (menú, junto a Resultados) y la tarjeta
  «Condiciones comerciales» en Ajustes → Equipo.
- Reglas de guarda: solo se aprueba un mes terminado; no se reasigna una
  venta de un mes aprobado; no se reabre un mes pagado ni uno cuyo pago
  anulado ya mandó su descuento a otro mes; un código no puede ser de dos
  personas.

## Verificación (2026-11-14)

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` (1.490 pruebas).
- En vivo contra `pnpm dev` + Postgres local con `COMISIONES=on`: perfiles,
  avisos `pagado` (por código, por responsable, sin atribuir, repetido sin
  duplicar), asignar desde «Sin atribuir», aprobar octubre, `anulado` con
  descuento en noviembre ($8.000 − $1.500), los cuatro bloqueos, CSV,
  cambio programado en Equipo y vista de teléfono.
- Sin probar: la vista de una vendedora con su propia sesión (el filtro es
  `soloUserId` en el servidor) y el envío real desde la plataforma (falta la
  PR del lado de `nuvara-io/platform`).

## Verificación prevista (original)

- Pruebas unitarias de la regla pura (`src/lib/comisiones.ts`): bajo la base
  = $0, justo en la base, sobre la base, socio = $0, cambio de % a mitad de
  año, anulación antes y después de aprobar.
- Ruta `pagado`: idempotente, atribución por código > responsable > sin
  atribuir.
- En vivo contra `pnpm dev`: perfil, aviso de pago simulado, liquidación,
  aprobar, exportar.
