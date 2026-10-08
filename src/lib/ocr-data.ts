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

export type PublicRegistration = {
  id: string;
  event_id: string;
  tenant_id: string;
  category_id: string;
  category_name: string;
  athlete_name: string | null;
  bib_number: string | null;
  status: "pending" | "paid" | "cancelled";
  created_at: string;
};

/** Lista pública de inscritos (sin datos sensibles) para uno o varios eventos. */
export async function fetchPublicRegistrations(eventIds: string[]): Promise<PublicRegistration[]> {
  if (!supabase || eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("registrations_public")
    .select("*")
    .in("event_id", eventIds)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as unknown as PublicRegistration[];
}

/** Cuenta inscripciones activas por categoría, a partir de una lista ya cargada. */
export function countRegistrationsByCategory(registrations: PublicRegistration[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of registrations) map.set(r.category_id, (map.get(r.category_id) ?? 0) + 1);
  return map;
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
