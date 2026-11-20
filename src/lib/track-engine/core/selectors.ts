import { rankRows, type RankingRow } from './ranking';
import type { HeatState, LaneState, RaceState, RunResult, StageState } from './types';

/** Consultas sobre el estado. Puras y sin efectos. */

export const lanesOf = (heat: HeatState): LaneState[] =>
  [heat.lanes.left, heat.lanes.right].filter((l): l is LaneState => l !== null);

/** Oleadas vigentes de una salida (sin las anuladas por lluvia ni las de desempate), por número. */
export function heatsOfRun(state: RaceState, stageId: string, runNumber: number): HeatState[] {
  return state.heatOrder
    .map((id) => state.heats[id]!)
    .filter((h) => h.kind === 'regular' && h.stageId === stageId && h.runNumber === runNumber && h.status !== 'voided')
    .sort((a, b) => a.heatNumber - b.heatNumber);
}

/** Oleadas anuladas por protocolo de lluvia en una salida, para mostrarlas. */
export function voidedHeatsOfRun(state: RaceState, stageId: string, runNumber: number): HeatState[] {
  return state.heatOrder
    .map((id) => state.heats[id]!)
    .filter((h) => h.kind === 'regular' && h.stageId === stageId && h.runNumber === runNumber && h.status === 'voided')
    .sort((a, b) => a.heatNumber - b.heatNumber);
}

/** Oleadas de desempate de una instancia. */
export function tiebreakHeats(state: RaceState, stageId: string): HeatState[] {
  return state.heatOrder
    .map((id) => state.heats[id]!)
    .filter((h) => h.kind === 'tiebreak' && h.stageId === stageId)
    .sort((a, b) => a.heatNumber - b.heatNumber);
}

/**
 * Resultado de un atleta en una salida.
 * - Salida anulada por lluvia: 'voided', con el tiempo que tenía si lo tenía.
 * - Un tiempo solo cuenta cuando la oleada está confirmada.
 * - Un retiro cuenta como resuelto aunque la oleada no haya corrido.
 */
export function runResult(state: RaceState, stageId: string, registrationId: string, runNumber: number): RunResult {
  const stage = state.stages[stageId];
  if (stage?.voidedRuns.includes(runNumber)) {
    const lane = voidedHeatsOfRun(state, stageId, runNumber)
      .flatMap(lanesOf)
      .find((l) => l.registrationId === registrationId && l.outcome === 'time');
    return { kind: 'voided', ms: lane?.elapsedMs ?? null };
  }
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
  if (stage.voidedRuns.includes(runNumber)) return true;
  return stage.entries.every((r) => runResult(state, stageId, r, runNumber).kind !== 'pending');
}

/** Salida actual. Si devuelve runsPerAthlete + 1, todas las salidas terminaron. */
export function currentRun(state: RaceState, stageId: string): number {
  const stage = state.stages[stageId];
  if (!stage) return 1;
  for (let r = 1; r <= stage.runsPerAthlete; r++) if (!isRunComplete(state, stageId, r)) return r;
  return stage.runsPerAthlete + 1;
}

export const allRunsDone = (state: RaceState, stageId: string): boolean =>
  currentRun(state, stageId) > (state.stages[stageId]?.runsPerAthlete ?? 0);

/** La instancia ya empezó: alguna de sus oleadas salió a pista o se resolvió. */
export function stageHasStarted(state: RaceState, stageId: string): boolean {
  return Object.values(state.heats).some(
    (h) => h.stageId === stageId && (h.startedAtMs !== null || h.status !== 'pending'),
  );
}

export function stagesOfCategory(state: RaceState, categoryId: string): StageState[] {
  return Object.values(state.stages)
    .filter((s) => s.categoryId === categoryId)
    .sort((a, b) => a.stageNumber - b.stageNumber);
}

export function nextStage(state: RaceState, stageId: string): StageState | undefined {
  const stage = state.stages[stageId];
  if (!stage) return undefined;
  return stagesOfCategory(state, stage.categoryId).find((s) => s.stageNumber === stage.stageNumber + 1);
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
      runs: Array.from({ length: stage.runsPerAthlete }, (_, i) => runResult(state, stageId, registrationId, i + 1)),
    })),
  );
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Grupos de empate total (dos o más atletas con tiedWithPrevious encadenado), entre los que tienen posición. */
function tieGroups(ranking: RankingRow[]): string[][] {
  const eligible = ranking.filter((r) => r.position !== null);
  const groups: string[][] = [];
  eligible.forEach((r, i) => {
    if (r.tiedWithPrevious) groups.at(-1)!.push(r.registrationId);
    else if (eligible[i + 1]?.tiedWithPrevious) groups.push([r.registrationId]);
  });
  return groups;
}

/**
 * Empate que atraviesa el corte de clasificados y que el juez aún no decidió.
 * Devuelve los atletas empatados en su orden de clasificación, o null si no hay.
 */
export function cutTie(state: RaceState, stageId: string): string[] | null {
  const stage = state.stages[stageId];
  if (!stage?.qualifiersCount) return null;
  const ranking = stageRanking(state, stageId);
  const eligible = ranking.filter((r) => r.position !== null).map((r) => r.registrationId);
  const q = stage.qualifiersCount;
  if (eligible.length <= q) return null;
  const group = tieGroups(ranking).find((g) => {
    const first = eligible.indexOf(g[0]!);
    const last = eligible.indexOf(g.at(-1)!);
    return first < q && last >= q;
  });
  if (!group) return null;
  return stage.tieDecisions.some((d) => sameSet(d.registrationIds, group)) ? null : group;
}

/**
 * Orden final de la instancia: clasificación aplicando las decisiones del juez sobre empates,
 * y al final retirados y atletas sin tiempo.
 */
export function stageFinalOrder(state: RaceState, stageId: string): string[] {
  const stage = state.stages[stageId];
  if (!stage) return [];
  const order = stageRanking(state, stageId).map((r) => r.registrationId);
  for (const d of stage.tieDecisions) {
    const positions = d.registrationIds.map((r) => order.indexOf(r)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (positions.length !== d.order.length) continue;
    positions.forEach((pos, i) => {
      order[pos] = d.order[i]!;
    });
  }
  return order;
}

/** Atletas que clasificarían si se cerrara ahora la instancia. */
export function projectedQualifiers(state: RaceState, stageId: string): string[] {
  const stage = state.stages[stageId];
  if (!stage?.qualifiersCount) return [];
  const eligible = new Set(
    stageRanking(state, stageId)
      .filter((r) => r.position !== null)
      .map((r) => r.registrationId),
  );
  return stageFinalOrder(state, stageId)
    .filter((r) => eligible.has(r))
    .slice(0, stage.qualifiersCount);
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
  const done = run > stage.runsPerAthlete;
  const heats = done ? [] : heatsOfRun(state, stageId, run);
  return {
    currentRun: Math.min(run, stage.runsPerAthlete),
    runsPerAthlete: stage.runsPerAthlete,
    allRunsDone: done,
    heatsInRun: heats.length,
    confirmedInRun: heats.filter((h) => h.status === 'confirmed').length,
  };
}
