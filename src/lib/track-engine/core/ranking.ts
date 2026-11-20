import { toCentis } from './time';
import type { RunResult } from './types';

export interface RankingInput {
  registrationId: string;
  runs: RunResult[];
  withdrawn: boolean;
}

export interface RankingRow extends RankingInput {
  bestMs: number | null;
  /** Tiempos válidos en centésimas, de mejor a peor. */
  sortedCentis: number[];
  /** null si no tiene tiempos o está retirado: no clasifica. */
  position: number | null;
  /** Empate total con el anterior después de comparar todos los tiempos (lo resuelve el juez). */
  tiedWithPrevious: boolean;
  /** Muerte súbita: perdió su oleada. Conserva su tiempo y su posición, pero no clasifica. */
  eliminated: boolean;
}

const timesOf = (runs: RunResult[]) =>
  runs.flatMap((r) => (r.kind === 'time' ? [r.ms] : [])).sort((x, y) => x - y);

/**
 * Orden de clasificación (reglas-negocio, apartados 7 y 9):
 * 1. Mejor tiempo, en centésimas.
 * 2. Si empatan, el siguiente tiempo de cada uno, de mejor a peor.
 * 3. Si a uno le falta el tiempo comparado, queda después.
 * 4. Si a ambos les falta, o todos sus tiempos coinciden, es empate y decide el juez.
 * Retirados y atletas sin tiempos van al final, sin posición.
 */
export function compareRows(a: RankingRow, b: RankingRow): number {
  const aEligible = !a.withdrawn && a.sortedCentis.length > 0;
  const bEligible = !b.withdrawn && b.sortedCentis.length > 0;
  if (aEligible !== bEligible) return aEligible ? -1 : 1;
  if (!aEligible) {
    // Ambos fuera: retirados con tiempo antes que sin tiempo, luego por mejor tiempo.
    if (a.sortedCentis.length === 0 || b.sortedCentis.length === 0) return b.sortedCentis.length - a.sortedCentis.length;
  }
  const len = Math.max(a.sortedCentis.length, b.sortedCentis.length);
  for (let i = 0; i < len; i++) {
    const ai = a.sortedCentis[i];
    const bi = b.sortedCentis[i];
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

export function rankRows(inputs: RankingInput[]): RankingRow[] {
  const rows: RankingRow[] = inputs.map((input) => {
    const times = timesOf(input.runs);
    return {
      ...input,
      bestMs: times[0] ?? null,
      sortedCentis: times.map(toCentis),
      position: null,
      tiedWithPrevious: false,
      eliminated: false,
    };
  });

  rows.sort(compareRows);

  // Los habilitados quedan primero, así que la posición es el índice + 1 (empates comparten posición: 1, 2, 2, 4).
  rows.forEach((row, i) => {
    if (row.withdrawn || row.sortedCentis.length === 0) return;
    const prev = rows[i - 1];
    if (prev && prev.position !== null && compareRows(prev, row) === 0) {
      row.position = prev.position;
      row.tiedWithPrevious = true;
    } else {
      row.position = i + 1;
    }
  });

  return rows;
}
