import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { forgotPasswordHtml, forgotPasswordSubject } from "../../../lib/server/email-templates/forgot-password";

const bodySchema = z.object({ email: z.string().email() });

/**
 * POST /api/public/forgot-password
 * Genera el enlace de recuperación con la Admin API de Supabase
 * (generateLink type "recovery") y lo envía por Resend, igual que las
 * invitaciones de juez/gestor -- así no depende del mailer integrado de
 * Supabase (ver resend-server.ts).
 *
 * Responde siempre con éxito genérico, exista o no una cuenta con ese
 * correo: si no existe, generateLink falla y simplemente no se envía
 * nada, pero el cliente nunca lo distingue -- evita que este endpoint
 * sirva para confirmar qué correos están registrados.
 */
export const Route = createFileRoute("/api/public/forgot-password")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Correo inválido", 400);
        const { email } = parsed.data;

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor", 503);
        }

        const admin = serviceClient();
        const redirectTo = `${new URL(request.url).origin}/set-password`;

        const { data: profile } = await admin.from("profiles").select("full_name").eq("email", email).maybeSingle();
        const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });

        if (error) {
          console.error("forgot-password: generateLink falló", error.message);
        } else if (data.properties?.action_link) {
          const sent = await sendEmail({
            to: email,
            subject: forgotPasswordSubject,
            html: forgotPasswordHtml({ fullName: (profile?.full_name as string | null) ?? null, resetUrl: data.properties.action_link }),
          });
          if (!sent.ok) console.error("forgot-password: envío por Resend falló", sent.error);
        }

        return json({ ok: true });
      }),
    },
  },
});
