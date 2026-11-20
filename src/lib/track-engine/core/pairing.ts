/**
 * Armado de parejas (reglas-negocio, apartado 4). Máximo 2 atletas por oleada; puede salir 1.
 */

export interface PairDraft {
  left: string;
  right: string | null;
}

export type Rng = () => number;

/** Generador pseudoaleatorio reproducible, para pruebas y datos de prueba. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates sin modificar la lista original. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** [a, b, c, d, e] → a-b, c-d, e solo. */
export function pairSequential(ids: readonly string[]): PairDraft[] {
  const pairs: PairDraft[] = [];
  for (let i = 0; i < ids.length; i += 2) pairs.push({ left: ids[i]!, right: ids[i + 1] ?? null });
  return pairs;
}

/**
 * Aleatoria por categoría. Con cantidad impar, el último sale solo.
 * El servidor nunca la necesita: las parejas viajan ya armadas dentro de PAIRING_SET.
 */
export function randomPairing(ids: readonly string[], rng: Rng): PairDraft[] {
  return pairSequential(shuffle(ids, rng));
}

/**
 * Instancias siguientes: primero contra último, segundo contra penúltimo...
 * `rankedIds` va en orden de clasificación. Con cantidad impar, el del centro sale solo, al final.
 */
export function seededPairing(rankedIds: readonly string[]): PairDraft[] {
  const n = rankedIds.length;
  const pairs: PairDraft[] = [];
  for (let i = 0; i < Math.floor(n / 2); i++) pairs.push({ left: rankedIds[i]!, right: rankedIds[n - 1 - i]! });
  if (n % 2 === 1) pairs.push({ left: rankedIds[Math.floor(n / 2)]!, right: null });
  return pairs;
}

/**
 * "Igual que la anterior": mismas parejas, solo con atletas habilitados.
 * Si un compañero ya no corre (retirado), el otro sale solo. Habilitados sin pareja previa se emparejan entre sí.
 */
export function sameAsPrevious(previous: readonly PairDraft[], eligible: ReadonlySet<string>): PairDraft[] {
  const used = new Set<string>();
  const pairs: PairDraft[] = [];
  for (const p of previous) {
    const members = [p.left, p.right].filter((r): r is string => !!r && eligible.has(r) && !used.has(r));
    members.forEach((m) => used.add(m));
    if (members.length > 0) pairs.push({ left: members[0]!, right: members[1] ?? null });
  }
  const leftovers = [...eligible].filter((r) => !used.has(r));
  return [...pairs, ...pairSequential(leftovers)];
}

/**
 * Intercambia la posición de dos atletas entre oleadas.
 * Ejemplo: A-B y C-D, intercambiar B y C → A-C y B-D. El compañero libre queda reacomodado.
 */
export function swapAthletes(pairs: readonly PairDraft[], a: string, b: string): PairDraft[] {
  const swap = (r: string | null) => (r === a ? b : r === b ? a : r);
  return pairs.map((p) => ({ left: swap(p.left)!, right: swap(p.right) }));
}
