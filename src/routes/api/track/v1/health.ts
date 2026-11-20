import { createFileRoute } from "@tanstack/react-router";
import { trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";

/** GET /api/track/v1/health: sin autenticación. La app lo consulta cada 30 s para mostrar conexión y latencia. */
export const Route = createFileRoute("/api/track/v1/health")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      GET: ({ request }) => trackJson(request, { status: "ok", time: new Date().toISOString(), api_version: TRACK_API_VERSION }),
    },
  },
});
