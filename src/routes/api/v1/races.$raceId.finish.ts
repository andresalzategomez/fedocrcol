import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";

/**
 * POST /api/v1/races/:raceId/finish
 * El Timer llama esto cuando el juez cierra la competencia (todas las
 * oleadas completadas). Pasa la carrera de `in_progress` a `finished`.
 *
 * Idempotente: si ya estaba `finished`, responde ok sin error.
 */
export const Route = createFileRoute("/api/v1/races/$raceId/finish")({
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

        if (race.status === "finished") return json({ status: "finished", already: true });
        if (race.status !== "in_progress") {
          return apiError(
            "INVALID_STATE",
            `La carrera debe estar en curso para poder finalizarla (estado actual: ${race.status})`,
            409,
          );
        }

        const { error } = await supa.from("events").update({ status: "finished" }).eq("id", race.id);
        if (error) return apiError("DB_ERROR", error.message, 500);

        return json({ status: "finished" });
      }),
    },
  },
});
