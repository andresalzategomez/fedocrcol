/**
 * Tiempos: se guardan en milisegundos y se muestran y comparan en centésimas.
 * Las centésimas se truncan, no se redondean (criterio usual de cronometraje).
 */

export const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;

export const toCentis = (ms: number): number => Math.floor(ms / 10);

export function isValidElapsed(ms: number): boolean {
  return Number.isInteger(ms) && ms > 0 && ms < MAX_ELAPSED_MS;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** 32481 → "0:32.48"; 3723450 → "1:02:03.45". */
export function formatElapsed(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const centis = toCentis(ms);
  const cc = centis % 100;
  const totalSec = Math.floor(centis / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}.${pad(cc)}` : `${m}:${pad(s)}.${pad(cc)}`;
}
