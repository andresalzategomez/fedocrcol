import type { EventResult } from "./admin-api";

/** Compartido entre el panel (admin) y la página pública de resultados en vivo. */
export const RESULT_STATUS_LABEL: Record<EventResult["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  finished: { label: "OK", variant: "default" },
  dnf: { label: "DNF", variant: "destructive" },
  dsq: { label: "DSQ", variant: "destructive" },
  dns: { label: "DNS", variant: "secondary" },
};

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Ordena por tiempo (OK primero) y numera solo a los que terminaron con tiempo — igual que hace recalculate_event_positions, pero recalculado en el navegador para poder aplicarlo a cualquier subconjunto (oleada/categoría). */
export function rankResults(list: EventResult[]): (EventResult & { rank: number | null })[] {
  const finished = list
    .filter((r) => r.status === "finished" && r.duration_ms != null)
    .sort((a, b) => (a.duration_ms as number) - (b.duration_ms as number));
  const rankById = new Map(finished.map((r, i) => [r.id, i + 1]));
  const others = list.filter((r) => !rankById.has(r.id));
  return [
    ...finished.map((r) => ({ ...r, rank: rankById.get(r.id) as number })),
    ...others.map((r) => ({ ...r, rank: null })),
  ];
}
