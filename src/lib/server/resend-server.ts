const RESEND_API_URL = "https://api.resend.com/emails";

const apiKey = process.env["RESEND_API_KEY"];
const fromEmail = process.env["RESEND_FROM_EMAIL"] ?? "FedOCR Colombia <onboarding@resend.dev>";

export const isResendConfigured = Boolean(apiKey);

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export type SendEmailResult = { ok: true } | { ok: false; error: string };

/**
 * Envía un correo transaccional vía la API HTTP de Resend (sin SDK: es un solo
 * POST). Este proyecto NO usa Lovable Cloud, así que el conector de Resend de
 * Lovable (pensado para que el propio chat de Lovable llame APIs de terceros)
 * no inyecta la clave en este runtime — por eso se lee `RESEND_API_KEY` como
 * variable de entorno de servidor, igual que SUPABASE_SERVICE_ROLE_KEY.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY no está configurada en el servidor" };

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend respondió ${res.status}: ${body || res.statusText}` };
  }
  return { ok: true };
}
