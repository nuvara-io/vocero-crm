import { asc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { elegirResponsable } from "@/lib/crm-reglas";
import {
  ETAPAS_PROSPECCION,
  pideBaja,
  type CanalPermiso,
  type FilaProspecto,
} from "@/lib/prospeccion";
import { ajustesCrm } from "@/server/crm-ajustes";
import { publish } from "@/server/events/bus";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { moveLeadToStage } from "@/server/leads/stage-history";

/**
 * 072 — Prospección por WhatsApp: importar la lista de firmas, registrar el
 * permiso o la baja, y llevar a cada prospecto por sus etapas. Las reglas de
 * envío (permiso, horario, tope) viven en `sendTemplate`.
 */

type Stage = typeof schema.pipelineStage.$inferSelect;

/**
 * Las tres etapas de prospección, al principio del pipeline. Re-ejecutable:
 * si ya existen (por nombre), no las duplica.
 */
export async function asegurarEtapasDeProspeccion(organizationId: string): Promise<Map<string, Stage>> {
  const db = getDb();
  const actuales = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const porNombre = new Map(actuales.map((s) => [s.name.trim().toLowerCase(), s]));
  const faltan = ETAPAS_PROSPECCION.filter((n) => !porNombre.has(n.toLowerCase()));
  if (faltan.length > 0) {
    await db.transaction(async (tx) => {
      // Corre las demás hacia abajo y pone las de prospección primero.
      for (const s of actuales) {
        await tx
          .update(schema.pipelineStage)
          .set({ position: s.position + faltan.length })
          .where(eq(schema.pipelineStage.id, s.id));
      }
      let pos = 0;
      for (const nombre of ETAPAS_PROSPECCION) {
        if (porNombre.has(nombre.toLowerCase())) continue;
        await tx.insert(schema.pipelineStage).values({
          id: newId("stage"),
          organizationId,
          name: nombre,
          position: pos++,
          kind: "open",
        });
      }
    });
  }
  const todas = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId));
  return new Map(todas.map((s) => [s.name.trim().toLowerCase(), s]));
}

export type ResultadoImportacion = {
  creados: number;
  yaEnCrm: { nombre: string; telefono: string; etapa: string | null }[];
};

/**
 * Importa prospectos. Quien ya existe en el CRM (por número) NO se toca: se
 * reporta como «ya en el CRM», porque ya hay relación y se trabaja distinto.
 * Los nuevos entran con el agente apagado (el primer mensaje lo escribe una
 * persona, con permiso), su ficha, su lead en «Prospecto» y responsable según
 * Ajustes → Reparto.
 */
export async function importarProspectos(
  organizationId: string,
  lista: string,
  filas: FilaProspecto[]
): Promise<ResultadoImportacion> {
  const db = getDb();
  const etapas = await asegurarEtapasDeProspeccion(organizationId);
  const prospecto = etapas.get("prospecto")!;
  const telefonos = filas.map((f) => f.telefono);
  const existentes = telefonos.length
    ? await db
        .select({
          id: schema.contact.id,
          waIdentity: schema.contact.waIdentity,
          phone: schema.contact.phone,
          name: schema.contact.name,
          stageName: schema.pipelineStage.name,
        })
        .from(schema.contact)
        .leftJoin(schema.lead, eq(schema.lead.contactId, schema.contact.id))
        .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            or(
              inArray(schema.contact.waIdentity, telefonos),
              inArray(sql`regexp_replace(coalesce(${schema.contact.phone}, ''), '\\D', '', 'g')`, telefonos)
            )
          )
        )
    : [];
  const yaEstan = new Map<string, (typeof existentes)[number]>();
  for (const e of existentes) {
    yaEstan.set(e.waIdentity, e);
    if (e.phone) yaEstan.set(e.phone.replace(/\D/g, ""), e);
  }

  const { responsable } = await ajustesCrm(organizationId);
  const miembros = new Set(
    (
      await db
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(eq(schema.member.organizationId, organizationId))
    ).map((m) => m.userId)
  );
  let ultimo: string | null = null;

  const resultado: ResultadoImportacion = { creados: 0, yaEnCrm: [] };
  for (const f of filas) {
    const ya = yaEstan.get(f.telefono);
    if (ya) {
      resultado.yaEnCrm.push({ nombre: f.nombre, telefono: f.telefono, etapa: ya.stageName });
      continue;
    }
    const contactId = newId("contact");
    const insertados = await db
      .insert(schema.contact)
      .values({
        id: contactId,
        organizationId,
        waIdentity: f.telefono,
        phone: f.telefono,
        name: f.nombre,
        nameSource: "manual",
        ficha: { ...f.ficha, origen: "prospeccion", lista },
        prospectList: lista,
        aiPaused: true,
      })
      .onConflictDoNothing()
      .returning({ id: schema.contact.id });
    if (!insertados[0]) {
      resultado.yaEnCrm.push({ nombre: f.nombre, telefono: f.telefono, etapa: null });
      continue;
    }
    const asignado = elegirResponsable(responsable, miembros, ultimo);
    await createLeadForContact({
      organizationId,
      contactId,
      stageId: prospecto.id,
      source: "dueno",
      assignedUserId: asignado,
    });
    if (asignado) ultimo = asignado;
    resultado.creados++;
  }
  return resultado;
}

async function leadDe(organizationId: string, contactId: string) {
  const rows = await getDb()
    .select({ id: schema.lead.id, stageId: schema.lead.stageId })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId)))
    .limit(1);
  return rows[0] ?? null;
}

async function moverA(
  organizationId: string,
  contactId: string,
  nombreEtapa: string,
  actorUserId: string | null,
  extra: { lossReason?: "permiso_no" | "baja"; lossNote?: string } = {}
) {
  const etapas = await asegurarEtapasDeProspeccion(organizationId);
  const lead = await leadDe(organizationId, contactId);
  if (!lead) return;
  const destino =
    nombreEtapa === "__perdido__"
      ? [...etapas.values()].find((s) => s.kind === "lost")
      : etapas.get(nombreEtapa.toLowerCase());
  if (!destino || destino.id === lead.stageId) return;
  await moveLeadToStage({
    organizationId,
    leadId: lead.id,
    toStageId: destino.id,
    actorUserId,
    source: actorUserId ? "dueno" : "sistema",
    lossReason: extra.lossReason ?? null,
    lossNote: extra.lossNote ?? null,
  });
}

export type AccionProspecto =
  | { accion: "permiso_pedido" }
  | { accion: "permiso_si"; canal: CanalPermiso; texto: string; fecha?: Date }
  | { accion: "permiso_no"; nota?: string | null }
  | { accion: "baja"; nota?: string | null };

/** Lo que hace quien llama a la firma, desde la pantalla de Prospección. */
export async function registrarAccion(
  organizationId: string,
  actorUserId: string,
  contactId: string,
  a: AccionProspecto
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  const c = rows[0];
  if (!c || !c.prospectList) return { ok: false, status: 404, message: "No es un prospecto de la lista" };
  const ahora = new Date();
  const set = (v: Partial<typeof schema.contact.$inferInsert>) =>
    db
      .update(schema.contact)
      .set({ ...v, updatedAt: ahora })
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)));

  if (a.accion === "permiso_pedido") {
    if (c.doNotContactAt) return { ok: false, status: 409, message: "Está en la lista de supresión" };
    await set({ permissionRequestedAt: ahora });
    await moverA(organizationId, contactId, "Permiso pedido", actorUserId);
  } else if (a.accion === "permiso_si") {
    if (c.doNotContactAt) return { ok: false, status: 409, message: "Está en la lista de supresión" };
    await set({
      permissionRequestedAt: c.permissionRequestedAt ?? ahora,
      consentAt: a.fecha ?? ahora,
      consentChannel: a.canal,
      consentText: a.texto.trim().slice(0, 1000),
      consentBy: actorUserId,
    });
    await moverA(organizationId, contactId, "Permiso sí", actorUserId);
  } else {
    await set({
      doNotContactAt: ahora,
      doNotContactReason: a.accion === "baja" ? "pidio_baja" : "permiso_no",
    });
    await moverA(organizationId, contactId, "__perdido__", actorUserId, {
      lossReason: a.accion,
      lossNote: a.nota?.trim() || (a.accion === "baja" ? "Pidió la baja" : "No dio permiso para escribirle"),
    });
  }
  return { ok: true };
}

/**
 * Al recibir un mensaje de un prospecto: si pide la baja (o toca «No me
 * interesa»), queda en la lista de supresión y pasa a Perdido; si no, y aún
 * estaba en una etapa de prospección, pasa a «En conversación». Nunca tumba
 * la ingesta.
 */
export async function alRecibirDeProspecto(
  organizationId: string,
  contactId: string,
  texto: string | null
): Promise<void> {
  try {
    const db = getDb();
    const rows = await db
      .select({ prospectList: schema.contact.prospectList, doNotContactAt: schema.contact.doNotContactAt })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
      .limit(1);
    const c = rows[0];
    if (!c?.prospectList) return;
    if (pideBaja(texto)) {
      if (!c.doNotContactAt) {
        await db
          .update(schema.contact)
          .set({ doNotContactAt: new Date(), doNotContactReason: "pidio_baja", updatedAt: new Date() })
          .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)));
        await moverA(organizationId, contactId, "__perdido__", null, {
          lossReason: "baja",
          lossNote: `Pidió la baja por WhatsApp: «${(texto ?? "").slice(0, 120)}»`,
        });
      }
      return;
    }
    const etapas = await asegurarEtapasDeProspeccion(organizationId);
    const lead = await leadDe(organizationId, contactId);
    if (!lead) return;
    const enProspeccion = ETAPAS_PROSPECCION.some((n) => etapas.get(n.toLowerCase())?.id === lead.stageId);
    if (!enProspeccion) return;
    const destino =
      etapas.get("en conversación") ??
      [...etapas.values()]
        .filter((s) => s.kind === "open" && !ETAPAS_PROSPECCION.some((n) => n.toLowerCase() === s.name.toLowerCase()))
        .sort((a, b) => a.position - b.position)[0];
    if (destino) {
      await moveLeadToStage({ organizationId, leadId: lead.id, toStageId: destino.id, source: "sistema" });
    }
  } catch (err) {
    console.warn("[prospeccion] no se procesó la respuesta:", err instanceof Error ? err.message : err);
  }
}

export type ProspectoDto = {
  contactId: string;
  conversationId: string | null;
  nombre: string;
  telefono: string | null;
  lista: string;
  etapa: string | null;
  responsable: string | null;
  ficha: Record<string, unknown>;
  permisoPedido: string | null;
  permiso: { fecha: string; canal: string | null; texto: string | null } | null;
  primerContacto: string | null;
  suprimido: string | null;
  respondio: boolean;
  demo: boolean;
};

export async function listarProspectos(organizationId: string): Promise<{
  prospectos: ProspectoDto[];
  embudo: Record<string, number>;
}> {
  const db = getDb();
  const rows = await db
    .select({
      c: schema.contact,
      etapa: schema.pipelineStage.name,
      responsable: schema.user.name,
      conversationId: sql<string | null>`(select cv.id from conversation cv where cv.contact_id = ${schema.contact.id} order by cv.created_at limit 1)`,
      respondio: sql<boolean>`exists(select 1 from conversation cv where cv.contact_id = ${schema.contact.id} and cv.last_inbound_at is not null)`,
      demo: sql<boolean>`exists(select 1 from booking b where b.contact_id = ${schema.contact.id} and b.status in ('agendada','realizada') and b.is_test = false)`,
    })
    .from(schema.contact)
    .leftJoin(schema.lead, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .leftJoin(schema.user, eq(schema.user.id, schema.lead.assignedUserId))
    .where(scoped(schema.contact.organizationId, organizationId, isNotNull(schema.contact.prospectList)));

  const prospectos: ProspectoDto[] = rows.map((r) => ({
    contactId: r.c.id,
    conversationId: r.conversationId,
    nombre: r.c.name,
    telefono: r.c.phone,
    lista: r.c.prospectList ?? "",
    etapa: r.etapa,
    responsable: r.responsable,
    ficha: (r.c.ficha as Record<string, unknown> | null) ?? {},
    permisoPedido: r.c.permissionRequestedAt?.toISOString() ?? null,
    permiso: r.c.consentAt
      ? { fecha: r.c.consentAt.toISOString(), canal: r.c.consentChannel, texto: r.c.consentText }
      : null,
    primerContacto: r.c.firstContactAt?.toISOString() ?? null,
    suprimido: r.c.doNotContactAt?.toISOString() ?? null,
    respondio: Boolean(r.respondio),
    demo: Boolean(r.demo),
  }));

  const n = (f: (p: ProspectoDto) => boolean) => prospectos.filter(f).length;
  const embudo = {
    firmas: prospectos.length,
    permisosPedidos: n((p) => Boolean(p.permisoPedido || p.permiso)),
    permisosSi: n((p) => Boolean(p.permiso)),
    contactados: n((p) => Boolean(p.primerContacto)),
    respondieron: n((p) => p.respondio),
    demos: n((p) => p.demo),
    bajas: n((p) => Boolean(p.suprimido)),
    bajasDeContactados: n((p) => Boolean(p.suprimido && p.primerContacto)),
  };
  return { prospectos, embudo };
}

/** Prospectos a quienes hoy (desde `desde`) se les escribió por primera vez. */
export async function contactadosDesde(organizationId: string, desde: Date): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        isNotNull(schema.contact.prospectList),
        gt(schema.contact.firstContactAt, desde)
      )
    );
  return rows[0]?.n ?? 0;
}

export function avisarCambio(organizationId: string, conversationId: string | null) {
  if (conversationId) {
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
  }
}

