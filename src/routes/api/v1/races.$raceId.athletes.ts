import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, preflight, handler } from "../../../lib/server/api";

/** GET /api/v1/races/:raceId/athletes — inscritos (dorsal, oleada, categoría). */
export const Route = createFileRoute("/api/v1/races/$raceId/athletes")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: handler(async ({ request, params }) => {
        const { supa, leagueId } = await authenticate(request);

        const { data, error } = await supa
          .from("registrations")
          .select(
            "id, bib_number, athlete_name, athlete_document, athlete_gender, wave_id, ranking_category_id, status",
          )
          .eq("event_id", params.raceId)
          .eq("tenant_id", leagueId);

        if (error) return json({ error: { code: "DB_ERROR", message: error.message } }, 500);
        const regs = data ?? [];

        // Resolver nombre de categoría en un solo query.
        const catIds = [...new Set(regs.map((r) => r.ranking_category_id).filter(Boolean))];
        let catMap: Record<string, string> = {};
        if (catIds.length) {
          const { data: cats } = await supa
            .from("categories")
            .select("id, name")
            .in("id", catIds as string[]);
          catMap = Object.fromEntries((cats ?? []).map((c) => [c.id, c.name]));
        }

        return json(
          regs.map((r) => ({
            id: r.id,
            bib_number: r.bib_number,
            full_name: r.athlete_name,
            document: r.athlete_document,
            gender: r.athlete_gender,
            wave_id: r.wave_id,
            category: r.ranking_category_id ? (catMap[r.ranking_category_id] ?? null) : null,
            registration_status: r.status,
          })),
        );
      }),
    },
  },
});
