import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";

/**
 * POST /api/v1/races/:raceId/start
 * El Timer llama esto cuando el juez inicia la competencia en pista
 * (típicamente al disparar la primera oleada). Pasa la carrera a
 * `in_progress`, lo que congela su contenido (checkpoints/oleadas/
 * categorías/inscritos) en el panel — ver `enforce_events_write_rules()`.
 *
 * Idempotente: si ya estaba `in_progress`, responde ok sin error (el
 * Timer es offline-first y puede reintentar el mismo llamado).
 */
export const Route = createFileRoute("/api/v1/races/$raceId/start")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request, params }) => {
        const { supa, leagueId } = await authenticate(request);

        const { data: race, error: findErr } = await supa
          .from("events")
          .select("id, status")
          .eq("id", params.raceId)
          .eq("tenant_id", leagueId)
          .maybeSingle();
        if (findErr) return apiError("DB_ERROR", findErr.message, 500);
        if (!race) return apiError("NOT_FOUND", "Carrera no encontrada", 404);

        if (race.status === "in_progress") return json({ status: "in_progress", already: true });
        if (race.status !== "approved") {
          return apiError(
            "INVALID_STATE",
            `La carrera debe estar aprobada para poder iniciarla (estado actual: ${race.status})`,
            409,
          );
        }

        const { error } = await supa.from("events").update({ status: "in_progress" }).eq("id", race.id);
        if (error) return apiError("DB_ERROR", error.message, 500);

        return json({ status: "in_progress" });
      }),
    },
  },
});
