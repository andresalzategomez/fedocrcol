import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { athleteConfirmHtml, athleteConfirmSubject } from "../../../lib/server/email-templates/athlete-confirm";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  tenant_id: z.string().uuid(),
  club_id: z.string().uuid().optional(),
});

/**
 * POST /api/public/register-athlete
 * Reemplaza el `supabase.auth.signUp()` directo desde el cliente que usaba
 * esta ruta antes: ese signUp dispara el correo de confirmación integrado
 * de Supabase (mismo mailer de límite bajo que ya migramos para
 * jueces/race_manager) y además rechaza ciertos dominios de correo
 * (validación propia de Supabase, no relacionada con este código).
 *
 * El atleta SÍ debe confirmar su correo antes de poder iniciar sesión (a
 * diferencia de antes, cuando `email_confirm:true` lo dejaba confirmado
 * de una). Para no depender del mailer de Supabase, se genera el enlace
 * de confirmación con la Admin API (`generateLink` type "signup" -- crea
 * el usuario sin confirmar y devuelve el enlace) y se envía por Resend,
 * igual que las invitaciones de juez/gestor y la recuperación de
 * contraseña.
 *
 * El trigger handle_new_user() sigue resolviendo tenant_id/club_id desde
 * la metadata exactamente igual que con signUp -- generateLink dispara el
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

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor: no se puede enviar el correo de confirmación", 503);
        }

        const admin = serviceClient();

        const { data: tenant } = await admin.from("tenants").select("id, status").eq("id", tenant_id).maybeSingle();
        if (!tenant || tenant.status !== "active") return apiError("BAD_REQUEST", "La liga seleccionada no existe o no está activa", 400);

        const redirectTo = `${siteUrl(request)}/panel`;
        const { data, error } = await admin.auth.admin.generateLink({
          type: "signup",
          email,
          password,
          options: { data: { full_name, tenant_id, club_id }, redirectTo },
        });
        if (error) {
          const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
          return apiError("SIGNUP_FAILED", error.message, status);
        }
        const userId = data.user?.id;
        const confirmUrl = data.properties?.action_link;
        if (!userId || !confirmUrl) return apiError("SIGNUP_FAILED", "No se pudo crear la cuenta", 500);

        const sent = await sendEmail({
          to: email,
          subject: athleteConfirmSubject,
          html: athleteConfirmHtml({ fullName: full_name, confirmUrl }),
        });
        if (!sent.ok) {
          return apiError("EMAIL_FAILED", `La cuenta se creó, pero no se pudo enviar el correo de confirmación: ${sent.error}`, 502);
        }

        return json({ user_id: userId });
      }),
    },
  },
});
