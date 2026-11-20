import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { anonClient, serviceClient } from "../../../../lib/server/supabase-server";
import { trackError, trackHandler, trackJson, trackPreflight, TRACK_API_VERSION } from "../../../../lib/server/track/http";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/** Roles que pueden operar carreras track. */
const TRACK_ROLES = new Set(["judge", "admin", "superadmin"]);

/**
 * POST /api/track/v1/auth/login  { email, password }
 * El juez (o el administrador de la liga / la federación) inicia sesión. El token (JWT de Supabase Auth) dura 1 hora
 * y el refresh_token rota en cada uso: la app debe guardar siempre el último.
 */
export const Route = createFileRoute("/api/track/v1/auth/login")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => trackPreflight(request),
      POST: trackHandler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return trackError(request, "BAD_REQUEST", "email y password son requeridos", 400);

        const { data, error } = await anonClient().auth.signInWithPassword(parsed.data);
        if (error || !data.session) return trackError(request, "INVALID_CREDENTIALS", "Credenciales inválidas", 401);

        const { data: profile } = await serviceClient().from("profiles").select("role, tenant_id, full_name").eq("id", data.user.id).maybeSingle();
        const role = (profile?.role as string | undefined) ?? "athlete";
        if (!TRACK_ROLES.has(role)) return trackError(request, "FORBIDDEN_ROLE", "Tu cuenta no puede operar carreras track", 403);

        return trackJson(request, {
          token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in,
          user: { id: data.user.id, name: (profile?.full_name as string | null) ?? null, role, league_id: (profile?.tenant_id as string | null) ?? null },
          server_time: new Date().toISOString(),
          api_version: TRACK_API_VERSION,
        });
      }),
    },
  },
});
