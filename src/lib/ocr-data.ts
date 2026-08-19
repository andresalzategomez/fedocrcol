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
  const { data, error } = await supabase.from("tenants").select("*").order("name");
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
  return data as unknown as OcrEvent[];
}

export async function fetchRanking(): Promise<RankingRow[]> {
  if (!supabase) return DEMO_RANKING;
  const { data, error } = await supabase.from("v_athlete_ranking").select("*").order("points", { ascending: false });
  if (error || !data?.length) return DEMO_RANKING;
  return data as unknown as RankingRow[];
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

/** Tarifa dinámica por fecha (preventa → tarifa plena). */
export function dynamicPrice(basePrice: number, eventDate: string) {
  const days = Math.ceil((new Date(`${eventDate}T12:00:00`).getTime() - Date.now()) / 86400000);
  if (days > 90) return { price: Math.round(basePrice * 0.75), stage: "Preventa 1 (-25%)" };
  if (days > 45) return { price: Math.round(basePrice * 0.85), stage: "Preventa 2 (-15%)" };
  if (days > 15) return { price: Math.round(basePrice * 0.95), stage: "Preventa 3 (-5%)" };
  return { price: basePrice, stage: "Tarifa plena" };
}

export function qrUrl(payload: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(payload)}`;
}
