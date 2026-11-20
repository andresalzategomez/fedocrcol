import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { anonClient } from "../../../../lib/server/supabase-server";
import { trackUserInfo } from "../../../../lib/server/track/auth";
import { trackError, trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";

const bodySchema = z.object({ refresh_token: z.string().min(10) });

/**
 * POST /api/track/v1/auth/refresh  { refresh_token }
 * Renueva la sesión. Cada refresh devuelve un refresh_token nuevo y la app debe guardar siempre el último. Los anteriores
 * siguen aceptándose en este proyecto (medido), así que reintentar con el mismo token es seguro. Requiere conexión.
 */
export const Route = createFileRoute("/api/track/v1/auth/refresh")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      POST: trackHandler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return trackError(request, "BAD_REQUEST", "Falta el refresh_token", 400);

        const { data, error } = await anonClient().auth.refreshSession({ refresh_token: parsed.data.refresh_token });
        if (error || !data.session) return trackError(request, "INVALID_REFRESH_TOKEN", "La sesión no se pudo renovar: inicia sesión de nuevo", 401);

        const { user, league } = await trackUserInfo(data.session.user.id);
        return trackJson(request, {
          token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in,
          user,
          league,
          server_time: new Date().toISOString(),
          api_version: TRACK_API_VERSION,
        });
      }),
    },
  },
});
