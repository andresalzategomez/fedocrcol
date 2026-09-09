import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { judgeInviteHtml, judgeInviteSubject } from "../../../lib/server/email-templates/judge-invite";

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
 * Correo: se usa `auth.admin.generateLink({type:"invite"})` — crea el
 * usuario igual que `inviteUserByEmail` pero NO envía ningún correo, solo
 * devuelve el link. El correo se manda aparte con Resend (branded, ver
 * lib/server/email-templates/judge-invite.ts) para no depender del
 * remitente por defecto de Supabase, que tiene un límite de envíos muy
 * bajo (pensado solo para pruebas) y sin marca propia.
 *
 * Reenvío: incluso con Resend, `generateLink` sigue fallando si el correo
 * ya existe en auth.users. Para un juez que TODAVÍA no confirmó
 * (password_set_at null) se borra la cuenta vieja y se crea una nueva con
 * el mismo correo — preservando sus asignaciones de checkpoint, que si no
 * se perderían por el ON DELETE CASCADE de checkpoint_judges.judge_id.
 *
 * Si el correo ya pertenece a una cuenta CONFIRMADA, o a otra liga, o a
 * un rol distinto de judge, se rechaza como conflicto real (no se borra
 * nada de otra liga ni de una cuenta ya activa).
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

        const redirectTo = `${new URL(request.url).origin}/set-password`;
        const admin = serviceClient();

        // ¿Ya existe un profile con este correo? Determina si esto es un
        // reenvío (borrar+recrear preservando asignaciones) o un conflicto real.
        const { data: existing, error: existingErr } = await admin
          .from("profiles")
          .select("id, role, tenant_id, password_set_at")
          .eq("email", email)
          .maybeSingle();
        if (existingErr) return apiError("DB_ERROR", existingErr.message, 500);

        let preservedAssignments: { tenant_id: string; checkpoint_id: string }[] = [];
        if (existing) {
          const canResend = existing.role === "judge" && existing.tenant_id === leagueId && !existing.password_set_at;
          if (!canResend) {
            return apiError("EMAIL_TAKEN", "Ya existe una cuenta con este correo (de otra liga, de otro rol, o ya confirmada)", 409);
          }
          const { data: assigned } = await admin.from("checkpoint_judges").select("tenant_id, checkpoint_id").eq("judge_id", existing.id);
          preservedAssignments = assigned ?? [];
          const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
          if (delErr) return apiError("INVITE_FAILED", `No se pudo reenviar: ${delErr.message}`, 500);
        }

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor: no se puede enviar el correo de invitación", 503);
        }

        const { data: tenant } = await admin.from("tenants").select("name").eq("id", leagueId).maybeSingle();
        const leagueName = tenant?.name ?? "tu liga";

        const { data, error } = await admin.auth.admin.generateLink({
          type: "invite",
          email,
          options: { data: { full_name, tenant_id: leagueId }, redirectTo },
        });
        if (error) {
          const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
          return apiError("INVITE_FAILED", error.message, status);
        }
        const userId = data.user?.id;
        const actionLink = data.properties?.action_link;
        if (!userId || !actionLink) return apiError("INVITE_FAILED", "La invitación no devolvió un usuario o un enlace", 500);

        // El trigger handle_new_user() ya creó el profile con role='athlete' —
        // lo promovemos a 'judge' y confirmamos su liga.
        const { error: profErr } = await admin
          .from("profiles")
          .update({ role: "judge", tenant_id: leagueId, full_name, email })
          .eq("id", userId);
        if (profErr) return apiError("DB_ERROR", profErr.message, 500);

        if (preservedAssignments.length) {
          const { error: reassignErr } = await admin
            .from("checkpoint_judges")
            .insert(preservedAssignments.map((a) => ({ tenant_id: a.tenant_id, checkpoint_id: a.checkpoint_id, judge_id: userId })));
          if (reassignErr) return apiError("DB_ERROR", `Invitación reenviada, pero no se pudieron restaurar sus checkpoints: ${reassignErr.message}`, 500);
        }

        const sent = await sendEmail({
          to: email,
          subject: judgeInviteSubject(leagueName),
          html: judgeInviteHtml({ fullName: full_name, leagueName, inviteUrl: actionLink }),
        });
        if (!sent.ok) {
          return apiError("EMAIL_FAILED", `El juez se creó, pero no se pudo enviar el correo: ${sent.error}`, 502);
        }

        return json({ id: userId, email, full_name, resent: Boolean(existing) });
      }),
    },
  },
});
