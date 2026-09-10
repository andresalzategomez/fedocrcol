import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { judgeInviteHtml, judgeInviteSubject } from "../../../lib/server/email-templates/judge-invite";
import { inviteOrResendAccount } from "../../../lib/server/invite-account";

const bodySchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
});

/**
 * POST /api/admin/judges
 * El admin de liga (o superadmin) invita a un juez por correo, y también
 * REENVÍA la invitación (mismo endpoint) mientras el juez no la haya
 * aceptado. Crear un usuario de Supabase Auth requiere service_role (el
 * juez no se auto-registra), así que esto no se puede hacer desde el
 * cliente con RLS — de ahí este server route.
 *
 * La invitación/reenvío en sí (generateLink + borrar-y-recrear si
 * corresponde) vive en lib/server/invite-account.ts, compartida con
 * api/admin/race-managers.ts. Lo específico de jueces es preservar sus
 * checkpoints asignados: se leen ANTES de invitar/reenviar (el reenvío
 * puede borrar la cuenta vieja) y se reinsertan con el id nuevo, porque
 * si no se perderían por el ON DELETE CASCADE de checkpoint_judges.judge_id.
 */
export const Route = createFileRoute("/api/admin/judges")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, leagueId } = await authenticate(request);
        if (role !== "admin" && role !== "superadmin") {
          return apiError("FORBIDDEN", "Solo un admin de liga o la federación puede crear jueces", 403);
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "email y full_name son requeridos", 400);
        const { email, full_name } = parsed.data;

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor: no se puede enviar el correo de invitación", 503);
        }

        const redirectTo = `${new URL(request.url).origin}/set-password`;
        const admin = serviceClient();

        const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
        let preservedAssignments: { tenant_id: string; checkpoint_id: string }[] = [];
        if (existing) {
          const { data: assigned } = await admin.from("checkpoint_judges").select("tenant_id, checkpoint_id").eq("judge_id", existing.id);
          preservedAssignments = assigned ?? [];
        }

        const result = await inviteOrResendAccount({ admin, role: "judge", email, fullName: full_name, leagueId, redirectTo });
        if (!result.ok) return apiError(result.code, result.message, result.status);

        if (preservedAssignments.length) {
          const { error: reassignErr } = await admin
            .from("checkpoint_judges")
            .insert(preservedAssignments.map((a) => ({ tenant_id: a.tenant_id, checkpoint_id: a.checkpoint_id, judge_id: result.userId })));
          if (reassignErr) return apiError("DB_ERROR", `Invitación reenviada, pero no se pudieron restaurar sus checkpoints: ${reassignErr.message}`, 500);
        }

        const { data: tenant } = await admin.from("tenants").select("name").eq("id", leagueId).maybeSingle();
        const leagueName = tenant?.name ?? "tu liga";

        const sent = await sendEmail({
          to: email,
          subject: judgeInviteSubject(leagueName),
          html: judgeInviteHtml({ fullName: full_name, leagueName, inviteUrl: result.actionLink }),
        });
        if (!sent.ok) {
          return apiError("EMAIL_FAILED", `El juez se creó, pero no se pudo enviar el correo: ${sent.error}`, 502);
        }

        return json({ id: result.userId, email, full_name, resent: result.resent });
      }),
    },
  },
});
