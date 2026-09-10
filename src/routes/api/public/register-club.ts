import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  club_name: z.string().min(2),
  tenant_id: z.string().uuid().optional(),
  city: z.string().optional(),
  department: z.string().optional(),
});

/**
 * POST /api/public/register-club
 * Registro público de un club nuevo. Igual que register-league.ts, la
 * cuenta se crea directo con la contraseña elegida (sin invitación).
 *
 * Si eligió liga (tenant_id) queda pendiente de que ESA liga lo apruebe;
 * si no, queda pendiente del superadmin -- al aprobarlo (fase D) se le
 * crea su propio tenant ("club independiente"). Por eso clubs.tenant_id
 * puede quedar en null aquí (ver migración 0017).
 */
export const Route = createFileRoute("/api/public/register-club")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos del formulario", 400);
        const { email, password, full_name, club_name, tenant_id, city, department } = parsed.data;

        const admin = serviceClient();

        if (tenant_id) {
          const { data: tenant } = await admin.from("tenants").select("id, status").eq("id", tenant_id).maybeSingle();
          if (!tenant || tenant.status !== "active") return apiError("BAD_REQUEST", "La liga seleccionada no existe o no está activa", 400);
        }

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name },
        });
        if (createErr) {
          const status = createErr.status && createErr.status >= 400 && createErr.status < 500 ? createErr.status : 500;
          return apiError("SIGNUP_FAILED", createErr.message, status);
        }
        const userId = created.user?.id;
        if (!userId) return apiError("SIGNUP_FAILED", "No se pudo crear la cuenta", 500);

        const { data: club, error: clubErr } = await admin
          .from("clubs")
          .insert({
            tenant_id: tenant_id ?? null,
            name: club_name,
            city: city ?? null,
            department: department ?? null,
            contact_email: email,
            owner_id: userId,
            approval_status: "pending",
          })
          .select("id")
          .single();
        if (clubErr) return apiError("DB_ERROR", `La cuenta se creó, pero no se pudo registrar el club: ${clubErr.message}`, 500);

        const { error: profErr } = await admin
          .from("profiles")
          .update({ role: "club", tenant_id: tenant_id ?? null, full_name, email })
          .eq("id", userId);
        if (profErr) return apiError("DB_ERROR", `El club se creó, pero no se pudo vincular tu cuenta: ${profErr.message}`, 500);

        return json({ club_id: club.id, user_id: userId, pending_approval_by: tenant_id ? "league" : "federation" });
      }),
    },
  },
});
