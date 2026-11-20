import { createFileRoute } from "@tanstack/react-router";
import { authenticateTrackRace } from "../../../../lib/server/track/auth";
import { ENGINE_VERSION, SUPPORTED_EVENT_TYPES, replayRace, stateToJson } from "../../../../lib/server/track/engine-io";
import { trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";
import { getActiveDevice } from "../../../../lib/server/track/sync";

/**
 * GET /api/track/v1/races/:raceId/package
 * Todo lo que la app necesita para operar la carrera sin conexión: configuración (categorías, instancias), atletas
 * (SOLO dorsal, nombre y categoría: nunca documento ni datos médicos), parejas iniciales y el estado actual. Solo
 * entran inscritos con pago confirmado y dorsal.
 */
export const Route = createFileRoute("/api/track/v1/races/$raceId/package")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      GET: trackHandler(async ({ request, params }) => {
        const ctx = await authenticateTrackRace(request, params["raceId"] ?? "");
        const { config, names, state } = await replayRace(ctx.admin, ctx.race.id);
        const active = await getActiveDevice(ctx);

        return trackJson(request, {
          api_version: TRACK_API_VERSION,
          engine_version: ENGINE_VERSION,
          supported_event_types: SUPPORTED_EVENT_TYPES,
          server_time: new Date().toISOString(),
          race: { id: ctx.race.id, name: ctx.race.title, date: ctx.race.date, location: ctx.race.location, status: ctx.race.status },
          categories: config.categories.map((c) => ({
            id: c.id,
            name: c.name,
            athletes: c.athletes.map((a) => ({ registration_id: a.registrationId, bib: a.bib, name: a.name })),
            stages: c.stages.map((s) => ({ id: s.id, stage_number: s.stageNumber, name: s.name, runs_per_athlete: s.runsPerAthlete, qualifiers_count: s.qualifiersCount })),
          })),
          initial_heats: config.initialHeats.map((h) => ({
            id: h.id, stage_id: h.stageId, run_number: h.runNumber, heat_number: h.heatNumber, left: h.left, right: h.right,
          })),
          state: stateToJson(state, names),
          active_device: active ? { device_id: active.device_id, activated_at: active.activated_at, last_synced_at: active.last_synced_at } : null,
        });
      }),
    },
  },
});
