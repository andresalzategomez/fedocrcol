/**
 * Posiciones de una carrera estándar con empates: los que hacen EXACTAMENTE el mismo tiempo comparten
 * posición y la siguiente se salta (1, 1, 3). Solo clasifican los que terminaron con tiempo (status
 * "finished" y duration_ms); el resto queda sin posición (null).
 *
 * Es una función pura (sin navegador ni base de datos) para poder probarla y usarla en el servidor.
 */
export interface RankableResult {
  duration_ms: number | null;
  status: string;
}

/** Devuelve, para cada elemento (mismo orden de entrada), su posición o null si no clasifica. */
export function competitionRanks<T extends RankableResult>(items: T[]): (number | null)[] {
  const ranks: (number | null)[] = new Array(items.length).fill(null);
  const finished = items
    .map((r, index) => ({ index, ms: r.duration_ms }))
    .filter((x): x is { index: number; ms: number } => items[x.index]!.status === "finished" && x.ms != null)
    .sort((a, b) => a.ms - b.ms || a.index - b.index);

  let rank = 0;
  let previous: number | null = null;
  finished.forEach((x, i) => {
    if (previous === null || x.ms !== previous) rank = i + 1;
    ranks[x.index] = rank;
    previous = x.ms;
  });
  return ranks;
}

/** Posiciones dentro de cada grupo (por ejemplo por categoría u oleada): cada grupo se numera aparte. */
export function ranksByGroup<T extends RankableResult>(items: T[], groupOf: (item: T) => string | null): (number | null)[] {
  const result: (number | null)[] = new Array(items.length).fill(null);
  const groups = new Map<string, number[]>();
  items.forEach((item, i) => {
    const g = groupOf(item);
    if (g == null) return;
    const list = groups.get(g) ?? [];
    list.push(i);
    groups.set(g, list);
  });
  for (const indexes of groups.values()) {
    const ranks = competitionRanks(indexes.map((i) => items[i]!));
    indexes.forEach((original, k) => { result[original] = ranks[k] ?? null; });
  }
  return result;
}
