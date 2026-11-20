import type { PayloadOf, TrackEvent } from './events';
import { currentRun, heatsOfRun, lanesOf } from './selectors';
import { isValidElapsed } from './time';
import type { HeatState, LaneState, RaceConfig, RaceState, StageState } from './types';

export type EngineErrorCode =
  | 'RACE_NOT_STARTED'
  | 'RACE_ALREADY_STARTED'
  | 'STAGE_NOT_FOUND'
  | 'STAGE_NOT_OPEN'
  | 'HEAT_NOT_FOUND'
  | 'INVALID_HEAT_STATE'
  | 'SECOND_ACTIVE_HEAT'
  | 'RUN_NOT_OPEN'
  | 'RUN_CLOSED'
  | 'NO_RUNNERS'
  | 'HEAT_HAS_RUNNERS'
  | 'LANE_EMPTY'
  | 'LANE_NOT_PENDING'
  | 'ATHLETE_NOT_IN_HEAT'
  | 'ATHLETE_NOT_IN_STAGE'
  | 'ATHLETE_WITHDRAWN'
  | 'INVALID_TIME'
  | 'ARRIVAL_ORDER_MISMATCH'
  | 'NOTE_REQUIRED'
  | 'NOTHING_TO_SWAP'
  | 'INVALID_PAIRING'
  | 'NOT_SUPPORTED_YET';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

function fail(code: EngineErrorCode, message: string): never {
  throw new EngineError(code, message);
}

const newLane = (registrationId: string): LaneState => ({
  registrationId,
  outcome: 'pending',
  elapsedMs: null,
  arrivalOrder: null,
});

/** Estado inicial a partir de la configuración descargada de fedocrcol. */
export function createInitialState(config: RaceConfig): RaceState {
  const stages: Record<string, StageState> = {};
  for (const cat of config.categories) {
    [...cat.stages]
      .sort((a, b) => a.stageNumber - b.stageNumber)
      .forEach((s, i) => {
        stages[s.id] = {
          id: s.id,
          categoryId: cat.id,
          stageNumber: s.stageNumber,
          name: s.name,
          runsPerAthlete: s.runsPerAthlete,
          qualifiersCount: s.qualifiersCount,
          // Solo la instancia 1 empieza abierta, con todos los inscritos.
          status: i === 0 ? 'open' : 'pending',
          entries: i === 0 ? cat.athletes.map((a) => a.registrationId) : [],
        };
      });
  }

  const state: RaceState = {
    config,
    started: false,
    finished: false,
    activeHeatId: null,
    stages,
    heats: {},
    heatOrder: [],
    withdrawals: {},
    warnings: [],
  };

  for (const h of config.initialHeats) {
    const stage = stages[h.stageId];
    if (!stage) {
      state.warnings.push(`La oleada ${h.heatNumber} apunta a una instancia que no existe.`);
      continue;
    }
    state.heats[h.id] = {
      id: h.id,
      categoryId: stage.categoryId,
      stageId: h.stageId,
      runNumber: h.runNumber,
      heatNumber: h.heatNumber,
      status: 'pending',
      pairingSource: 'fedocr',
      lanes: { left: newLane(h.left), right: h.right ? newLane(h.right) : null },
      startedAtMs: null,
      notes: [],
    };
    state.heatOrder.push(h.id);
  }

  for (const stage of Object.values(stages)) {
    if (stage.status !== 'open') continue;
    const counts = new Map<string, number>();
    for (const heat of heatsOfRun(state, stage.id, 1))
      for (const lane of lanesOf(heat)) counts.set(lane.registrationId, (counts.get(lane.registrationId) ?? 0) + 1);
    const missing = stage.entries.filter((r) => !counts.has(r)).length;
    const repeated = [...counts.values()].filter((c) => c > 1).length;
    const unknown = [...counts.keys()].filter((r) => !stage.entries.includes(r)).length;
    if (missing) state.warnings.push(`${stage.name}: ${missing} atleta(s) sin oleada en la salida 1.`);
    if (repeated) state.warnings.push(`${stage.name}: ${repeated} atleta(s) repetidos en la salida 1.`);
    if (unknown) state.warnings.push(`${stage.name}: ${unknown} atleta(s) de las oleadas no están inscritos.`);
  }

  return state;
}

function clone(state: RaceState): RaceState {
  const { config, ...rest } = state;
  return { config, ...structuredClone(rest) };
}

function getHeat(state: RaceState, heatId: string): HeatState {
  return state.heats[heatId] ?? fail('HEAT_NOT_FOUND', 'La oleada no existe.');
}

function getOpenStage(state: RaceState, stageId: string): StageState {
  const stage = state.stages[stageId] ?? fail('STAGE_NOT_FOUND', 'La instancia no existe.');
  if (stage.status !== 'open') fail('STAGE_NOT_OPEN', 'La instancia no está abierta.');
  return stage;
}

function requireNote(text: string): string {
  const t = text.trim();
  if (!t) fail('NOTE_REQUIRED', 'La observación es obligatoria.');
  return t;
}

/** Cuando ya no queda nadie corriendo, la oleada pasa a esperar confirmación. */
function settle(heat: HeatState) {
  if (heat.status === 'started' && !lanesOf(heat).some((l) => l.outcome === 'pending')) {
    heat.status = 'awaiting_confirmation';
  }
}

type Handler<T extends TrackEvent['type']> = (s: RaceState, p: PayloadOf<T>, e: TrackEvent) => void;

const handlers: { [T in TrackEvent['type']]: Handler<T> } = {
  RACE_STARTED(s) {
    if (s.started) fail('RACE_ALREADY_STARTED', 'La competencia ya inició.');
    s.started = true;
  },

  PAIRING_SET(s, p) {
    const stage = getOpenStage(s, p.stage_id);
    if (p.run_number > stage.runsPerAthlete) fail('INVALID_PAIRING', 'Esa salida no existe en la instancia.');
    if (p.run_number < currentRun(s, stage.id)) fail('RUN_CLOSED', 'Esa salida ya terminó.');

    // Se reemplazan las oleadas pendientes de la salida; las que ya corrieron se conservan.
    const runHeats = heatsOfRun(s, stage.id, p.run_number);
    const kept = runHeats.filter((h) => h.status !== 'pending');
    for (const h of runHeats) if (h.status === 'pending') delete s.heats[h.id];
    s.heatOrder = s.heatOrder.filter((id) => s.heats[id]);

    const seen = new Set(kept.flatMap((h) => lanesOf(h).map((l) => l.registrationId)));
    const numbers = new Set(kept.map((h) => h.heatNumber));

    for (const d of p.heats) {
      if (s.heats[d.heat_id]) fail('INVALID_PAIRING', 'Identificador de oleada repetido.');
      if (numbers.has(d.heat_number)) fail('INVALID_PAIRING', `El número de oleada ${d.heat_number} está repetido.`);
      numbers.add(d.heat_number);
      for (const reg of [d.left, d.right]) {
        if (!reg) continue;
        if (!stage.entries.includes(reg)) fail('INVALID_PAIRING', 'Un atleta no pertenece a esta instancia.');
        if (s.withdrawals[reg]) fail('ATHLETE_WITHDRAWN', 'Un atleta retirado no puede tener oleada.');
        if (seen.has(reg)) fail('INVALID_PAIRING', 'Un atleta aparece dos veces en la misma salida.');
        seen.add(reg);
      }
      s.heats[d.heat_id] = {
        id: d.heat_id,
        categoryId: stage.categoryId,
        stageId: stage.id,
        runNumber: p.run_number,
        heatNumber: d.heat_number,
        status: 'pending',
        pairingSource: p.source,
        lanes: { left: newLane(d.left), right: d.right ? newLane(d.right) : null },
        startedAtMs: null,
        notes: [],
      };
      s.heatOrder.push(d.heat_id);
    }

    const missing = stage.entries.filter((r) => !s.withdrawals[r] && !seen.has(r));
    if (missing.length) fail('INVALID_PAIRING', `Faltan ${missing.length} atleta(s) por asignar en la salida.`);
  },

  LANES_SWAPPED(s, p) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'pending') fail('INVALID_HEAT_STATE', 'Solo se cambian carriles antes de la salida.');
    heat.lanes = { left: heat.lanes.right, right: heat.lanes.left };
  },

  RUN_SKIPPED(s, p) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'pending') fail('INVALID_HEAT_STATE', 'Solo se marca "no corre" antes de la salida.');
    const lane = lanesOf(heat).find((l) => l.registrationId === p.registration_id);
    if (!lane) fail('ATHLETE_NOT_IN_HEAT', 'El atleta no está en esta oleada.');
    if (lane.outcome === 'withdrawn') fail('ATHLETE_WITHDRAWN', 'El atleta está retirado.');
    lane.outcome = p.skipped ? 'did_not_run' : 'pending';
  },

  HEAT_STARTED(s, p) {
    if (!s.started) fail('RACE_NOT_STARTED', 'Primero hay que iniciar la competencia.');
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'pending') fail('INVALID_HEAT_STATE', 'La oleada ya salió.');
    getOpenStage(s, heat.stageId);
    if (s.activeHeatId) fail('SECOND_ACTIVE_HEAT', 'Ya hay una oleada en la pista. Confírmala primero.');
    if (heat.runNumber !== currentRun(s, heat.stageId))
      fail('RUN_NOT_OPEN', 'Esa salida se habilita cuando terminen todas las oleadas de la salida actual.');
    if (!lanesOf(heat).some((l) => l.outcome === 'pending')) fail('NO_RUNNERS', 'Ningún atleta corre en esta oleada.');
    heat.status = 'started';
    heat.startedAtMs = p.started_at_ms;
    s.activeHeatId = heat.id;
  },

  ARRIVAL_MARKED(s, p) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'started') fail('INVALID_HEAT_STATE', 'La oleada no está en curso.');
    const lane = heat.lanes[p.lane] ?? fail('LANE_EMPTY', 'Ese carril no tiene atleta.');
    if (lane.outcome !== 'pending') fail('LANE_NOT_PENDING', 'Ese atleta ya tiene resultado.');
    if (!isValidElapsed(p.elapsed_ms)) fail('INVALID_TIME', 'El tiempo no es válido.');
    const expected = lanesOf(heat).filter((l) => l.outcome === 'time').length + 1;
    if (p.arrival_order !== expected) fail('ARRIVAL_ORDER_MISMATCH', 'El orden de llegada no coincide.');
    lane.outcome = 'time';
    lane.elapsedMs = p.elapsed_ms;
    lane.arrivalOrder = expected;
    settle(heat);
  },

  RUN_NOT_FINISHED(s, p, e) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'started') fail('INVALID_HEAT_STATE', 'La oleada no está en curso.');
    const lane = lanesOf(heat).find((l) => l.registrationId === p.registration_id);
    if (!lane) fail('ATHLETE_NOT_IN_HEAT', 'El atleta no está en esta oleada.');
    if (lane.outcome !== 'pending') fail('LANE_NOT_PENDING', 'Ese atleta ya tiene resultado.');
    lane.outcome = 'did_not_finish';
    if (p.note.trim()) heat.notes.push({ kind: 'not_finished', text: p.note.trim(), at: e.occurredAt });
    settle(heat);
  },

  HEAT_REVIEWED(s, p, e) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'awaiting_confirmation') fail('INVALID_HEAT_STATE', 'La oleada no está por confirmar.');
    const text = requireNote(p.note);
    if (p.swap_arrivals) {
      const { left, right } = heat.lanes;
      if (left?.outcome !== 'time' || right?.outcome !== 'time')
        fail('NOTHING_TO_SWAP', 'Para intercambiar llegadas, ambos atletas deben tener tiempo.');
      [left.elapsedMs, right.elapsedMs] = [right.elapsedMs, left.elapsedMs];
      [left.arrivalOrder, right.arrivalOrder] = [right.arrivalOrder, left.arrivalOrder];
    }
    heat.notes.push({ kind: 'review', text, at: e.occurredAt });
  },

  HEAT_CONFIRMED(s, p) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status === 'awaiting_confirmation') {
      heat.status = 'confirmed';
      if (s.activeHeatId === heat.id) s.activeHeatId = null;
      return;
    }
    if (heat.status === 'pending') {
      // Oleada sin corredores (no corren o retirados): se confirma sin salir a pista.
      if (lanesOf(heat).some((l) => l.outcome === 'pending'))
        fail('HEAT_HAS_RUNNERS', 'La oleada tiene atletas por correr.');
      if (heat.runNumber !== currentRun(s, heat.stageId)) fail('RUN_NOT_OPEN', 'Esa salida todavía no está habilitada.');
      heat.status = 'confirmed';
      return;
    }
    fail('INVALID_HEAT_STATE', 'La oleada no se puede confirmar en este momento.');
  },

  HEAT_REOPENED(s, p, e) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'confirmed') fail('INVALID_HEAT_STATE', 'Solo se reabre una oleada confirmada.');
    getOpenStage(s, heat.stageId);
    const text = requireNote(p.note);
    if (s.activeHeatId) fail('SECOND_ACTIVE_HEAT', 'Hay otra oleada en la pista. Confírmala primero.');
    heat.status = 'awaiting_confirmation';
    heat.notes.push({ kind: 'reopen', text, at: e.occurredAt });
    s.activeHeatId = heat.id;
  },

  ATHLETE_WITHDRAWN(s, p, e) {
    const stage = s.stages[p.stage_id] ?? fail('STAGE_NOT_FOUND', 'La instancia no existe.');
    if (!stage.entries.includes(p.registration_id)) fail('ATHLETE_NOT_IN_STAGE', 'El atleta no está en esta instancia.');
    if (s.withdrawals[p.registration_id]) fail('ATHLETE_WITHDRAWN', 'El atleta ya está retirado.');
    const text = requireNote(p.note);
    s.withdrawals[p.registration_id] = {
      registrationId: p.registration_id,
      stageId: stage.id,
      heatId: p.heat_id,
      reason: p.reason,
      note: text,
      at: e.occurredAt,
    };
    // Los tiempos ya registrados se conservan; lo que no ha corrido queda como retirado.
    for (const heat of Object.values(s.heats)) {
      if (heat.stageId !== stage.id) continue;
      for (const lane of lanesOf(heat)) {
        if (lane.registrationId !== p.registration_id) continue;
        const notRunYet = heat.status === 'pending' && (lane.outcome === 'pending' || lane.outcome === 'did_not_run');
        const runningNow = heat.status === 'started' && lane.outcome === 'pending';
        if (notRunYet || runningNow) lane.outcome = 'withdrawn';
      }
      settle(heat);
    }
  },

  TIEBREAK_STARTED: notYet,
  TIEBREAK_DECIDED: notYet,
  STAGE_CLOSED: notYet,
  DEVICE_TAKEOVER: notYet,
  BACKUP_IMPORTED: notYet,
  RACE_FINISHED: notYet,
};

function notYet(_s: RaceState, _p: unknown, e: TrackEvent): never {
  fail('NOT_SUPPORTED_YET', `El evento ${e.type} se implementa en una fase posterior.`);
}

/** Aplica un evento. Devuelve un estado nuevo o lanza EngineError si viola una regla. */
export function applyEvent(state: RaceState, event: TrackEvent): RaceState {
  const next = clone(state);
  (handlers[event.type] as Handler<typeof event.type>)(next, event.payload as never, event);
  return next;
}

export interface ReplayResult {
  state: RaceState;
  /** Eventos que no se pudieron aplicar (no deberían existir: se validan al guardarlos). */
  rejected: { event: TrackEvent; error: EngineError }[];
}

/** Reconstruye el estado aplicando los eventos en orden. */
export function replay(config: RaceConfig, events: readonly TrackEvent[]): ReplayResult {
  let state = createInitialState(config);
  const rejected: ReplayResult['rejected'] = [];
  for (const event of events) {
    try {
      state = applyEvent(state, event);
    } catch (e) {
      if (e instanceof EngineError) rejected.push({ event, error: e });
      else throw e;
    }
  }
  return { state, rejected };
}
