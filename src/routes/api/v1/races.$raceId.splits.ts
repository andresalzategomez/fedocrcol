import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, preflight, handler } from "../../../lib/server/api";

/** GET /api/v1/races/:raceId/splits — puntos de control (checkpoints) de la carrera. */
export const Route = createFileRoute("/api/v1/races/$raceId/splits")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: handler(async ({ request, params }) => {
        const { supa, leagueId } = await authenticate(request);

        const { data, error } = await supa
          .from("checkpoints")
          .select("id, name, ord, is_start, is_finish")
          .eq("event_id", params.raceId)
          .eq("tenant_id", leagueId)
          .order("ord", { ascending: true });

        if (error) return json({ error: { code: "DB_ERROR", message: error.message } }, 500);

        return json(
          (data ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            order: c.ord,
            is_start: c.is_start,
            is_finish: c.is_finish,
          })),
        );
      }),
    },
  },
});
