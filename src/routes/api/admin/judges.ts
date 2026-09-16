import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { judgeInviteHtml, judgeInviteSubject } from "../../../lib/server/email-templates/judge-invite";
import { judgeRemovedHtml, judgeRemovedSubject } from "../../../lib/server/email-templates/judge-removed";
import { inviteOrResendAccount, removeAccount } from "../../../lib/server/invite-account";

const bodySchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
});
const removeSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/admin/judges
 * El admin de liga, un gestor de carreras, o superadmin invita a un juez
 * por correo, y también REENVÍA la invitación (mismo endpoint) mientras
 * el juez no la haya aceptado. Crear un usuario de Supabase Auth requiere
 * service_role (el juez no se auto-registra), así que esto no se puede
 * hacer desde el cliente con RLS — de ahí este server route.
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
        if (role !== "admin" && role !== "superadmin" && role !== "race_manager") {
          return apiError("FORBIDDEN", "Solo un admin de liga, un gestor de carreras o la federación puede crear jueces", 403);
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "email y full_name son requeridos", 400);
        const { email, full_name } = parsed.data;

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor: no se puede enviar el correo de invitación", 503);
        }

        const redirectTo = `${siteUrl(request)}/set-password`;
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
      DELETE: handler(async ({ request }) => {
        const { role, leagueId } = await authenticate(request);
        if (role !== "admin" && role !== "superadmin" && role !== "race_manager") {
          return apiError("FORBIDDEN", "Solo un admin de liga, un gestor de carreras o la federación puede eliminar jueces", 403);
        }
        const parsed = removeSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Falta el id del juez", 400);

        const admin = serviceClient();
        const result = await removeAccount({ admin, id: parsed.data.id, role: "judge", leagueId, isSuperadmin: role === "superadmin" });
        if (!result.ok) return apiError(result.code, result.message, result.status);

        if (result.email && isResendConfigured) {
          const { data: tenant } = await admin.from("tenants").select("name").eq("id", leagueId).maybeSingle();
          const leagueName = tenant?.name ?? "tu liga";
          const sent = await sendEmail({
            to: result.email,
            subject: judgeRemovedSubject(leagueName),
            html: judgeRemovedHtml({ fullName: result.fullName, leagueName }),
          });
          if (!sent.ok) {
            return apiError("EMAIL_FAILED", `El juez fue eliminado, pero no se pudo avisarle por correo: ${sent.error}`, 502);
          }
        }
        return json({ ok: true });
      }),
    },
  },
});
