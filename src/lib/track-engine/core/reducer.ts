import type { PairingDraft, PayloadOf, TrackEvent } from './events';
import { seededPairing } from './pairing';
import {
  allRunsDone,
  currentRun,
  cutTie,
  heatsOfRun,
  lanesOf,
  nextStage,
  runResult,
  stageFinalOrder,
  stageHasStarted,
  stageRanking,
  stagesOfCategory,
} from './selectors';
import { isValidElapsed } from './time';
import type { HeatState, LaneState, PairingSource, RaceConfig, RaceState, StageState } from './types';

export type EngineErrorCode =
  | 'RACE_NOT_STARTED'
  | 'RACE_ALREADY_STARTED'
  | 'RACE_ALREADY_FINISHED'
  | 'STAGE_NOT_FOUND'
  | 'STAGE_NOT_OPEN'
  | 'STAGES_OPEN'
  | 'HEAT_NOT_FOUND'
  | 'INVALID_HEAT_STATE'
  | 'SECOND_ACTIVE_HEAT'
  | 'HEAT_IN_PROGRESS'
  | 'RUN_NOT_OPEN'
  | 'RUN_CLOSED'
  | 'RUN_NOT_CURRENT'
  | 'RUNS_NOT_FINISHED'
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
  | 'TIE_UNRESOLVED'
  | 'TIEBREAK_PENDING'
  | 'TIEBREAK_NOT_FOUND'
  | 'TIEBREAK_GROUP_MISMATCH'
  | 'INVALID_TIEBREAK_ORDER'
  | 'NO_QUALIFIERS'
  | 'RAIN_NOT_ALLOWED'
  | 'NO_VALID_TIMES_LEFT'
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

function newHeat(
  stage: StageState,
  d: PairingDraft,
  runNumber: number,
  source: PairingSource,
  kind: HeatState['kind'] = 'regular',
  tiebreakId: string | null = null,
): HeatState {
  return {
    id: d.heat_id,
    categoryId: stage.categoryId,
    stageId: stage.id,
    kind,
    runNumber,
    heatNumber: d.heat_number,
    status: 'pending',
    pairingSource: source,
    lanes: { left: newLane(d.left), right: d.right ? newLane(d.right) : null },
    startedAtMs: null,
    notes: [],
    tiebreakId,
  };
}

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
          voidedRuns: [],
          rainActions: [],
          tieDecisions: [],
          finalOrder: null,
          qualified: null,
          promotions: [],
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
    tiebreaks: {},
    warnings: [],
  };

  for (const h of config.initialHeats) {
    const stage = stages[h.stageId];
    if (!stage) {
      state.warnings.push(`La oleada ${h.heatNumber} apunta a una instancia que no existe.`);
      continue;
    }
    state.heats[h.id] = newHeat(
      stage,
      { heat_id: h.id, heat_number: h.heatNumber, left: h.left, right: h.right },
      h.runNumber,
      'fedocr',
    );
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

function getStage(state: RaceState, stageId: string): StageState {
  return state.stages[stageId] ?? fail('STAGE_NOT_FOUND', 'La instancia no existe.');
}

function getOpenStage(state: RaceState, stageId: string): StageState {
  const stage = getStage(state, stageId);
  if (stage.status !== 'open') fail('STAGE_NOT_OPEN', 'La instancia no está abierta.');
  return stage;
}

function requireNote(text: string): string {
  const t = text.trim();
  if (!t) fail('NOTE_REQUIRED', 'La observación es obligatoria.');
  return t;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Cuando ya no queda nadie corriendo, la oleada pasa a esperar confirmación. */
function settle(heat: HeatState) {
  if (heat.status === 'started' && !lanesOf(heat).some((l) => l.outcome === 'pending')) {
    heat.status = 'awaiting_confirmation';
  }
}

/**
 * Valida oleadas nuevas: identificadores y números únicos, máximo 2 atletas,
 * cada atleta de `required` exactamente una vez (contando `taken`, los que ya tienen oleada) y nadie más.
 */
function validateDrafts(
  s: RaceState,
  drafts: PairingDraft[],
  required: readonly string[],
  taken: Set<string>,
  usedNumbers: Set<number>,
) {
  const allowed = new Set(required);
  const seen = new Set(taken);
  const numbers = new Set(usedNumbers);
  const ids = new Set<string>();
  for (const d of drafts) {
    if (s.heats[d.heat_id] || ids.has(d.heat_id)) fail('INVALID_PAIRING', 'Identificador de oleada repetido.');
    ids.add(d.heat_id);
    if (numbers.has(d.heat_number)) fail('INVALID_PAIRING', `El número de oleada ${d.heat_number} está repetido.`);
    numbers.add(d.heat_number);
    for (const reg of [d.left, d.right]) {
      if (!reg) continue;
      if (s.withdrawals[reg]) fail('ATHLETE_WITHDRAWN', 'Un atleta retirado no puede tener oleada.');
      if (!allowed.has(reg)) fail('INVALID_PAIRING', 'Un atleta no corresponde a estas oleadas.');
      if (seen.has(reg)) fail('INVALID_PAIRING', 'Un atleta aparece dos veces.');
      seen.add(reg);
    }
  }
  const missing = required.filter((r) => !seen.has(r));
  if (missing.length) fail('INVALID_PAIRING', `Faltan ${missing.length} atleta(s) por asignar.`);
}

const activeEntries = (s: RaceState, stage: StageState) => stage.entries.filter((r) => !s.withdrawals[r]);

/** Anula (protocolo de lluvia) todas las oleadas vigentes de una salida. Nada se borra. */
function voidRunHeats(s: RaceState, stage: StageState, runNumber: number, note: string, at: string) {
  for (const heat of heatsOfRun(s, stage.id, runNumber)) {
    heat.status = 'voided';
    heat.notes.push({ kind: 'voided', text: note, at });
    if (s.activeHeatId === heat.id) s.activeHeatId = null;
  }
}

/** Salida 1 de una instancia: primero contra último, con identificadores deterministas. */
function seedStage(s: RaceState, stage: StageState) {
  for (const h of heatsOfRun(s, stage.id, 1)) if (h.status === 'pending') delete s.heats[h.id];
  s.heatOrder = s.heatOrder.filter((id) => s.heats[id]);
  seededPairing(activeEntries(s, stage)).forEach((p, i) => {
    const heat = newHeat(
      stage,
      { heat_id: `${stage.id}-r1-h${i + 1}`, heat_number: i + 1, left: p.left, right: p.right },
      1,
      'seeded',
    );
    s.heats[heat.id] = heat;
    s.heatOrder.push(heat.id);
  });
}

function requireRainAllowed(s: RaceState, stageId: string, runNumber: number): StageState {
  const stage = getOpenStage(s, stageId);
  if (stage.runsPerAthlete <= 1) fail('RAIN_NOT_ALLOWED', 'El protocolo de lluvia aplica en instancias con más de 1 salida.');
  if (runNumber !== currentRun(s, stage.id))
    fail('RUN_NOT_CURRENT', 'El protocolo de lluvia solo aplica a la salida actual.');
  return stage;
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

    validateDrafts(
      s,
      p.heats,
      activeEntries(s, stage),
      new Set(kept.flatMap((h) => lanesOf(h).map((l) => l.registrationId))),
      new Set(kept.map((h) => h.heatNumber)),
    );
    for (const d of p.heats) {
      s.heats[d.heat_id] = newHeat(stage, d, p.run_number, p.source);
      s.heatOrder.push(d.heat_id);
    }
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
    if (heat.kind === 'regular' && heat.runNumber !== currentRun(s, heat.stageId))
      fail('RUN_NOT_OPEN', 'Esa salida se habilita cuando terminen todas las oleadas de la salida actual.');
    if (heat.kind === 'tiebreak' && s.tiebreaks[heat.tiebreakId!]?.decided)
      fail('INVALID_HEAT_STATE', 'Ese desempate ya fue decidido.');
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
      if (heat.kind === 'regular' && heat.runNumber !== currentRun(s, heat.stageId))
        fail('RUN_NOT_OPEN', 'Esa salida todavía no está habilitada.');
      heat.status = 'confirmed';
      return;
    }
    fail('INVALID_HEAT_STATE', 'La oleada no se puede confirmar en este momento.');
  },

  HEAT_REOPENED(s, p, e) {
    const heat = getHeat(s, p.heat_id);
    if (heat.status !== 'confirmed') fail('INVALID_HEAT_STATE', 'Solo se reabre una oleada confirmada.');
    getOpenStage(s, heat.stageId);
    if (heat.kind === 'tiebreak' && s.tiebreaks[heat.tiebreakId!]?.decided)
      fail('INVALID_HEAT_STATE', 'Ese desempate ya fue decidido.');
    const text = requireNote(p.note);
    if (s.activeHeatId) fail('SECOND_ACTIVE_HEAT', 'Hay otra oleada en la pista. Confírmala primero.');
    heat.status = 'awaiting_confirmation';
    heat.notes.push({ kind: 'reopen', text, at: e.occurredAt });
    s.activeHeatId = heat.id;
  },

  ATHLETE_WITHDRAWN(s, p, e) {
    const stage = getStage(s, p.stage_id);
    if (!stage.entries.includes(p.registration_id)) fail('ATHLETE_NOT_IN_STAGE', 'El atleta no está en esta instancia.');
    if (s.withdrawals[p.registration_id]) fail('ATHLETE_WITHDRAWN', 'El atleta ya está retirado.');
    const text = requireNote(p.note);
    const startedBefore = stageHasStarted(s, stage.id);

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
      if (heat.stageId !== stage.id || heat.status === 'voided') continue;
      for (const lane of lanesOf(heat)) {
        if (lane.registrationId !== p.registration_id) continue;
        const notRunYet = heat.status === 'pending' && (lane.outcome === 'pending' || lane.outcome === 'did_not_run');
        const runningNow = heat.status === 'started' && lane.outcome === 'pending';
        if (notRunYet || runningNow) lane.outcome = 'withdrawn';
      }
      settle(heat);
    }

    // Retiro de un clasificado antes de que empiece la instancia: sube el siguiente mejor tiempo.
    if (stage.status === 'open' && stage.stageNumber > 1 && !startedBefore) {
      const prev = stagesOfCategory(s, stage.categoryId).find((x) => x.stageNumber === stage.stageNumber - 1);
      if (prev?.status === 'closed' && prev.finalOrder) {
        const eligible = new Set(
          stageRanking(s, prev.id)
            .filter((r) => r.position !== null)
            .map((r) => r.registrationId),
        );
        const promoted = prev.finalOrder.find(
          (r) => eligible.has(r) && !stage.entries.includes(r) && !s.withdrawals[r],
        );
        if (promoted) {
          stage.entries.push(promoted);
          prev.qualified = [...(prev.qualified ?? []), promoted];
          stage.promotions.push({ promoted, replaced: p.registration_id, at: e.occurredAt });
        }
        seedStage(s, stage);
      }
    }
  },

  TIEBREAK_STARTED(s, p, e) {
    const stage = getOpenStage(s, p.stage_id);
    if (!allRunsDone(s, stage.id)) fail('RUNS_NOT_FINISHED', 'El desempate se hace cuando terminan todas las salidas.');
    const group = cutTie(s, stage.id);
    if (!group || !sameSet(group, p.registration_ids))
      fail('TIEBREAK_GROUP_MISMATCH', 'Esos atletas no son el empate pendiente en el corte.');
    if (Object.values(s.tiebreaks).some((t) => t.stageId === stage.id && !t.decided))
      fail('TIEBREAK_PENDING', 'Ya hay un desempate en curso en esta instancia.');
    if (s.tiebreaks[p.tiebreak_id]) fail('INVALID_PAIRING', 'Identificador de desempate repetido.');
    const text = requireNote(p.note);
    validateDrafts(s, p.heats, group, new Set(), new Set());
    s.tiebreaks[p.tiebreak_id] = {
      id: p.tiebreak_id,
      stageId: stage.id,
      registrationIds: group,
      heatIds: p.heats.map((d) => d.heat_id),
      note: text,
      at: e.occurredAt,
      decided: false,
    };
    for (const d of p.heats) {
      s.heats[d.heat_id] = newHeat(stage, d, 0, 'manual', 'tiebreak', p.tiebreak_id);
      s.heatOrder.push(d.heat_id);
    }
  },

  TIEBREAK_DECIDED(s, p, e) {
    const stage = getOpenStage(s, p.stage_id);
    if (!allRunsDone(s, stage.id)) fail('RUNS_NOT_FINISHED', 'El desempate se hace cuando terminan todas las salidas.');
    const group = cutTie(s, stage.id);
    if (!group || !sameSet(group, p.registration_ids))
      fail('TIEBREAK_GROUP_MISMATCH', 'Esos atletas no son el empate pendiente en el corte.');
    if (!sameSet(group, p.order) || new Set(p.order).size !== group.length)
      fail('INVALID_TIEBREAK_ORDER', 'El orden debe incluir a cada atleta empatado una vez.');
    const text = requireNote(p.note);
    const open = Object.values(s.tiebreaks).find((t) => t.stageId === stage.id && !t.decided);

    if (p.resolution === 'runoff') {
      const tb = (p.tiebreak_id && s.tiebreaks[p.tiebreak_id]) || fail('TIEBREAK_NOT_FOUND', 'El desempate no existe.');
      if (tb.stageId !== stage.id || tb.decided) fail('TIEBREAK_NOT_FOUND', 'El desempate no está en curso.');
      if (tb.heatIds.some((id) => s.heats[id]?.status !== 'confirmed'))
        fail('TIEBREAK_PENDING', 'Confirma todas las oleadas del desempate antes de decidir.');
      tb.decided = true;
    } else if (open) {
      fail('TIEBREAK_PENDING', 'Hay un desempate corriendo: termínalo antes de decidir.');
    }

    stage.tieDecisions.push({
      registrationIds: group,
      order: [...p.order],
      resolution: p.resolution,
      tiebreakId: p.resolution === 'runoff' ? p.tiebreak_id : null,
      note: text,
      at: e.occurredAt,
    });
  },

  STAGE_CLOSED(s, p) {
    const stage = getOpenStage(s, p.stage_id);
    if (s.activeHeatId) fail('HEAT_IN_PROGRESS', 'Hay una oleada en la pista. Confírmala primero.');
    if (!allRunsDone(s, stage.id)) fail('RUNS_NOT_FINISHED', 'Faltan salidas por terminar.');
    if (Object.values(s.tiebreaks).some((t) => t.stageId === stage.id && !t.decided))
      fail('TIEBREAK_PENDING', 'Hay un desempate sin decidir.');
    if (cutTie(s, stage.id)) fail('TIE_UNRESOLVED', 'Hay un empate en el corte que debe decidir el juez.');

    const eligible = new Set(
      stageRanking(s, stage.id)
        .filter((r) => r.position !== null)
        .map((r) => r.registrationId),
    );
    const finalOrder = stageFinalOrder(s, stage.id);
    const qualified = stage.qualifiersCount ? finalOrder.filter((r) => eligible.has(r)).slice(0, stage.qualifiersCount) : [];
    const next = nextStage(s, stage.id);
    if (next && qualified.length === 0) fail('NO_QUALIFIERS', 'Ningún atleta tiene tiempo válido para clasificar.');

    stage.status = 'closed';
    stage.finalOrder = finalOrder;
    stage.qualified = qualified;
    if (next) {
      next.status = 'open';
      next.entries = [...qualified];
      seedStage(s, next);
    }
  },

  RUN_RESTARTED(s, p, e) {
    const stage = requireRainAllowed(s, p.stage_id, p.run_number);
    const text = requireNote(p.note);
    voidRunHeats(s, stage, p.run_number, text, e.occurredAt);
    validateDrafts(s, p.heats, activeEntries(s, stage), new Set(), new Set());
    for (const d of p.heats) {
      s.heats[d.heat_id] = newHeat(stage, d, p.run_number, 'restart');
      s.heatOrder.push(d.heat_id);
    }
    stage.rainActions.push({ kind: 'restart', runNumber: p.run_number, note: text, at: e.occurredAt });
  },

  RUN_VOIDED(s, p, e) {
    const stage = requireRainAllowed(s, p.stage_id, p.run_number);
    const text = requireNote(p.note);
    if (p.run_number === stage.runsPerAthlete) {
      const anyValid = activeEntries(s, stage).some((reg) =>
        Array.from({ length: stage.runsPerAthlete }, (_, i) => i + 1)
          .filter((r) => r !== p.run_number)
          .some((r) => runResult(s, stage.id, reg, r).kind === 'time'),
      );
      if (!anyValid)
        fail('NO_VALID_TIMES_LEFT', 'Si se anula esta salida nadie tendría tiempo válido. Reinicia la salida.');
    }
    voidRunHeats(s, stage, p.run_number, text, e.occurredAt);
    stage.voidedRuns.push(p.run_number);
    stage.rainActions.push({ kind: 'void', runNumber: p.run_number, note: text, at: e.occurredAt });
  },

  RACE_FINISHED(s) {
    if (s.activeHeatId) fail('HEAT_IN_PROGRESS', 'Hay una oleada en la pista.');
    if (Object.values(s.stages).some((st) => st.status !== 'closed'))
      fail('STAGES_OPEN', 'Para finalizar, todas las instancias deben estar cerradas.');
    s.finished = true;
  },

  // Eventos de dispositivo y respaldo: no cambian las reglas de competencia.
  DEVICE_TAKEOVER() {},
  BACKUP_IMPORTED() {},
};

/** Aplica un evento. Devuelve un estado nuevo o lanza EngineError si viola una regla. */
export function applyEvent(state: RaceState, event: TrackEvent): RaceState {
  if (state.finished && event.type !== 'DEVICE_TAKEOVER' && event.type !== 'BACKUP_IMPORTED')
    fail('RACE_ALREADY_FINISHED', 'La competencia ya finalizó.');
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
