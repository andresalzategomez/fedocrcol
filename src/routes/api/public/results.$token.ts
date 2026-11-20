import { createFileRoute } from "@tanstack/react-router";
import { serviceClient } from "../../../lib/server/supabase-server";
import { loadPublicResults } from "../../../lib/server/public-results";
import { apiError, handler, preflight } from "../../../lib/server/api";

/**
 * GET /api/public/results/:token — resultados públicos de una carrera, por su enlace único.
 *
 * Sin sesión. Responde 404 (sin distinguir el motivo) si el código no existe, la carrera es privada, aún no está
 * aprobada o ya pasó el día de la carrera (hora de Colombia): la página pública redirige entonces al inicio.
 * Entrega solo dorsal, nombre, categoría, oleada, tiempo, estado y posiciones; nunca documento ni datos de contacto.
 */
export const Route = createFileRoute("/api/public/results/$token")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: handler(async ({ params }) => {
        const payload = await loadPublicResults(serviceClient(), params["token"] ?? "");
        if (!payload) return apiError("NOT_FOUND", "Resultados no disponibles", 404);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
        });
      }),
    },
  },
});
