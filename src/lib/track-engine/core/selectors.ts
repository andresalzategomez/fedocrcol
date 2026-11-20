import { rankRows, type RankingRow } from './ranking';
import { toCentis } from './time';
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
  return withdrawnIn(state, registrationId, stageId) ? { kind: 'withdrawn' } : { kind: 'pending' };
}

/**
 * El atleta se retiró en esta instancia. Un retiro en una instancia posterior no cambia
 * las instancias anteriores (ya cerradas): ahí conserva su posición y su clasificación.
 */
export function withdrawnIn(state: RaceState, registrationId: string, stageId: string): boolean {
  return state.withdrawals[registrationId]?.stageId === stageId;
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
  if (stage.mode === 'duel') return duelRanking(state, stage);
  return rankRows(
    stage.entries.map((registrationId) => ({
      registrationId,
      withdrawn: withdrawnIn(state, registrationId, stageId),
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
  if (stage?.mode === 'duel') return duelResults(state, stageId).find((d) => d.tie && !d.winner)?.tie ?? null;
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
  if (stage.mode === 'duel') return duelRanking(state, stage).map((r) => r.registrationId);
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
  if (stage.mode === 'duel') return duelWinners(state, stageId);
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

/* ---------------------------------------------------------------------------------------------
 * Muerte súbita (mode = 'duel'). Reglas:
 * - Pasa el ganador de cada oleada: el de menor tiempo, en centésimas truncadas.
 * - Atleta solo en la oleada (sin rival, o con el rival retirado): pasa.
 * - Si solo uno de los dos tiene tiempo (el otro no corre o no termina): pasa el que tiene tiempo.
 * - Empate exacto, o ninguno con tiempo: decide el juez (directo o repitiendo el duelo) con
 *   TIEBREAK_STARTED / TIEBREAK_DECIDED. Los tiempos del desempate no reemplazan los del duelo.
 * - Orden: ganadores por su tiempo, luego eliminados por su tiempo, luego retirados.
 *   A igual tiempo, desempata la posición en la instancia anterior (o el orden de siembra).
 * - Todos los tiempos se conservan para los reportes.
 * ------------------------------------------------------------------------------------------- */

export interface DuelResult {
  heatId: string;
  heatNumber: number;
  /** Atletas de la oleada, izquierda y derecha. */
  athletes: string[];
  /** null mientras falte resolver la oleada o el juez no haya decidido un empate. */
  winner: string | null;
  /** Empate que decide el juez (con o sin decisión ya tomada). */
  tie: string[] | null;
  /** Todos los atletas presentes de la oleada tienen resultado. */
  resolved: boolean;
}

export function duelResults(state: RaceState, stageId: string): DuelResult[] {
  const stage = state.stages[stageId];
  if (stage?.mode !== 'duel') return [];
  return heatsOfRun(state, stageId, 1).map((heat) => {
    const athletes = lanesOf(heat).map((l) => l.registrationId);
    const present = athletes.filter((r) => !withdrawnIn(state, r, stageId));
    const base: DuelResult = { heatId: heat.id, heatNumber: heat.heatNumber, athletes, winner: null, tie: null, resolved: false };
    if (present.length === 0) return { ...base, resolved: true };
    const results = present.map((r) => runResult(state, stageId, r, 1));
    const resolved = results.every((x) => x.kind !== 'pending');
    if (present.length === 1) return { ...base, winner: present[0]!, resolved };
    if (!resolved) return base;

    const [a, b] = present as [string, string];
    const [ta, tb] = results.map((x) => (x.kind === 'time' ? toCentis(x.ms) : null));
    let winner: string | null = null;
    let tie: string[] | null = null;
    if (ta != null && tb != null) {
      if (ta < tb) winner = a;
      else if (tb < ta) winner = b;
      else tie = [a, b];
    } else if (ta != null) winner = a;
    else if (tb != null) winner = b;
    else tie = [a, b];
    if (tie) {
      const group = tie;
      const decision = stage.tieDecisions.find((d) => sameSet(d.registrationIds, group));
      if (decision) winner = decision.order[0]!;
    }
    return { ...base, winner, tie, resolved: true };
  });
}

/** Ganadores de los duelos, en el orden de la siguiente siembra (mejor tiempo primero). */
export function duelWinners(state: RaceState, stageId: string): string[] {
  const stage = state.stages[stageId];
  if (stage?.mode !== 'duel') return [];
  const winners = new Set(duelResults(state, stageId).flatMap((d) => (d.winner ? [d.winner] : [])));
  return duelRanking(state, stage)
    .filter((r) => winners.has(r.registrationId))
    .map((r) => r.registrationId);
}

function duelRanking(state: RaceState, stage: StageState): RankingRow[] {
  const duels = duelResults(state, stage.id);
  const winners = new Set(duels.flatMap((d) => (d.winner ? [d.winner] : [])));
  // Perdedor: estaba en una oleada ya definida (con ganador) y no ganó.
  const losers = new Set(duels.filter((d) => d.winner).flatMap((d) => d.athletes.filter((r) => r !== d.winner)));
  const prev = stagesOfCategory(state, stage.categoryId).find((x) => x.stageNumber === stage.stageNumber - 1);
  const prevOrder = prev?.finalOrder ?? [];
  const seedIndex = (r: string) => {
    const i = prevOrder.indexOf(r);
    return i >= 0 ? i : prevOrder.length + stage.entries.indexOf(r);
  };

  const rows: RankingRow[] = stage.entries.map((registrationId) => {
    const runs = Array.from({ length: stage.runsPerAthlete }, (_, i) => runResult(state, stage.id, registrationId, i + 1));
    const times = runs.flatMap((r) => (r.kind === 'time' ? [r.ms] : [])).sort((x, y) => x - y);
    const withdrawn = withdrawnIn(state, registrationId, stage.id);
    return {
      registrationId,
      runs,
      withdrawn,
      bestMs: times[0] ?? null,
      sortedCentis: times.map(toCentis),
      position: null,
      tiedWithPrevious: false,
      eliminated: !withdrawn && losers.has(registrationId),
    };
  });

  // Ganadores, luego los demás (eliminados o con su duelo sin definir), luego retirados.
  const group = (r: RankingRow) => (r.withdrawn ? 2 : winners.has(r.registrationId) ? 0 : 1);
  rows.sort((x, y) => {
    const g = group(x) - group(y);
    if (g !== 0) return g;
    const cx = x.sortedCentis[0];
    const cy = y.sortedCentis[0];
    if (cx !== cy) {
      if (cx === undefined) return 1;
      if (cy === undefined) return -1;
      return cx - cy;
    }
    return seedIndex(x.registrationId) - seedIndex(y.registrationId);
  });
  rows.forEach((r, i) => {
    if (!r.withdrawn) r.position = i + 1;
  });
  return rows;
}
