import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ENGINE_VERSION, SUPPORTED_EVENT_TYPES, replay, stageRanking, lanesOf,
  type RaceConfig, type RaceState, type TrackEvent,
} from "../../track-engine/core";

export { ENGINE_VERSION, SUPPORTED_EVENT_TYPES };

export interface AthleteName { bib: string; name: string; categoryId: string }

/**
 * Arma la configuración de la carrera para el motor desde las tablas de fedocr: categorías con sus instancias,
 * los inscritos CON PAGO CONFIRMADO Y DORSAL, y las parejas iniciales (instancia 1, salida 1).
 */
export async function loadRaceConfig(admin: SupabaseClient, eventId: string): Promise<{ config: RaceConfig; names: Map<string, AthleteName> }> {
  const [{ data: cats }, { data: stages }, { data: regs }, { data: initial }] = await Promise.all([
    admin.from("event_categories").select("id, name").eq("event_id", eventId).order("name"),
    admin.from("track_stages").select("id, category_id, stage_number, name, runs_per_athlete, qualifiers_count").eq("event_id", eventId).order("stage_number"),
    admin.from("registrations").select("id, bib_number, athlete_name, category_id").eq("event_id", eventId).eq("status", "paid").not("bib_number", "is", null).order("bib_number"),
    admin.from("track_initial_heats").select("id, stage_id, heat_number, left_registration_id, right_registration_id").eq("event_id", eventId).order("heat_number"),
  ]);

  const names = new Map<string, AthleteName>();
  (regs ?? []).forEach((r) => names.set(r.id as string, { bib: r.bib_number as string, name: (r.athlete_name as string | null) ?? "", categoryId: r.category_id as string }));

  const categories = (cats ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      stages: (stages ?? [])
        .filter((s) => s.category_id === c.id)
        .map((s) => ({
          id: s.id as string,
          stageNumber: s.stage_number as number,
          name: s.name as string,
          runsPerAthlete: s.runs_per_athlete as number,
          qualifiersCount: (s.qualifiers_count as number | null) ?? null,
        })),
      athletes: (regs ?? [])
        .filter((r) => r.category_id === c.id)
        .map((r) => ({ registrationId: r.id as string, bib: r.bib_number as string, name: (r.athlete_name as string | null) ?? "" })),
    }))
    .filter((c) => c.stages.length > 0);

  const config: RaceConfig = {
    raceId: eventId,
    categories,
    initialHeats: (initial ?? []).map((h) => ({
      id: h.id as string,
      stageId: h.stage_id as string,
      runNumber: 1,
      heatNumber: h.heat_number as number,
      left: h.left_registration_id as string,
      right: (h.right_registration_id as string | null) ?? null,
    })),
  };
  return { config, names };
}

/** Eventos ACEPTADOS de la carrera en el orden en que se recibieron (dentro de un lote, por device_seq). */
export async function loadAcceptedEvents(admin: SupabaseClient, eventId: string): Promise<TrackEvent[]> {
  const { data } = await admin
    .from("track_events")
    .select("client_event_id, device_seq, type, payload, occurred_at, received_at")
    .eq("event_id", eventId)
    .eq("processing_status", "accepted")
    .order("received_at", { ascending: true })
    .order("device_seq", { ascending: true });
  return (data ?? []).map((r) => ({
    clientEventId: r.client_event_id as string,
    deviceSeq: r.device_seq as number,
    occurredAt: new Date(r.occurred_at as string).toISOString(),
    type: r.type,
    payload: r.payload,
  })) as TrackEvent[];
}

export async function replayRace(admin: SupabaseClient, eventId: string) {
  const { config, names } = await loadRaceConfig(admin, eventId);
  const events = await loadAcceptedEvents(admin, eventId);
  const { state, rejected } = replay(config, events);
  return { config, names, events, state, replayRejected: rejected };
}

/** Estado consolidado en JSON (snake_case) para el paquete y para /state. */
export function stateToJson(state: RaceState, names: Map<string, AthleteName>) {
  const who = (registrationId: string) => ({ registration_id: registrationId, bib: names.get(registrationId)?.bib ?? null, name: names.get(registrationId)?.name ?? null });
  return {
    started: state.started,
    finished: state.finished,
    active_heat_id: state.activeHeatId,
    warnings: state.warnings,
    stages: Object.values(state.stages).map((s) => ({
      id: s.id,
      category_id: s.categoryId,
      stage_number: s.stageNumber,
      name: s.name,
      runs_per_athlete: s.runsPerAthlete,
      qualifiers_count: s.qualifiersCount,
      status: s.status,
      ranking: stageRanking(state, s.id).map((r) => ({
        ...who(r.registrationId),
        position: r.position,
        best_time_ms: r.bestMs,
        withdrawn: r.withdrawn,
        tied_with_previous: r.tiedWithPrevious,
        runs: r.runs,
      })),
    })),
    heats: state.heatOrder.map((id) => {
      const h = state.heats[id]!;
      const lane = (side: "left" | "right") => {
        const l = h.lanes[side];
        return l ? { ...who(l.registrationId), outcome: l.outcome, elapsed_ms: l.elapsedMs, arrival_order: l.arrivalOrder } : null;
      };
      return {
        id: h.id,
        category_id: h.categoryId,
        stage_id: h.stageId,
        run_number: h.runNumber,
        heat_number: h.heatNumber,
        status: h.status,
        pairing_source: h.pairingSource,
        started_at_ms: h.startedAtMs,
        left: lane("left"),
        right: lane("right"),
        notes: h.notes,
      };
    }),
    withdrawals: Object.values(state.withdrawals).map((w) => ({ ...who(w.registrationId), stage_id: w.stageId, heat_id: w.heatId, reason: w.reason, note: w.note, at: w.at })),
  };
}

/**
 * Refleja el estado del motor en las tablas (lo leen el panel y la vista pública). El historial de eventos es la fuente
 * de verdad: esto se puede reconstruir en cualquier momento con replayRace().
 */
export async function materializeState(
  admin: SupabaseClient,
  race: { id: string; tenant_id: string },
  state: RaceState,
  judgeId: string | null,
): Promise<void> {
  const base = { tenant_id: race.tenant_id, event_id: race.id };

  for (const stage of Object.values(state.stages)) {
    await admin.from("track_stages").update({ status: stage.status, closed_at: stage.status === "closed" ? new Date().toISOString() : null }).eq("id", stage.id);
    const ranking = stageRanking(state, stage.id);
    if (ranking.length) {
      await admin.from("track_stage_entries").upsert(
        ranking.map((r) => ({
          ...base, stage_id: stage.id, registration_id: r.registrationId,
          status: r.withdrawn ? "withdrawn" : "active", best_time_ms: r.bestMs, rank: r.position,
        })),
        { onConflict: "stage_id,registration_id" },
      );
    }
  }

  // Oleadas y carriles: se reconstruyen completos (decenas de filas por carrera).
  await admin.from("track_heats").delete().eq("event_id", race.id);
  const heats = state.heatOrder.map((id) => state.heats[id]!);
  if (heats.length) {
    const { error } = await admin.from("track_heats").insert(
      heats.map((h) => ({
        id: h.id, ...base, stage_id: h.stageId, run_number: h.runNumber, heat_number: h.heatNumber,
        pairing_source: h.pairingSource, status: h.status,
        started_at: h.startedAtMs != null ? new Date(h.startedAtMs).toISOString() : null,
        judge_id: judgeId,
        review_note: h.notes.filter((n) => n.kind === "review").map((n) => n.text).join(" | ") || null,
      })),
    );
    if (error) throw new Error(`No se pudieron guardar las oleadas: ${error.message}`);
    const lanes = heats.flatMap((h) =>
      (["left", "right"] as const).flatMap((side) => {
        const l = h.lanes[side];
        if (!l) return [];
        return [{
          ...base, heat_id: h.id, lane: side, registration_id: l.registrationId, arrival_order: l.arrivalOrder,
          elapsed_ms: l.elapsedMs, outcome: l.outcome,
          finish_at: h.startedAtMs != null && l.elapsedMs != null ? new Date(h.startedAtMs + l.elapsedMs).toISOString() : null,
        }];
      }),
    );
    if (lanes.length) {
      const { error: laneErr } = await admin.from("track_heat_lanes").insert(lanes);
      if (laneErr) throw new Error(`No se pudieron guardar los carriles: ${laneErr.message}`);
    }
  }

  const withdrawals = Object.values(state.withdrawals);
  if (withdrawals.length) {
    await admin.from("track_withdrawals").upsert(
      withdrawals.map((w) => ({
        ...base, stage_id: w.stageId, heat_id: w.heatId, registration_id: w.registrationId, reason: w.reason, note: w.note,
        judge_id: judgeId, occurred_at: w.at,
      })),
      { onConflict: "event_id,registration_id" },
    );
  }
}

export { lanesOf };
