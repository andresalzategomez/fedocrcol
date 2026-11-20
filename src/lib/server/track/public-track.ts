import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vista pública (solo informativa) de una carrera TRACK. Se arma con las tablas que ya mantiene /sync
 * (track_stages, track_stage_entries, track_heats, track_heat_lanes), sin reprocesar eventos: es barata para muchos
 * espectadores. Entrega únicamente dorsal, nombre, tiempos y estados; nunca ids de inscripción, documento ni contacto.
 */

export type PublicRunCell =
  | { kind: "time"; ms: number }
  | { kind: "voided"; ms: number | null }
  | { kind: "did_not_run" }
  | { kind: "did_not_finish" }
  | { kind: "withdrawn" }
  | { kind: "pending" };

export interface PublicTrackEntry {
  bib: string | null;
  name: string | null;
  position: number | null;
  best_time_ms: number | null;
  /** active: compite · qualified: clasificó (instancia cerrada) · eliminated: no pasó (por tiempo, con la instancia cerrada, o perdió su duelo) · withdrawn: retirado */
  state: "active" | "qualified" | "eliminated" | "withdrawn";
  runs: PublicRunCell[];
}

export interface PublicTrackLane { bib: string | null; name: string | null; outcome: string; elapsed_ms: number | null }
export interface PublicTrackHeat {
  id: string; run_number: number; heat_number: number; kind: "regular" | "tiebreak";
  /** pending · started · awaiting_confirmation · confirmed · voided (anulada por lluvia) */
  status: string;
  lanes: PublicTrackLane[];
}
export interface PublicTrackStage {
  id: string; number: number; name: string; status: "pending" | "open" | "closed";
  runs_per_athlete: number; qualifiers_count: number | null; is_current: boolean;
  /** time: clasifican los mejores tiempos · duel: muerte súbita (pasa el ganador de cada oleada) */
  mode: "time" | "duel";
  entries: PublicTrackEntry[]; heats: PublicTrackHeat[];
}
export interface PublicTrackPayload {
  format: "track";
  event: { title: string; date: string; location: string; league: string | null; status: "upcoming" | "in_progress" | "finished"; status_label: string };
  categories: { id: string; name: string; stages: PublicTrackStage[] }[];
  /** Oleada en pista ahora mismo (si la hay). */
  live: { category: string; stage: string; run_number: number; heat_number: number; status: string; lanes: PublicTrackLane[] } | null;
  updated_at: string;
}

type EventRow = { id: string; title: string; date: string; location: string; status: string };

const CACHE_MS = 4000;
const cache = new Map<string, { at: number; value: PublicTrackPayload }>();

export async function loadPublicTrack(
  admin: SupabaseClient,
  event: EventRow,
  league: string | null,
  status: "upcoming" | "in_progress" | "finished",
  statusLabel: string,
): Promise<PublicTrackPayload> {
  const hit = cache.get(event.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const eid = event.id;
  const [{ data: cats }, { data: stages }, { data: entries }, { data: regs }, { data: heats }, { data: lanes }, { data: initial }] = await Promise.all([
    admin.from("event_categories").select("id, name").eq("event_id", eid).order("name"),
    admin.from("track_stages").select("id, category_id, stage_number, name, runs_per_athlete, qualifiers_count, status, mode").eq("event_id", eid).order("stage_number"),
    admin.from("track_stage_entries").select("stage_id, registration_id, rank, best_time_ms, status, qualified").eq("event_id", eid),
    admin.from("registrations").select("id, bib_number, athlete_name, category_id").eq("event_id", eid).eq("status", "paid").not("bib_number", "is", null),
    admin.from("track_heats").select("id, stage_id, run_number, heat_number, heat_type, status").eq("event_id", eid),
    admin.from("track_heat_lanes").select("heat_id, lane, registration_id, elapsed_ms, outcome").eq("event_id", eid),
    admin.from("track_initial_heats").select("id, stage_id, heat_number, left_registration_id, right_registration_id").eq("event_id", eid),
  ]);

  const who = new Map((regs ?? []).map((r) => [r.id as string, { bib: r.bib_number as string, name: (r.athlete_name as string | null) ?? null, categoryId: r.category_id as string }]));
  const lane = (registrationId: string | null, outcome: string, elapsed: number | null): PublicTrackLane | null =>
    registrationId ? { bib: who.get(registrationId)?.bib ?? null, name: who.get(registrationId)?.name ?? null, outcome, elapsed_ms: elapsed } : null;

  // Carriles por oleada
  const lanesByHeat = new Map<string, { lane: string; registrationId: string; elapsed: number | null; outcome: string }[]>();
  for (const l of lanes ?? []) {
    const arr = lanesByHeat.get(l.heat_id as string) ?? [];
    arr.push({ lane: l.lane as string, registrationId: l.registration_id as string, elapsed: (l.elapsed_ms as number | null) ?? null, outcome: l.outcome as string });
    lanesByHeat.set(l.heat_id as string, arr);
  }

  const hasHeats = (heats ?? []).length > 0;
  type HeatRow = { id: string; stageId: string; run: number; num: number; kind: "regular" | "tiebreak"; status: string; ls: { lane: string; registrationId: string; elapsed: number | null; outcome: string }[] };
  const heatRows: HeatRow[] = hasHeats
    ? (heats ?? []).map((h) => ({
        id: h.id as string, stageId: h.stage_id as string, run: h.run_number as number, num: h.heat_number as number,
        kind: ((h.heat_type as string) === "tiebreak" ? "tiebreak" : "regular") as "regular" | "tiebreak", status: h.status as string,
        ls: (lanesByHeat.get(h.id as string) ?? []).sort((a, b) => a.lane.localeCompare(b.lane)),
      }))
    // Antes de que empiece la carrera: las oleadas iniciales (instancia 1, salida 1), todas pendientes.
    : (initial ?? []).map((h) => ({
        id: h.id as string, stageId: h.stage_id as string, run: 1, num: h.heat_number as number, kind: "regular" as const, status: "pending",
        ls: [
          { lane: "left", registrationId: h.left_registration_id as string, elapsed: null, outcome: "pending" },
          ...(h.right_registration_id ? [{ lane: "right", registrationId: h.right_registration_id as string, elapsed: null, outcome: "pending" }] : []),
        ],
      }));

  const stageList = stages ?? [];
  const categories = (cats ?? [])
    .map((c) => {
      const catStages = stageList.filter((s) => s.category_id === c.id);
      const firstOpen = catStages.find((s) => s.status === "open") ?? catStages.find((s) => s.status === "pending") ?? catStages[catStages.length - 1];
      const out: PublicTrackStage[] = catStages.map((s) => {
        const sid = s.id as string;
        const stageStatus = s.status as "pending" | "open" | "closed";
        const qualifiersCount = (s.qualifiers_count as number | null) ?? null;
        const hs = heatRows
          .filter((h) => h.stageId === sid)
          .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "regular" ? -1 : 1) || a.run - b.run || a.num - b.num);

        // Tiempo de cada atleta por salida: solo oleadas confirmadas (o anuladas por lluvia, que se muestran como tales).
        const runCell = new Map<string, PublicRunCell>();
        for (const h of hs) {
          if (h.kind !== "regular") continue;
          for (const l of h.ls) {
            const key = `${l.registrationId}|${h.run}`;
            if (h.status === "voided") runCell.set(key, { kind: "voided", ms: l.elapsed });
            else if (h.status === "confirmed") {
              runCell.set(key, l.outcome === "time" && l.elapsed != null ? { kind: "time", ms: l.elapsed }
                : l.outcome === "did_not_run" ? { kind: "did_not_run" }
                : l.outcome === "did_not_finish" ? { kind: "did_not_finish" }
                : l.outcome === "withdrawn" ? { kind: "withdrawn" } : { kind: "pending" });
            }
          }
        }
        const runsOf = (regId: string): PublicRunCell[] =>
          Array.from({ length: s.runs_per_athlete as number }, (_, i) => runCell.get(`${regId}|${i + 1}`) ?? { kind: "pending" as const });

        const rows = (entries ?? []).filter((e) => e.stage_id === sid);
        // Antes de empezar: los inscritos de la categoría, sin posición.
        const fallback = rows.length === 0 && (s.stage_number as number) === 1 && !hasHeats;
        const entryList: PublicTrackEntry[] = fallback
          ? [...who.entries()].filter(([, w]) => w.categoryId === c.id).map(([id, w]) => ({ bib: w.bib, name: w.name, position: null, best_time_ms: null, state: "active" as const, runs: runsOf(id) }))
          : rows.map((e) => {
              const reg = e.registration_id as string;
              const withdrawn = (e.status as string) === "withdrawn";
              const state: PublicTrackEntry["state"] = withdrawn ? "withdrawn"
                : (e.status as string) === "eliminated" ? "eliminated" // perdió su duelo: conserva posición y tiempo
                : stageStatus === "closed" && (e.qualified as boolean) ? "qualified"
                : stageStatus === "closed" && qualifiersCount != null ? "eliminated" : "active";
              return { bib: who.get(reg)?.bib ?? null, name: who.get(reg)?.name ?? null, position: (e.rank as number | null) ?? null, best_time_ms: (e.best_time_ms as number | null) ?? null, state, runs: runsOf(reg) };
            });
        entryList.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || (a.bib ?? "").localeCompare(b.bib ?? ""));

        return {
          id: sid, number: s.stage_number as number, name: s.name as string, status: stageStatus,
          runs_per_athlete: s.runs_per_athlete as number, qualifiers_count: qualifiersCount, is_current: s.id === firstOpen?.id,
          mode: (s.mode as string) === "duel" ? "duel" : "time",
          entries: entryList,
          heats: hs.map((h) => ({
            id: h.id, run_number: h.run, heat_number: h.num, kind: h.kind, status: h.status,
            lanes: h.ls.map((l) => lane(l.registrationId, h.status === "voided" ? "voided" : l.outcome, l.elapsed)).filter((x): x is PublicTrackLane => x !== null),
          })),
        };
      });
      return { id: c.id as string, name: c.name as string, stages: out };
    })
    .filter((c) => c.stages.length > 0);

  // Oleada en pista ahora
  let live: PublicTrackPayload["live"] = null;
  for (const c of categories) {
    for (const s of c.stages) {
      const h = s.heats.find((x) => x.status === "started" || x.status === "awaiting_confirmation");
      if (h) live = { category: c.name, stage: s.name, run_number: h.run_number, heat_number: h.heat_number, status: h.status, lanes: h.lanes };
    }
  }

  const value: PublicTrackPayload = {
    format: "track",
    event: { title: event.title, date: event.date, location: event.location, league, status, status_label: statusLabel },
    categories, live, updated_at: new Date().toISOString(),
  };
  cache.set(event.id, { at: Date.now(), value });
  return value;
}
