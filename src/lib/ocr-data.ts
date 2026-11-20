import { supabase } from "./supabase";
import {
  DEMO_EVENTS,
  DEMO_LEAGUES,
  DEMO_RANKING,
  type League,
  type OcrEvent,
  type RankingRow,
} from "@/data/demo";

/**
 * Capa de datos. Si el Supabase externo está configurado se consulta ahí;
 * de lo contrario la app corre con datos de demostración.
 */
export async function fetchLeagues(): Promise<League[]> {
  if (!supabase) return DEMO_LEAGUES;
  const { data, error } = await supabase.from("tenants").select("*").eq("status", "active").order("name");
  if (error || !data?.length) return DEMO_LEAGUES;
  return data as unknown as League[];
}

export async function fetchEvents(): Promise<OcrEvent[]> {
  if (!supabase) return DEMO_EVENTS;
  const { data, error } = await supabase
    .from("events")
    .select("*, categories:event_categories(*)")
    .order("date");
  if (error || !data?.length) return DEMO_EVENTS;
  // Una categoría con precio 0 aún no está lista: no se muestra ni se puede elegir hasta que el director le ponga precio.
  return (data as unknown as OcrEvent[]).map((e) => ({ ...e, categories: (e.categories ?? []).filter((c) => Number(c.price) > 0) }));
}

export async function fetchRanking(): Promise<RankingRow[]> {
  if (!supabase) return DEMO_RANKING;
  const { data, error } = await supabase.from("v_athlete_ranking").select("*").order("points", { ascending: false });
  if (error || !data?.length) return DEMO_RANKING;
  return data as unknown as RankingRow[];
}

/** Conteo público de inscritos activos (sin nombres ni datos de nadie), por carrera y categoría. */
export type RegistrationCounts = {
  total: number;
  byEvent: Map<string, number>;
  byCategory: Map<string, number>;
};

/**
 * Cuántos inscritos hay en uno o varios eventos, vía registration_counts_public. La lista de inscritos con nombres
 * NO es pública: los resultados se comparten por el enlace único de la carrera.
 */
export async function fetchRegistrationCounts(eventIds: string[]): Promise<RegistrationCounts> {
  const counts: RegistrationCounts = { total: 0, byEvent: new Map(), byCategory: new Map() };
  if (!supabase || eventIds.length === 0) return counts;
  const { data, error } = await supabase
    .from("registration_counts_public")
    .select("event_id, category_id, registered")
    .in("event_id", eventIds);
  if (error || !data) return counts;
  for (const r of data as { event_id: string; category_id: string; registered: number }[]) {
    counts.total += r.registered;
    counts.byEvent.set(r.event_id, (counts.byEvent.get(r.event_id) ?? 0) + r.registered);
    counts.byCategory.set(r.category_id, (counts.byCategory.get(r.category_id) ?? 0) + r.registered);
  }
  return counts;
}

/** Conteo público de atletas por liga (sin datos personales), vía league_athlete_counts. */
export async function fetchAthleteCountsByTenant(): Promise<Map<string, number>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase.from("league_athlete_counts").select("tenant_id, athlete_count");
  if (error || !data) return new Map();
  return new Map(data.map((r) => [r.tenant_id as string, r.athlete_count as number]));
}

export function computeLeagueStandings(ranking: RankingRow[], leagues: League[]) {
  return leagues
    .map((league) => {
      const rows = ranking
        .filter((r) => r.tenant_id === league.id)
        .sort((a, b) => b.points - a.points)
        .slice(0, 5);
      return {
        league,
        athletes: rows.length,
        qualified: rows.filter((r) => r.qualified).length,
        points: rows.reduce((sum, r) => sum + r.points, 0),
      };
    })
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points);
}

// La tarifa dinámica vive en lib/pricing.ts (la usa también el servidor al cobrar).
export { dynamicPrice } from "./pricing";

export function qrUrl(payload: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(payload)}`;
}
