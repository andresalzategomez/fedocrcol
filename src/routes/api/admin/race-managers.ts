import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { raceManagerInviteHtml, raceManagerInviteSubject } from "../../../lib/server/email-templates/race-manager-invite";
import { inviteOrResendAccount } from "../../../lib/server/invite-account";

const bodySchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
});

/**
 * POST /api/admin/race-managers
 * El admin de liga (o superadmin) invita a un "gestor de carreras": un
 * rol limitado que solo puede crear/editar carreras (oficiales o no) de
 * esa liga, sin acceso a aprobar eventos, categorías, inscritos, jueces
 * ni otros usuarios (ver política race_manager_events en el esquema).
 *
 * Mismo mecanismo que api/admin/judges.ts (ver lib/server/invite-account.ts)
 * — aquí no hay nada análogo a los checkpoints de un juez que preservar
 * en un reenvío, así que este endpoint es más simple.
 */
export const Route = createFileRoute("/api/admin/race-managers")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, leagueId } = await authenticate(request);
        if (role !== "admin" && role !== "superadmin") {
          return apiError("FORBIDDEN", "Solo un admin de liga o la federación puede invitar gestores de carreras", 403);
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "email y full_name son requeridos", 400);
        const { email, full_name } = parsed.data;

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor: no se puede enviar el correo de invitación", 503);
        }

        const redirectTo = `${new URL(request.url).origin}/set-password`;
        const admin = serviceClient();

        const result = await inviteOrResendAccount({ admin, role: "race_manager", email, fullName: full_name, leagueId, redirectTo });
        if (!result.ok) return apiError(result.code, result.message, result.status);

        const { data: tenant } = await admin.from("tenants").select("name").eq("id", leagueId).maybeSingle();
        const leagueName = tenant?.name ?? "tu liga";

        const sent = await sendEmail({
          to: email,
          subject: raceManagerInviteSubject(leagueName),
          html: raceManagerInviteHtml({ fullName: full_name, leagueName, inviteUrl: result.actionLink }),
        });
        if (!sent.ok) {
          return apiError("EMAIL_FAILED", `El usuario se creó, pero no se pudo enviar el correo: ${sent.error}`, 502);
        }

        return json({ id: result.userId, email, full_name, resent: result.resent });
      }),
    },
  },
});
