import { rankRows, type RankingRow } from './ranking';
import type { HeatState, LaneState, RaceState, RunResult, StageState } from './types';

/** Consultas sobre el estado. Puras y sin efectos. */

export const lanesOf = (heat: HeatState): LaneState[] =>
  [heat.lanes.left, heat.lanes.right].filter((l): l is LaneState => l !== null);

export function heatsOfRun(state: RaceState, stageId: string, runNumber: number): HeatState[] {
  return state.heatOrder
    .map((id) => state.heats[id]!)
    .filter((h) => h.stageId === stageId && h.runNumber === runNumber)
    .sort((a, b) => a.heatNumber - b.heatNumber);
}

/**
 * Resultado de un atleta en una salida. Un tiempo solo cuenta cuando la oleada está confirmada.
 * Un retiro cuenta como resuelto aunque la oleada no haya corrido.
 */
export function runResult(state: RaceState, stageId: string, registrationId: string, runNumber: number): RunResult {
  for (const heat of heatsOfRun(state, stageId, runNumber)) {
    const lane = lanesOf(heat).find((l) => l.registrationId === registrationId);
    if (!lane) continue;
    if (lane.outcome === 'withdrawn') return { kind: 'withdrawn' };
    if (heat.status !== 'confirmed') return { kind: 'pending' };
    switch (lane.outcome) {
      case 'time':
        return { kind: 'time', ms: lane.elapsedMs! };
      case 'did_not_run':
        return { kind: 'did_not_run' };
      case 'did_not_finish':
        return { kind: 'did_not_finish' };
      default:
        return { kind: 'pending' };
    }
  }
  return state.withdrawals[registrationId] ? { kind: 'withdrawn' } : { kind: 'pending' };
}

export function isRunComplete(state: RaceState, stageId: string, runNumber: number): boolean {
  const stage = state.stages[stageId];
  if (!stage) return false;
  return stage.entries.every((r) => runResult(state, stageId, r, runNumber).kind !== 'pending');
}

/** Salida que se está corriendo. Si devuelve runsPerAthlete + 1, todas las salidas terminaron. */
export function currentRun(state: RaceState, stageId: string): number {
  const stage = state.stages[stageId];
  if (!stage) return 1;
  for (let r = 1; r <= stage.runsPerAthlete; r++) if (!isRunComplete(state, stageId, r)) return r;
  return stage.runsPerAthlete + 1;
}

export function stagesOfCategory(state: RaceState, categoryId: string): StageState[] {
  return Object.values(state.stages)
    .filter((s) => s.categoryId === categoryId)
    .sort((a, b) => a.stageNumber - b.stageNumber);
}

/** Instancia abierta de la categoría, o la última si todas cerraron. */
export function currentStage(state: RaceState, categoryId: string): StageState | undefined {
  const stages = stagesOfCategory(state, categoryId);
  return stages.find((s) => s.status === 'open') ?? stages.find((s) => s.status === 'pending') ?? stages.at(-1);
}

export function stageRanking(state: RaceState, stageId: string): RankingRow[] {
  const stage = state.stages[stageId];
  if (!stage) return [];
  return rankRows(
    stage.entries.map((registrationId) => ({
      registrationId,
      withdrawn: !!state.withdrawals[registrationId],
      runs: Array.from({ length: stage.runsPerAthlete }, (_, i) =>
        runResult(state, stageId, registrationId, i + 1),
      ),
    })),
  );
}

export interface StageProgress {
  currentRun: number;
  runsPerAthlete: number;
  allRunsDone: boolean;
  heatsInRun: number;
  confirmedInRun: number;
}

export function stageProgress(state: RaceState, stageId: string): StageProgress {
  const stage = state.stages[stageId]!;
  const run = currentRun(state, stageId);
  const allRunsDone = run > stage.runsPerAthlete;
  const heats = allRunsDone ? [] : heatsOfRun(state, stageId, run);
  return {
    currentRun: Math.min(run, stage.runsPerAthlete),
    runsPerAthlete: stage.runsPerAthlete,
    allRunsDone,
    heatsInRun: heats.length,
    confirmedInRun: heats.filter((h) => h.status === 'confirmed').length,
  };
}
