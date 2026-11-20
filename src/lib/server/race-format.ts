import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "./api";

/**
 * /api/v1 es la API de FedOCR Timer (carreras OCR estándar). Las carreras tipo TRACK
 * (events.race_format = 'track') se cronometran por /api/track/v1: por /api/v1 ni se ven
 * ni se pueden operar, y se responde igual que si la carrera no existiera.
 *
 * Devuelve la respuesta de error si la carrera es track; null si es estándar o si no existe
 * (en ese caso el endpoint decide cómo responder, como hacía antes).
 */
export async function rejectIfTrackRace(supa: SupabaseClient, raceId: string): Promise<Response | null> {
  const { data, error } = await supa.from("events").select("race_format").eq("id", raceId).maybeSingle();
  if (error) return apiError("DB_ERROR", error.message, 500);
  if (data?.race_format === "track") return apiError("NOT_FOUND", "Carrera no encontrada", 404);
  return null;
}
