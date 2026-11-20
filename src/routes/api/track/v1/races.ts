import { createFileRoute } from "@tanstack/react-router";
import { serviceClient } from "../../../../lib/server/supabase-server";
import { authenticateTrackUser } from "../../../../lib/server/track/auth";
import { trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";

/**
 * GET /api/track/v1/races
 * Carreras track que el usuario puede operar y que ya están aprobadas (o en curso): el juez asignado ve las suyas, el
 * administrador de la liga las de su liga y la federación todas.
 */
export const Route = createFileRoute("/api/track/v1/races")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      GET: trackHandler(async ({ request }) => {
        const user = await authenticateTrackUser(request);
        let query = serviceClient()
          .from("events")
          .select("id, title, date, location, status, tenant_id")
          .eq("race_format", "track")
          .in("status", ["approved", "in_progress"])
          .order("date", { ascending: false });
        if (user.role === "judge") query = query.eq("track_judge_id", user.userId);
        else if (user.role === "admin") query = query.eq("tenant_id", user.tenantId ?? "00000000-0000-0000-0000-000000000000");

        const { data, error } = await query;
        if (error) return trackJson(request, { error: { code: "DB_ERROR", message: error.message } }, 500);
        return trackJson(request, {
          races: (data ?? []).map((e) => ({ id: e.id, name: e.title, date: e.date, location: e.location, status: e.status, league_id: e.tenant_id })),
          server_time: new Date().toISOString(),
          api_version: TRACK_API_VERSION,
        });
      }),
    },
  },
});
