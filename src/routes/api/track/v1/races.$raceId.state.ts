import { createFileRoute } from "@tanstack/react-router";
import { authenticateTrackRace } from "../../../../lib/server/track/auth";
import { ENGINE_VERSION, replayRace, stateToJson } from "../../../../lib/server/track/engine-io";
import { trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";
import { getActiveDevice } from "../../../../lib/server/track/sync";

/**
 * GET /api/track/v1/races/:raceId/state
 * Estado consolidado de la carrera (oleadas, tiempos, retiros y clasificación por instancia), calculado por el servidor
 * con el motor compartido a partir de los eventos aceptados. La app lo usa para reconciliarse con el servidor.
 */
export const Route = createFileRoute("/api/track/v1/races/$raceId/state")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      GET: trackHandler(async ({ request, params }) => {
        const ctx = await authenticateTrackRace(request, params["raceId"] ?? "");
        const { names, state, events } = await replayRace(ctx.admin, ctx.race.id);
        const active = await getActiveDevice(ctx);
        const lastSeq = new Map<string, number>();
        const { data: seqRows } = await ctx.admin.from("track_events").select("device_id, device_seq").eq("event_id", ctx.race.id);
        (seqRows ?? []).forEach((r) => lastSeq.set(r.device_id as string, Math.max(lastSeq.get(r.device_id as string) ?? 0, r.device_seq as number)));

        return trackJson(request, {
          api_version: TRACK_API_VERSION,
          engine_version: ENGINE_VERSION,
          server_time: new Date().toISOString(),
          race: { id: ctx.race.id, name: ctx.race.title, status: ctx.race.status },
          accepted_events: events.length,
          state: stateToJson(state, names),
          active_device: active ? { device_id: active.device_id, activated_at: active.activated_at, last_synced_at: active.last_synced_at } : null,
          last_device_seq: Object.fromEntries(lastSeq),
        });
      }),
    },
  },
});
