import type { TrackEvent } from './events';
import type { EngineErrorCode } from './reducer';
import { replay } from './reducer';
import { currentRun, stageRanking } from './selectors';
import type { LaneOutcome, LaneState, RaceConfig } from './types';

/**
 * Casos dorados: una carrera (config), una lista de eventos y el resultado esperado.
 * La app y el servidor deben producir exactamente el mismo resultado para cada caso.
 * Archivos: docs/golden/*.json. Verificador: runGoldenCase.
 */

export interface GoldenLane {
  registrationId: string;
  outcome: LaneOutcome;
  elapsedMs: number | null;
  arrivalOrder: number | null;
}

export interface GoldenOutcome {
  /** Eventos rechazados por el motor, en orden, con su código. */
  rejected: { clientEventId: string; code: EngineErrorCode }[];
  started: boolean;
  finished: boolean;
  activeHeatId: string | null;
  heats: {
    id: string;
    stageId: string;
    kind: string;
    tiebreakId: string | null;
    runNumber: number;
    heatNumber: number;
    status: string;
    pairingSource: string;
    left: GoldenLane | null;
    right: GoldenLane | null;
    notes: { kind: string; text: string }[];
  }[];
  stages: {
    id: string;
    mode: string;
    status: string;
    currentRun: number;
    entries: string[];
    voidedRuns: number[];
    rainActions: { kind: string; runNumber: number; note: string }[];
    tieDecisions: { registrationIds: string[]; order: string[]; resolution: string; note: string }[];
    finalOrder: string[] | null;
    qualified: string[] | null;
    promotions: { promoted: string; replaced: string }[];
    ranking: {
      registrationId: string;
      position: number | null;
      bestMs: number | null;
      sortedCentis: number[];
      withdrawn: boolean;
      tiedWithPrevious: boolean;
      eliminated: boolean;
    }[];
  }[];
  withdrawals: { registrationId: string; stageId: string; reason: string; note: string }[];
  warnings: string[];
}

export interface GoldenCase {
  name: string;
  description: string;
  engineVersion: string;
  config: RaceConfig;
  events: TrackEvent[];
  expected: GoldenOutcome;
}

const lane = (l: LaneState | null): GoldenLane | null =>
  l && { registrationId: l.registrationId, outcome: l.outcome, elapsedMs: l.elapsedMs, arrivalOrder: l.arrivalOrder };

/** Aplica los eventos y resume el resultado en un formato estable y comparable. */
export function summarizeOutcome(config: RaceConfig, events: readonly TrackEvent[]): GoldenOutcome {
  const { state, rejected } = replay(config, events);
  return {
    rejected: rejected.map((r) => ({ clientEventId: r.event.clientEventId, code: r.error.code })),
    started: state.started,
    finished: state.finished,
    activeHeatId: state.activeHeatId,
    heats: state.heatOrder.map((id) => {
      const h = state.heats[id]!;
      return {
        id: h.id,
        stageId: h.stageId,
        kind: h.kind,
        tiebreakId: h.tiebreakId,
        runNumber: h.runNumber,
        heatNumber: h.heatNumber,
        status: h.status,
        pairingSource: h.pairingSource,
        left: lane(h.lanes.left),
        right: lane(h.lanes.right),
        notes: h.notes.map((n) => ({ kind: n.kind, text: n.text })),
      };
    }),
    stages: Object.values(state.stages)
      .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.stageNumber - b.stageNumber)
      .map((s) => ({
        id: s.id,
        mode: s.mode,
        status: s.status,
        currentRun: currentRun(state, s.id),
        entries: s.entries,
        voidedRuns: s.voidedRuns,
        rainActions: s.rainActions.map((a) => ({ kind: a.kind, runNumber: a.runNumber, note: a.note })),
        tieDecisions: s.tieDecisions.map((d) => ({
          registrationIds: d.registrationIds,
          order: d.order,
          resolution: d.resolution,
          note: d.note,
        })),
        finalOrder: s.finalOrder,
        qualified: s.qualified,
        promotions: s.promotions.map((x) => ({ promoted: x.promoted, replaced: x.replaced })),
        ranking: stageRanking(state, s.id).map((r) => ({
          registrationId: r.registrationId,
          position: r.position,
          bestMs: r.bestMs,
          sortedCentis: r.sortedCentis,
          withdrawn: r.withdrawn,
          tiedWithPrevious: r.tiedWithPrevious,
          eliminated: r.eliminated,
        })),
      })),
    withdrawals: Object.values(state.withdrawals).map((w) => ({
      registrationId: w.registrationId,
      stageId: w.stageId,
      reason: w.reason,
      note: w.note,
    })),
    warnings: state.warnings,
  };
}

/** Ejecuta un caso dorado. `ok` es true si el resultado coincide exactamente con el esperado. */
export function runGoldenCase(c: GoldenCase): { ok: boolean; actual: GoldenOutcome } {
  const actual = summarizeOutcome(c.config, c.events);
  return { ok: JSON.stringify(actual) === JSON.stringify(c.expected), actual };
}
