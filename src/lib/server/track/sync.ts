import { applyEvent, EngineError, type RaceState } from "../../track-engine/core";
import type { TrackContext } from "./auth";
import { ENGINE_VERSION, materializeState, replayRace } from "./engine-io";
import { envelopeSchema, isSupportedType, toEngineEvent, type Envelope } from "./schemas";

export type SyncRejection = { client_event_id: string | null; code: string; message: string };

export interface SyncResult {
  accepted: string[];
  duplicates: string[];
  rejected: SyncRejection[];
  /** Siguiente device_seq que el servidor espera de este dispositivo. */
  next_expected_seq: number;
}

export class SyncError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

/** Dispositivo activo de la carrera (como máximo uno). */
export async function getActiveDevice(ctx: TrackContext) {
  const { data } = await ctx.admin
    .from("track_race_devices")
    .select("id, device_id, judge_id, activated_at, last_synced_at, takeover_note")
    .eq("event_id", ctx.race.id)
    .eq("is_active", true)
    .maybeSingle();
  return data as { id: string; device_id: string; judge_id: string | null; activated_at: string; last_synced_at: string | null; takeover_note: string | null } | null;
}

export async function lastDeviceSeq(ctx: TrackContext, deviceId: string): Promise<number> {
  const { data } = await ctx.admin
    .from("track_events")
    .select("device_seq")
    .eq("event_id", ctx.race.id)
    .eq("device_id", deviceId)
    .order("device_seq", { ascending: false })
    .limit(1);
  return (data?.[0]?.device_seq as number | undefined) ?? 0;
}

/**
 * Procesa un lote de eventos del dispositivo activo.
 *  - Idempotente: un client_event_id ya recibido se responde como duplicado y no se vuelve a aplicar.
 *  - Ordenado: se aplican por device_seq; un hueco rechaza el resto del lote con SEQUENCE_GAP hasta que se reenvíe.
 *  - Cada evento lo valida y aplica el motor compartido con Timer_track; si viola una regla se guarda como rechazado
 *    (queda en el historial) con el mismo código que usa la app.
 */
export async function processSync(ctx: TrackContext, deviceId: string, rawEvents: unknown[]): Promise<SyncResult> {
  const { admin, race } = ctx;
  if (!["approved", "in_progress"].includes(race.status)) {
    throw new SyncError("RACE_NOT_OPEN", `La carrera no admite eventos en estado ${race.status}`, 409);
  }

  const result: SyncResult = { accepted: [], duplicates: [], rejected: [], next_expected_seq: 1 };
  const active = await getActiveDevice(ctx);
  let lastSeq = await lastDeviceSeq(ctx, deviceId);
  result.next_expected_seq = lastSeq + 1;

  // Un dispositivo que no es el activo no puede enviar: sus eventos se rechazan (solo se recuperan con un respaldo).
  if (!active || active.device_id !== deviceId) {
    for (const raw of rawEvents) {
      const id = typeof (raw as { client_event_id?: unknown })?.client_event_id === "string" ? (raw as { client_event_id: string }).client_event_id : null;
      result.rejected.push({ client_event_id: id, code: "DEVICE_NOT_ACTIVE", message: "Este dispositivo no es el activo de la carrera. Actívalo primero." });
    }
    return result;
  }

  // 1) Sobres válidos, ordenados por device_seq y sin repetidos dentro del lote.
  const envelopes: Envelope[] = [];
  const seenInBatch = new Set<string>();
  for (const raw of rawEvents) {
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      const id = typeof (raw as { client_event_id?: unknown })?.client_event_id === "string" ? (raw as { client_event_id: string }).client_event_id : null;
      result.rejected.push({ client_event_id: id, code: "INVALID_PAYLOAD", message: parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    if (seenInBatch.has(parsed.data.client_event_id)) { result.duplicates.push(parsed.data.client_event_id); continue; }
    seenInBatch.add(parsed.data.client_event_id);
    envelopes.push(parsed.data);
  }
  envelopes.sort((a, b) => a.device_seq - b.device_seq);

  // 2) Duplicados contra lo ya recibido (de cualquier estado).
  const knownIds = new Set<string>();
  if (envelopes.length) {
    const { data: known } = await admin.from("track_events").select("client_event_id").in("client_event_id", envelopes.map((e) => e.client_event_id));
    (known ?? []).forEach((k) => knownIds.add(k.client_event_id as string));
  }

  // 3) Estado actual reconstruido con el motor.
  const { state: initial } = await replayRace(admin, race.id);
  let state: RaceState = initial;

  const rows: Record<string, unknown>[] = [];
  let gap = false;
  let acceptedAny = false;
  let raceStarted = false;
  const rowBase = { tenant_id: race.tenant_id, event_id: race.id, device_id: deviceId, judge_id: ctx.userId, engine_version: ENGINE_VERSION };

  for (const env of envelopes) {
    if (knownIds.has(env.client_event_id)) { result.duplicates.push(env.client_event_id); continue; }
    if (gap || env.device_seq !== lastSeq + 1) {
      gap = true;
      result.rejected.push({ client_event_id: env.client_event_id, code: "SEQUENCE_GAP", message: `Se esperaba device_seq ${lastSeq + 1} y llegó ${env.device_seq}. Reenvía desde ${lastSeq + 1}.` });
      continue;
    }
    const base = { ...rowBase, client_event_id: env.client_event_id, device_seq: env.device_seq, type: env.type, payload: env.payload, occurred_at: env.occurred_at };

    const reject = (code: string, message: string) => {
      rows.push({ ...base, processing_status: "rejected", rejection_code: code, rejection_message: message });
      result.rejected.push({ client_event_id: env.client_event_id, code, message });
      lastSeq = env.device_seq;
    };

    if (!isSupportedType(env.type)) { reject("UNSUPPORTED_EVENT_TYPE", `El servidor aún no admite el evento ${env.type}.`); continue; }
    const engineEvent = toEngineEvent(env);
    if (!engineEvent.ok) { reject("INVALID_PAYLOAD", engineEvent.message); continue; }

    try {
      state = applyEvent(state, engineEvent.event);
    } catch (e) {
      if (e instanceof EngineError) { reject(e.code, e.message); continue; }
      throw e;
    }
    rows.push({ ...base, processing_status: "accepted" });
    result.accepted.push(env.client_event_id);
    acceptedAny = true;
    if (env.type === "RACE_STARTED") raceStarted = true;
    lastSeq = env.device_seq;
  }

  // 4) Historial: se guarda todo lo procesado (aceptado o rechazado). Dos sincronizaciones simultáneas chocan en la
  //    restricción única (evento/dispositivo/secuencia): se pide reintentar.
  if (rows.length) {
    const { error } = await admin.from("track_events").insert(rows);
    if (error) {
      if (error.code === "23505") throw new SyncError("CONCURRENT_SYNC", "Otra sincronización de este dispositivo está en curso. Reintenta.", 409);
      throw new Error(`No se pudo guardar el historial: ${error.message}`);
    }
  }

  // 5) Estado consolidado en las tablas.
  if (acceptedAny) {
    await materializeState(admin, race, state, ctx.userId);
    if (raceStarted && race.status === "approved") await admin.from("events").update({ status: "in_progress" }).eq("id", race.id);
  }
  await admin.from("track_race_devices").update({ last_synced_at: new Date().toISOString() }).eq("id", active.id);

  result.next_expected_seq = lastSeq + 1;
  return result;
}

/** Activa un dispositivo para la carrera. Reemplazar a otro activo exige una observación. */
export async function activateDevice(ctx: TrackContext, deviceId: string, takeoverNote: string | undefined) {
  const { admin, race } = ctx;
  const active = await getActiveDevice(ctx);

  if (active && active.device_id === deviceId) {
    return { device_id: deviceId, activated_at: active.activated_at, last_device_seq: await lastDeviceSeq(ctx, deviceId), replaced_device_id: null as string | null };
  }

  if (active) {
    if (!takeoverNote || takeoverNote.length < 3) {
      throw new SyncError("DEVICE_ALREADY_ACTIVE", "Hay otro dispositivo activo en esta carrera. Para reemplazarlo escribe una observación.", 409);
    }
    const { error } = await admin.from("track_race_devices").update({ is_active: false, deactivated_at: new Date().toISOString() }).eq("id", active.id);
    if (error) throw new Error(error.message);
  }

  const { data, error } = await admin
    .from("track_race_devices")
    .insert({ tenant_id: race.tenant_id, event_id: race.id, device_id: deviceId, judge_id: ctx.userId, is_active: true, takeover_note: active ? takeoverNote : null })
    .select("activated_at")
    .single();
  if (error || !data) throw new SyncError("CONCURRENT_ACTIVATION", "No se pudo activar el dispositivo (¿otra activación a la vez?). Reintenta.", 409);
  return { device_id: deviceId, activated_at: data.activated_at as string, last_device_seq: await lastDeviceSeq(ctx, deviceId), replaced_device_id: active?.device_id ?? null };
}
