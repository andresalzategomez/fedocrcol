import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler } from "../../../lib/server/api";
import { sendEmail, isResendConfigured } from "../../../lib/server/resend-server";
import { registrationConfirmedHtml, registrationConfirmedSubject } from "../../../lib/server/email-templates/registration-confirmed";

const bodySchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  event_title: z.string().min(1),
  category_name: z.string().min(1),
  qr_code: z.string().min(1),
  amount: z.number().nonnegative(),
});

/**
 * POST /api/public/registration-confirmation
 * La inscripción en sí se crea directo desde el cliente
 * (lib/registrations.ts, insert con RLS -- registrations_public_insert
 * ya lo permite para anon/authenticated, no hace falta service_role).
 * Este endpoint solo manda el correo de confirmación por Resend, con los
 * datos que el cliente ya tiene a mano justo después de crearla -- no
 * vuelve a consultar la base de datos.
 *
 * Best-effort a propósito: si Resend falla, la inscripción ya quedó
 * creada igual; el cliente no bloquea la pantalla de éxito por esto,
 * solo lo registra en consola.
 */
export const Route = createFileRoute("/api/public/registration-confirmation")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos de la inscripción", 400);
        const { email, full_name, event_title, category_name, qr_code, amount } = parsed.data;

        if (!isResendConfigured) {
          return apiError("EMAIL_NOT_CONFIGURED", "RESEND_API_KEY no está configurada en el servidor", 503);
        }

        const sent = await sendEmail({
          to: email,
          subject: registrationConfirmedSubject(event_title),
          html: registrationConfirmedHtml({ fullName: full_name, eventTitle: event_title, categoryName: category_name, qrCode: qr_code, amount }),
        });
        if (!sent.ok) return apiError("EMAIL_FAILED", `No se pudo enviar el correo de confirmación: ${sent.error}`, 502);

        return json({ ok: true });
      }),
    },
  },
});
