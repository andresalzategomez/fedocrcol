import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

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
 * Reenvío: `auth.admin.inviteUserByEmail` falla con "already registered"
 * si el correo ya existe (confirmado o no — se comprobó en producción).
 * No hay una API de "reenviar invitación" en Supabase que además envíe el
 * correo, así que para un juez que TODAVÍA no confirmó (password_set_at
 * null) se borra la cuenta vieja y se crea una nueva con el mismo correo
 * — preservando sus asignaciones de checkpoint, que si no se perderían
 * por el ON DELETE CASCADE de checkpoint_judges.judge_id.
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

        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name, tenant_id: leagueId },
          redirectTo,
        });
        if (error) {
          const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
          return apiError("INVITE_FAILED", error.message, status);
        }
        const userId = data.user?.id;
        if (!userId) return apiError("INVITE_FAILED", "La invitación no devolvió un usuario", 500);

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

        return json({ id: userId, email, full_name, resent: Boolean(existing) });
      }),
    },
  },
});
