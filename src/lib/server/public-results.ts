import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { bogotaToday } from "../payment-window";
import { competitionRanks, ranksByGroup } from "../results-ranking";
import { loadPublicTrack, type PublicTrackPayload } from "./track/public-track";

/** Código secreto del enlace público de resultados de una carrera (96 bits, URL-safe). */
export function newResultsToken(): string {
  return randomBytes(12).toString("hex");
}

export type PublicRaceStatus = "upcoming" | "in_progress" | "finished";
const STATUS_LABEL: Record<PublicRaceStatus, string> = { upcoming: "Por iniciar", in_progress: "En curso", finished: "Finalizada" };

export interface PublicResultEntry {
  bib: string | null;
  name: string | null;
  gender: string | null;
  category_id: string | null;
  wave_id: string | null;
  duration_ms: number | null;
  status: string;
  rank_overall: number | null;
  rank_category: number | null;
  rank_wave: number | null;
}

export interface PublicResultsPayload {
  format: "standard";
  event: { title: string; date: string; location: string; league: string | null; status: PublicRaceStatus; status_label: string };
  categories: { id: string; name: string }[];
  waves: { id: string; name: string }[];
  entries: PublicResultEntry[];
  updated_at: string;
}

/**
 * ¿Se puede ver públicamente? La carrera debe ser pública y estar publicada y aprobada (o en curso / finalizada), y
 * solo hasta el final del día de la carrera (hora de Colombia). Si no, se responde como si no existiera.
 */
export function isPubliclyViewable(
  event: { visibility: string | null; published: boolean | null; status: string; date: string; race_format: string | null },
  now: Date = new Date(),
): boolean {
  if (event.visibility !== "public" || !event.published) return false;
  if (!["approved", "in_progress", "finished"].includes(event.status)) return false;
  return bogotaToday(now) <= event.date;
}

/**
 * Arma los resultados públicos de una carrera estándar a partir de su código. Devuelve null si el código no existe
 * o la carrera no se puede ver. Entrega solo lo mínimo: dorsal, nombre, categoría, oleada, tiempo, estado y posiciones.
 */
export async function loadPublicResults(admin: SupabaseClient, token: string, now: Date = new Date()): Promise<PublicResultsPayload | PublicTrackPayload | null> {
  if (!/^[0-9a-f]{24}$/i.test(token)) return null;
  const { data: link } = await admin.from("event_results_links").select("event_id").eq("token", token).maybeSingle();
  if (!link) return null;

  const { data: event } = await admin
    .from("events")
    .select("id, title, date, location, status, visibility, published, race_format, tenant_id")
    .eq("id", link.event_id as string)
    .maybeSingle();
  if (!event || !isPubliclyViewable(event as never, now)) return null;

  const status: PublicRaceStatus = event.status === "in_progress" ? "in_progress" : event.status === "finished" ? "finished" : "upcoming";

  const [{ data: tenant }, { data: categories }, { data: waves }] = await Promise.all([
    admin.from("tenants").select("name").eq("id", event.tenant_id as string).maybeSingle(),
    admin.from("event_categories").select("id, name").eq("event_id", event.id as string).order("name"),
    admin.from("waves").select("id, name, wave_number").eq("event_id", event.id as string).order("wave_number"),
  ]);

  // Carrera TRACK: vista informativa por instancia y oleada, alimentada por lo que informa Timer_track.
  if (event.race_format === "track") {
    return loadPublicTrack(admin, event as never, (tenant?.name as string | undefined) ?? null, status, STATUS_LABEL[status]);
  }

  let entries: PublicResultEntry[] = [];
  if (status !== "upcoming") {
    const { data: results } = await admin
      .from("results")
      .select("registration_id, duration_ms, status")
      .eq("event_id", event.id as string);
    const regIds = (results ?? []).map((r) => r.registration_id as string).filter(Boolean);
    const { data: regs } = regIds.length
      ? await admin.from("registrations").select("id, bib_number, athlete_name, athlete_gender, category_id, wave_id").in("id", regIds)
      : { data: [] as { id: string; bib_number: string | null; athlete_name: string | null; athlete_gender: string | null; category_id: string | null; wave_id: string | null }[] };
    const regById = new Map((regs ?? []).map((r) => [r.id as string, r]));

    const rows = (results ?? []).map((r) => {
      const reg = regById.get(r.registration_id as string);
      return {
        bib: (reg?.bib_number as string | null) ?? null,
        name: (reg?.athlete_name as string | null) ?? null,
        gender: (reg?.athlete_gender as string | null) ?? null,
        category_id: (reg?.category_id as string | null) ?? null,
        wave_id: (reg?.wave_id as string | null) ?? null,
        duration_ms: (r.duration_ms as number | null) ?? null,
        status: (r.status as string) ?? "finished",
      };
    });
    const overall = competitionRanks(rows);
    const byCategory = ranksByGroup(rows, (r) => r.category_id);
    const byWave = ranksByGroup(rows, (r) => r.wave_id);
    entries = rows
      .map((r, i) => ({ ...r, rank_overall: overall[i] ?? null, rank_category: byCategory[i] ?? null, rank_wave: byWave[i] ?? null }))
      .sort((a, b) =>
        (a.rank_overall ?? Number.MAX_SAFE_INTEGER) - (b.rank_overall ?? Number.MAX_SAFE_INTEGER) || (a.bib ?? "").localeCompare(b.bib ?? ""));
  }

  return {
    format: "standard",
    event: {
      title: event.title as string,
      date: event.date as string,
      location: event.location as string,
      league: (tenant?.name as string | undefined) ?? null,
      status,
      status_label: STATUS_LABEL[status],
    },
    categories: (categories ?? []).map((c) => ({ id: c.id as string, name: c.name as string })),
    waves: (waves ?? []).map((w) => ({ id: w.id as string, name: (w.name as string | null) ?? `Oleada ${w.wave_number ?? ""}`.trim() })),
    entries,
    updated_at: new Date().toISOString(),
  };
}
