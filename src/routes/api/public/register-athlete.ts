import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  tenant_id: z.string().uuid(),
  club_id: z.string().uuid().optional(),
});

/**
 * POST /api/public/register-athlete
 * Reemplaza el `supabase.auth.signUp()` directo desde el cliente que
 * usaba esta ruta antes: ese signUp dispara el correo de confirmación
 * integrado de Supabase (mismo mailer de límite bajo que ya migramos
 * para jueces/race_manager) y además rechaza ciertos dominios de correo
 * (validación propia de Supabase, no relacionada con este código).
 *
 * El atleta no necesita aprobación ni confirmar correo (a diferencia de
 * liga/club) -- iniciando sesión de una vez es justo el punto -- así que
 * `admin.createUser({email_confirm:true})` no solo evita el mailer de
 * Supabase, además es lo correcto para este flujo: no hay nada que
 * migrar a Resend aquí porque no hace falta enviar ningún correo.
 *
 * El trigger handle_new_user() sigue resolviendo tenant_id/club_id desde
 * la metadata exactamente igual que con signUp -- createUser dispara el
 * mismo trigger de auth.users.
 */
export const Route = createFileRoute("/api/public/register-athlete")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos del formulario", 400);
        const { email, password, full_name, tenant_id, club_id } = parsed.data;

        const admin = serviceClient();

        const { data: tenant } = await admin.from("tenants").select("id, status").eq("id", tenant_id).maybeSingle();
        if (!tenant || tenant.status !== "active") return apiError("BAD_REQUEST", "La liga seleccionada no existe o no está activa", 400);

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, tenant_id, club_id },
        });
        if (createErr) {
          const status = createErr.status && createErr.status >= 400 && createErr.status < 500 ? createErr.status : 500;
          return apiError("SIGNUP_FAILED", createErr.message, status);
        }
        const userId = created.user?.id;
        if (!userId) return apiError("SIGNUP_FAILED", "No se pudo crear la cuenta", 500);

        return json({ user_id: userId });
      }),
    },
  },
});
