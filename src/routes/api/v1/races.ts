import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, preflight, handler } from "../../../lib/server/api";

/** GET /api/v1/races?league_id=X — carreras (events) de la liga del token. */
export const Route = createFileRoute("/api/v1/races")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: handler(async ({ request }) => {
        const { supa, leagueId } = await authenticate(request);

        const { data, error } = await supa
          .from("events")
          .select("id, title, date, location, published")
          .eq("tenant_id", leagueId)
          .order("date", { ascending: false });

        if (error) return json({ error: { code: "DB_ERROR", message: error.message } }, 500);

        return json(
          (data ?? []).map((e) => ({
            id: e.id,
            name: e.title,
            date: e.date,
            location: e.location,
            status: e.published ? "PUBLISHED" : "DRAFT",
          })),
        );
      }),
    },
  },
});
