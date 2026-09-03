import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { anonClient } from "../../../lib/server/supabase-server";
import { json, apiError, preflight, handler } from "../../../lib/server/api";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/v1/auth/login
 * El juez inicia sesión con su usuario de Supabase Auth. Devuelve el token
 * (JWT) que el Timer usará como Bearer, y su liga (tenant).
 */
export const Route = createFileRoute("/api/v1/auth/login")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "email y password son requeridos", 400);

        const supa = anonClient();
        const { data, error } = await supa.auth.signInWithPassword(parsed.data);
        if (error || !data.session) {
          return apiError("INVALID_CREDENTIALS", "Credenciales inválidas", 401);
        }

        const { data: profile } = await supa
          .from("profiles")
          .select("tenant_id, role, full_name, tenants(name)")
          .eq("id", data.user.id)
          .maybeSingle();

        if (!profile?.tenant_id) {
          return apiError("NO_LEAGUE", "El usuario no está asociado a ninguna liga", 403);
        }

        const leagueName =
          (profile as { tenants?: { name?: string } | null }).tenants?.name ?? null;

        return json({
          token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          user_id: data.user.id,
          user_name: profile.full_name ?? null,
          user_role: profile.role ?? "athlete",
          league_id: profile.tenant_id,
          league_name: leagueName,
        });
      }),
    },
  },
});
