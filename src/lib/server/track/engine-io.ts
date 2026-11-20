import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ENGINE_VERSION, SUPPORTED_EVENT_TYPES, replay, stageRanking, stageFinalOrder, cutTie, lanesOf,
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
      // Oficiales solo con la instancia cerrada; mientras esté abierta, la posición del ranking es provisional.
      final_order: s.finalOrder ? s.finalOrder.map(who) : null,
      qualified: s.qualified ? s.qualified.map(who) : null,
      cut_tie: s.status === "open" ? (cutTie(state, s.id) ?? []).map(who) : [],
      voided_runs: s.voidedRuns,
      rain_actions: s.rainActions.map((a) => ({ kind: a.kind, run_number: a.runNumber, note: a.note, at: a.at })),
      tie_decisions: s.tieDecisions.map((d) => ({
        resolution: d.resolution, tiebreak_id: d.tiebreakId, registration_ids: d.registrationIds.map(who), order: d.order.map(who), note: d.note, at: d.at,
      })),
      promotions: s.promotions.map((p) => ({ promoted: who(p.promoted), replaced: who(p.replaced), at: p.at })),
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
        // En una oleada anulada por lluvia el tiempo original se conserva, pero no cuenta: se informa como 'voided'.
        return l ? { ...who(l.registrationId), outcome: h.status === "voided" ? "voided" : l.outcome, elapsed_ms: l.elapsedMs, arrival_order: l.arrivalOrder } : null;
      };
      return {
        id: h.id,
        category_id: h.categoryId,
        stage_id: h.stageId,
        kind: h.kind,
        tiebreak_id: h.tiebreakId,
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
    tiebreaks: Object.values(state.tiebreaks).map((t) => ({
      id: t.id, stage_id: t.stageId, registration_ids: t.registrationIds.map(who), heat_ids: t.heatIds, note: t.note, at: t.at, decided: t.decided,
    })),
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

  // Participantes por instancia: se reconstruyen completos (suben atletas por retiros de clasificados).
  await admin.from("track_stage_entries").delete().eq("event_id", race.id);
  const entryRows: Record<string, unknown>[] = [];
  for (const stage of Object.values(state.stages)) {
    await admin.from("track_stages").update({ status: stage.status, closed_at: stage.status === "closed" ? new Date().toISOString() : null }).eq("id", stage.id);
    const ranking = stageRanking(state, stage.id);
    // Cerrada: orden final y clasificados oficiales. Abierta: posición provisional.
    const finalPos = new Map((stage.finalOrder ?? []).map((id, i) => [id, i + 1]));
    const qualified = new Set(stage.qualified ?? []);
    for (const r of ranking) {
      const official = stage.status === "closed";
      entryRows.push({
        ...base, stage_id: stage.id, registration_id: r.registrationId, seed: stage.entries.indexOf(r.registrationId) + 1,
        status: r.withdrawn ? "withdrawn" : official && qualified.has(r.registrationId) ? "qualified" : "active",
        best_time_ms: r.bestMs,
        rank: official && !r.withdrawn && r.position !== null ? (finalPos.get(r.registrationId) ?? r.position) : r.position,
        qualified: official && qualified.has(r.registrationId),
      });
    }
  }
  if (entryRows.length) {
    const { error } = await admin.from("track_stage_entries").insert(entryRows);
    if (error) throw new Error(`No se pudieron guardar los participantes: ${error.message}`);
  }

  // Oleadas y carriles: se reconstruyen completos (decenas de filas por carrera).
  await admin.from("track_heats").delete().eq("event_id", race.id);
  const heats = state.heatOrder.map((id) => state.heats[id]!);
  if (heats.length) {
    const { error } = await admin.from("track_heats").insert(
      heats.map((h) => ({
        id: h.id, ...base, stage_id: h.stageId, run_number: h.runNumber, heat_number: h.heatNumber,
        heat_type: h.kind, tiebreak_id: h.tiebreakId,
        pairing_source: h.pairingSource, status: h.status,
        started_at: h.startedAtMs != null ? new Date(h.startedAtMs).toISOString() : null,
        judge_id: judgeId,
        review_note: h.notes.filter((n) => n.kind === "review" || n.kind === "voided").map((n) => n.text).join(" | ") || null,
      })),
    );
    if (error) throw new Error(`No se pudieron guardar las oleadas: ${error.message}`);
    const lanes = heats.flatMap((h) =>
      (["left", "right"] as const).flatMap((side) => {
        const l = h.lanes[side];
        if (!l) return [];
        return [{
          ...base, heat_id: h.id, lane: side, registration_id: l.registrationId, arrival_order: l.arrivalOrder,
          // Anulada por lluvia: el tiempo original queda guardado y el resultado se marca 'voided'.
          elapsed_ms: l.elapsedMs, outcome: h.status === "voided" ? "voided" : l.outcome,
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

  // Desempates: los iniciados (con o sin decisión) y las decisiones directas del juez. Se reconstruyen completos.
  await admin.from("track_tiebreaks").delete().eq("event_id", race.id);
  const tbRows: Record<string, unknown>[] = [];
  for (const stage of Object.values(state.stages)) {
    const started = Object.values(state.tiebreaks).filter((t) => t.stageId === stage.id);
    for (const t of started) {
      const d = stage.tieDecisions.find((x) => x.tiebreakId === t.id);
      tbRows.push({
        id: t.id, ...base, stage_id: stage.id, tied_registration_ids: t.registrationIds, resolution: d ? "runoff" : null,
        note: d?.note ?? t.note, judge_id: judgeId, decided_at: d?.at ?? null,
      });
    }
    for (const d of stage.tieDecisions.filter((x) => !x.tiebreakId)) {
      tbRows.push({
        id: crypto.randomUUID(), ...base, stage_id: stage.id, tied_registration_ids: d.registrationIds, resolution: "judge_direct", note: d.note, judge_id: judgeId, decided_at: d.at,
      });
    }
  }
  if (tbRows.length) {
    const { error } = await admin.from("track_tiebreaks").insert(tbRows);
    if (error) throw new Error(`No se pudieron guardar los desempates: ${error.message}`);
  }
}

export { lanesOf, stageFinalOrder };
