import { createFileRoute } from "@tanstack/react-router";
import { authenticateTrackRace } from "../../../../lib/server/track/auth";
import { trackError, trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";
import { activateBodySchema } from "../../../../lib/server/track/schemas";
import { activateDevice, getActiveDevice, SyncError } from "../../../../lib/server/track/sync";

/**
 * POST /api/track/v1/races/:raceId/device/activate  { device_id, takeover_note? }
 * Activa el dispositivo para la carrera. Solo hay UN dispositivo activo: si ya hay otro, hay que escribir una
 * observación (takeover_note) para reemplazarlo; de lo contrario responde 409 DEVICE_ALREADY_ACTIVE. Los eventos del
 * dispositivo reemplazado se rechazan con DEVICE_NOT_ACTIVE (solo se recuperan con un respaldo).
 */
export const Route = createFileRoute("/api/track/v1/races/$raceId/device/activate")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      POST: trackHandler(async ({ request, params }) => {
        const ctx = await authenticateTrackRace(request, params["raceId"] ?? "");
        const parsed = activateBodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return trackError(request, "BAD_REQUEST", "Se espera { device_id, takeover_note? }", 400);

        try {
          const device = await activateDevice(ctx, parsed.data.device_id, parsed.data.takeover_note);
          return trackJson(request, { ok: true, ...device, server_time: new Date().toISOString(), api_version: TRACK_API_VERSION });
        } catch (e) {
          if (e instanceof SyncError) {
            if (e.code === "DEVICE_ALREADY_ACTIVE") {
              const active = await getActiveDevice(ctx);
              return trackJson(request, {
                error: { code: e.code, message: e.message },
                active_device: active ? { device_id: active.device_id, activated_at: active.activated_at, last_synced_at: active.last_synced_at } : null,
                server_time: new Date().toISOString(),
                api_version: TRACK_API_VERSION,
              }, e.status);
            }
            return trackError(request, e.code, e.message, e.status);
          }
          throw e;
        }
      }),
    },
  },
});
