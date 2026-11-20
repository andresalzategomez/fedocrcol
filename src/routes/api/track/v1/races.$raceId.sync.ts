import { createFileRoute } from "@tanstack/react-router";
import { authenticateTrackRace } from "../../../../lib/server/track/auth";
import { ENGINE_VERSION, SUPPORTED_EVENT_TYPES } from "../../../../lib/server/track/engine-io";
import { trackError, trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";
import { syncBodySchema } from "../../../../lib/server/track/schemas";
import { processSync, SyncError } from "../../../../lib/server/track/sync";

/**
 * POST /api/track/v1/races/:raceId/sync  { device_id, events: [...] }  (máximo 200 eventos por lote)
 * Recibe los eventos locales del dispositivo ACTIVO, ordenados por device_seq. Responde:
 *   accepted: ids aceptados · duplicates: ids ya recibidos (reintentar no duplica) ·
 *   rejected: [{ client_event_id, code, message }] · next_expected_seq
 * Un hueco en device_seq rechaza el resto del lote con SEQUENCE_GAP; reenvía desde next_expected_seq.
 */
export const Route = createFileRoute("/api/track/v1/races/$raceId/sync")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      POST: trackHandler(async ({ request, params }) => {
        const ctx = await authenticateTrackRace(request, params["raceId"] ?? "");
        const parsed = syncBodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return trackError(request, "BAD_REQUEST", "Formato inválido: se espera { device_id, events: [...] } con máximo 200 eventos", 400);

        try {
          const result = await processSync(ctx, parsed.data.device_id, parsed.data.events);
          return trackJson(request, {
            ...result,
            engine_version: ENGINE_VERSION,
            supported_event_types: SUPPORTED_EVENT_TYPES,
            server_time: new Date().toISOString(),
            api_version: TRACK_API_VERSION,
          });
        } catch (e) {
          if (e instanceof SyncError) return trackError(request, e.code, e.message, e.status);
          throw e;
        }
      }),
    },
  },
});
