import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateUser, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { isBoldConfigured } from "../../../lib/server/bold";
import {
  activateClubMembershipIfPaid, emailClubPaymentLink, exemptClubMembership, getCurrentSeason, prepareClubMembership,
} from "../../../lib/server/club-membership";

const bodySchema = z.object({
  action: z.enum(["approve", "pay", "check", "exempt"]),
  /** Lo envía la liga/federación; el dueño del club lo omite (se resuelve su propio club). */
  club_id: z.string().uuid().optional(),
  /** approve: aprobar sin cobro. */
  exempt: z.boolean().optional(),
  /** exempt/approve sin cobro: motivo que queda registrado. */
  reason: z.string().trim().max(300).optional(),
});

/**
 * POST /api/club/membership  { action, club_id?, exempt?, reason? }
 *
 *  - approve (liga/federación): aprueba un club pendiente. Con cobro crea el link de Bold del valor de la
 *            temporada actual y se lo envía al club; con `exempt` lo deja activo sin cobro. Sobre un club ya
 *            aprobado y sin pagar, reenvía el link.
 *  - pay     (dueño del club o liga): crea o reutiliza el link de pago de la temporada actual y lo devuelve.
 *  - check   (dueño del club o liga): pregunta a Bold si ya se pagó y, si es así, deja el club activo.
 *  - exempt  (liga/federación): exonera a un club aprobado de la cuota de la temporada actual (motivo obligatorio).
 *
 * El monto lo fija la liga en su temporada actual y lo calcula el servidor: el navegador nunca lo elige.
 */
export const Route = createFileRoute("/api/club/membership")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, userId, tenantId } = await authenticateUser(request);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos de la solicitud", 400);
        const { action, exempt, reason } = parsed.data;

        const admin = serviceClient();

        // Club objetivo: el indicado (liga/federación) o el propio del dueño.
        let clubId = parsed.data.club_id;
        if (!clubId) {
          const { data: own } = await admin.from("clubs").select("id").eq("owner_id", userId).maybeSingle();
          clubId = own?.id as string | undefined;
        }
        if (!clubId) return apiError("NOT_FOUND", "No encontramos tu club", 404);

        const { data: club } = await admin.from("clubs").select("id, name, tenant_id, owner_id, approval_status").eq("id", clubId).maybeSingle();
        if (!club) return apiError("NOT_FOUND", "No encontramos ese club", 404);

        const isOwner = club.owner_id === userId;
        const isLeague = (role === "admin" && tenantId === club.tenant_id) || role === "superadmin";
        if (!isLeague && !isOwner) return apiError("FORBIDDEN", "No tienes permiso sobre este club", 403);
        if ((action === "approve" || action === "exempt") && !isLeague) {
          return apiError("FORBIDDEN", "Solo la liga del club puede aprobarlo o exonerarlo", 403);
        }
        const needsBold = (action === "approve" && !exempt) || action === "pay" || action === "check";
        if (needsBold && !isBoldConfigured) {
          return apiError("BOLD_NOT_CONFIGURED", "El pago en línea no está disponible por ahora", 503);
        }

        const panelUrl = `${siteUrl(request)}/panel`;
        const tenant = club.tenant_id as string;

        if (action === "approve") {
          const wasPending = club.approval_status === "pending";
          if (!wasPending && club.approval_status !== "active") {
            return apiError("INVALID_STATE", "Ese club no está pendiente de aprobación", 409);
          }
          const season = await getCurrentSeason(admin, tenant);
          if (!season) return apiError("NO_SEASON", "Define primero la temporada actual en Mi liga", 409);
          if (!exempt && !(season.clubFee && season.clubFee >= 1000)) {
            return apiError("NO_FEE", "Define primero la cuota de club de la temporada en Mi liga (o aprueba al club sin cobro)", 409);
          }

          if (wasPending) {
            const { error } = await admin.from("clubs")
              .update({ approval_status: "active", approved_by: userId, approved_at: new Date().toISOString() }).eq("id", clubId);
            if (error) return apiError("DB_ERROR", error.message, 500);
          }

          if (exempt) {
            const r = await exemptClubMembership(admin, clubId, { reason: reason || "Exonerado por la liga al aprobarlo", createdBy: userId, panelUrl });
            if (!r.ok) return apiError(r.code, r.message, r.status);
            return json({ ok: true, exempt: true, season: r.season });
          }

          const prepared = await prepareClubMembership(admin, clubId, { createdBy: userId, callbackUrl: panelUrl });
          if (!prepared.ok) {
            // Que el club no quede aprobado sin link de pago: vuelve a pendiente para reintentar.
            if (wasPending) await admin.from("clubs").update({ approval_status: "pending", approved_by: null, approved_at: null }).eq("id", clubId);
            return apiError(prepared.code, prepared.message, prepared.status);
          }
          if (prepared.state === "already_current") return json({ ok: true, already_current: true, season: prepared.season });
          const mail = await emailClubPaymentLink(admin, clubId, {
            url: prepared.url, amount: prepared.amount, season: prepared.season, expiresAt: prepared.expiresAt, renewal: !wasPending,
          });
          return json({ ok: true, payment_url: prepared.url, amount: prepared.amount, season: prepared.season, email_sent: mail.sent, email_error: mail.error ?? null });
        }

        if (action === "exempt") {
          if (!reason || reason.length < 3) return apiError("BAD_REQUEST", "Escribe el motivo de la exoneración", 400);
          const r = await exemptClubMembership(admin, clubId, { reason, createdBy: userId, panelUrl });
          if (!r.ok) return apiError(r.code, r.message, r.status);
          return json({ ok: true, exempt: true, season: r.season });
        }

        if (action === "pay") {
          const prepared = await prepareClubMembership(admin, clubId, { createdBy: userId, callbackUrl: panelUrl });
          if (!prepared.ok) return apiError(prepared.code, prepared.message, prepared.status);
          if (prepared.state === "already_current") return json({ ok: true, already_current: true, season: prepared.season });
          return json({ ok: true, payment_url: prepared.url, amount: prepared.amount, season: prepared.season });
        }

        // check
        const season = await getCurrentSeason(admin, tenant);
        if (!season) return apiError("NO_SEASON", "La liga aún no definió su temporada actual", 409);
        const { data: m } = await admin.from("club_season_memberships").select("id, status").eq("club_id", clubId).eq("season", season.season).maybeSingle();
        if (!m) return json({ ok: true, status: "none", season: season.season });
        if (m.status !== "awaiting_payment") return json({ ok: true, status: m.status, season: season.season });
        const result = await activateClubMembershipIfPaid(admin, m.id as string, panelUrl);
        if (result.state === "activated") return json({ ok: true, status: "paid", season: season.season });
        if (result.state === "error") return apiError("BOLD_ERROR", result.error, 502);
        return json({ ok: true, status: "awaiting_payment", season: season.season, bold_status: result.state === "not_paid" ? result.boldStatus : null });
      }),
    },
  },
});
