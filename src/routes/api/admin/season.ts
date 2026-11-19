import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { isBoldConfigured } from "../../../lib/server/bold";
import { notifyClubsOfNewSeason } from "../../../lib/server/club-membership";

const bodySchema = z.object({
  season: z.number().int().min(2000).max(2100),
  club_fee: z.number().min(0).max(10_000_000).nullable(),
  athlete_fee: z.number().min(0).max(10_000_000).nullable(),
  make_current: z.boolean(),
});

/**
 * POST /api/admin/season  { season, club_fee, athlete_fee, make_current }
 * El administrador de la liga guarda una temporada y sus cuotas y, si lo pide, la deja como la temporada actual.
 * Al cambiar la temporada actual, cada club aprobado recibe por correo el link para renovar.
 * La validación del rol la hace save_league_season() en la base de datos.
 */
export const Route = createFileRoute("/api/admin/season")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { supa, leagueId, role } = await authenticate(request);
        if (role !== "admin") return apiError("FORBIDDEN", "Solo el administrador de la liga define la temporada", 403);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa la temporada y los valores de las cuotas", 400);
        const { season, club_fee, athlete_fee, make_current } = parsed.data;

        const { data, error } = await supa.rpc("save_league_season", {
          p_season: season, p_club_fee: club_fee, p_athlete_fee: athlete_fee, p_make_current: make_current,
        });
        if (error) return apiError("SAVE_FAILED", error.message, 400);
        const result = data as { current_changed: boolean; previous_season: number | null };

        let notified = 0;
        let failed = 0;
        if (result.current_changed && isBoldConfigured) {
          const r = await notifyClubsOfNewSeason(serviceClient(), leagueId, { callbackUrl: `${siteUrl(request)}/panel`, createdBy: null });
          notified = r.notified;
          failed = r.failed;
        }
        return json({ ok: true, season, current_changed: result.current_changed, notified, failed });
      }),
    },
  },
});
