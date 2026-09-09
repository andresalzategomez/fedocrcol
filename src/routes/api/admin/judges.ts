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
 * El admin de liga (o superadmin) invita a un juez por correo. Crear un
 * usuario de Supabase Auth requiere service_role (el juez no se
 * auto-registra), así que esto no se puede hacer desde el cliente con RLS
 * — de ahí este server route.
 *
 * Flujo: `auth.admin.inviteUserByEmail` crea el usuario y le manda el
 * correo de invitación (el juez define su contraseña al aceptar, ver
 * /set-password). El trigger `handle_new_user()` crea su `profile`
 * automáticamente con role='athlete' — este endpoint lo corrige a
 * 'judge' y fija su tenant_id justo después.
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

        return json({ id: userId, email, full_name });
      }),
    },
  },
});
