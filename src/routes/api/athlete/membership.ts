import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateUser, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { isBoldConfigured } from "../../../lib/server/bold";
import { getCurrentSeason } from "../../../lib/server/club-membership";
import {
  activateAthleteMembershipIfPaid, exemptAthleteMembership, prepareAthleteMembership,
} from "../../../lib/server/athlete-membership";

const bodySchema = z.object({
  action: z.enum(["pay", "check", "exempt"]),
  /** Solo para exempt: lo envía la liga/federación. En pay/check se usa siempre el atleta de la sesión. */
  athlete_id: z.string().uuid().optional(),
  reason: z.string().trim().max(300).optional(),
});

/**
 * POST /api/athlete/membership  { action, athlete_id?, reason? }
 *
 *  - pay    (el propio atleta): crea o reutiliza el link de Bold de su afiliación a SU liga en la temporada actual.
 *  - check  (el propio atleta): pregunta a Bold si ya pagó y, si es así, deja la afiliación activa.
 *  - exempt (admin de la liga del atleta o federación): exonera la afiliación de la temporada actual (motivo obligatorio).
 *
 * La afiliación es para pertenecer a la liga: NO es requisito para inscribirse a una carrera. El valor lo fija la
 * liga en su temporada actual y lo calcula el servidor. La federación recauda y liquida a la liga el porcentaje acordado.
 */
export const Route = createFileRoute("/api/athlete/membership")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, userId, tenantId } = await authenticateUser(request);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos de la solicitud", 400);
        const { action, reason } = parsed.data;
        const admin = serviceClient();
        const panelUrl = `${siteUrl(request)}/panel`;

        if (action === "exempt") {
          const athleteId = parsed.data.athlete_id;
          if (!athleteId) return apiError("BAD_REQUEST", "Indica el atleta", 400);
          if (!reason || reason.length < 3) return apiError("BAD_REQUEST", "Escribe el motivo de la exoneración", 400);
          const { data: athlete } = await admin.from("profiles").select("tenant_id").eq("id", athleteId).maybeSingle();
          if (!athlete) return apiError("NOT_FOUND", "No encontramos a ese atleta", 404);
          const isLeague = (role === "admin" && tenantId === athlete.tenant_id) || role === "superadmin";
          if (!isLeague) return apiError("FORBIDDEN", "Solo la liga del atleta puede exonerarlo", 403);
          const r = await exemptAthleteMembership(admin, athleteId, { reason, createdBy: userId, panelUrl });
          if (!r.ok) return apiError(r.code, r.message, r.status);
          return json({ ok: true, exempt: true, season: r.season });
        }

        // pay / check: siempre el atleta de la sesión.
        if (role !== "athlete") return apiError("FORBIDDEN", "Solo un atleta paga su afiliación", 403);
        if (!isBoldConfigured) return apiError("BOLD_NOT_CONFIGURED", "El pago en línea no está disponible por ahora", 503);

        if (action === "pay") {
          const prepared = await prepareAthleteMembership(admin, userId, { createdBy: userId, callbackUrl: panelUrl });
          if (!prepared.ok) return apiError(prepared.code, prepared.message, prepared.status);
          if (prepared.state === "already_current") return json({ ok: true, already_current: true, season: prepared.season });
          return json({ ok: true, payment_url: prepared.url, amount: prepared.amount, season: prepared.season });
        }

        // check
        if (!tenantId) return apiError("NO_LEAGUE", "No perteneces a ninguna liga", 409);
        const season = await getCurrentSeason(admin, tenantId);
        if (!season) return apiError("NO_SEASON", "Tu liga aún no definió la temporada actual", 409);
        const { data: m } = await admin.from("athlete_season_memberships").select("id, status")
          .eq("athlete_id", userId).eq("tenant_id", tenantId).eq("season", season.season).maybeSingle();
        if (!m) return json({ ok: true, status: "none", season: season.season });
        if (m.status !== "awaiting_payment") return json({ ok: true, status: m.status, season: season.season });
        const result = await activateAthleteMembershipIfPaid(admin, m.id as string, panelUrl);
        if (result.state === "activated") return json({ ok: true, status: "paid", season: season.season });
        if (result.state === "error") return apiError("BOLD_ERROR", result.error, 502);
        return json({ ok: true, status: "awaiting_payment", season: season.season, bold_status: result.state === "not_paid" ? result.boldStatus : null });
      }),
    },
  },
});
