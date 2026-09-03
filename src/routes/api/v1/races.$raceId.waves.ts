import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, preflight, handler } from "../../../lib/server/api";

/** GET /api/v1/races/:raceId/waves — oleadas de una carrera. */
export const Route = createFileRoute("/api/v1/races/$raceId/waves")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: handler(async ({ request, params }) => {
        const { supa, leagueId } = await authenticate(request);

        const { data, error } = await supa
          .from("waves")
          .select("id, wave_number, name, scheduled_time, started_at, status")
          .eq("event_id", params.raceId)
          .eq("tenant_id", leagueId)
          .order("wave_number", { ascending: true });

        if (error) return json({ error: { code: "DB_ERROR", message: error.message } }, 500);

        return json(
          (data ?? []).map((w) => ({
            id: w.id,
            wave_number: w.wave_number,
            name: w.name,
            planned_time: w.scheduled_time,
            start_time_ms: w.started_at ? new Date(w.started_at).getTime() : null,
            status: (w.status ?? "pending").toUpperCase(),
          })),
        );
      }),
    },
  },
});
