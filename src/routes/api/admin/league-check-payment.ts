import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateUser, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { isBoldConfigured } from "../../../lib/server/bold";
import { activateLeagueIfPaid, renewLeagueLinkIfDead } from "../../../lib/server/league-affiliation";

const bodySchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/admin/league-check-payment  { id }
 * Consulta a Bold si ya se pagó la afiliación de la liga y, si es así, la
 * activa. Es la red de seguridad por si el webhook se pierde o demora.
 * La puede pulsar la federación (cualquier liga) o el admin de esa liga.
 * Si el link vigente quedó rechazado, vencido o cancelado (ya no se puede
 * pagar), emite uno nuevo con el mismo monto y lo devuelve en payment_url.
 */
export const Route = createFileRoute("/api/admin/league-check-payment")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, tenantId, userId } = await authenticateUser(request);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Falta el id de la liga", 400);
        const { id } = parsed.data;

        const allowed = role === "superadmin" || (role === "admin" && tenantId === id);
        if (!allowed) return apiError("FORBIDDEN", "No puedes verificar el pago de esa liga", 403);
        if (!isBoldConfigured) {
          return apiError("BOLD_NOT_CONFIGURED", "BOLD_IDENTITY_KEY / BOLD_SECRET_KEY no están configuradas en el servidor", 503);
        }

        const result = await activateLeagueIfPaid(serviceClient(), id, `${siteUrl(request)}/panel`);
        switch (result.state) {
          case "activated":
            return json({ ok: true, activated: true });
          case "not_paid": {
            const renewed = await renewLeagueLinkIfDead(serviceClient(), id, result.boldStatus, userId, `${siteUrl(request)}/panel`);
            if (renewed.state === "error") return apiError("BOLD_ERROR", renewed.error, 502);
            return json({
              ok: true,
              activated: false,
              bold_status: result.boldStatus,
              renewed: renewed.state === "renewed",
              ...(renewed.state === "renewed" ? { payment_url: renewed.url } : {}),
            });
          }
          case "no_payment":
            return apiError("NO_PAYMENT", "Esa liga no tiene un cobro de afiliación pendiente", 404);
          default:
            return apiError("BOLD_ERROR", result.error, 502);
        }
      }),
    },
  },
});
