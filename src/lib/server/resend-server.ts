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

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envía un correo transaccional vía la API HTTP de Resend (sin SDK: es un solo
 * POST). Este proyecto NO usa Lovable Cloud, así que el conector de Resend de
 * Lovable (pensado para que el propio chat de Lovable llame APIs de terceros)
 * no inyecta la clave en este runtime — por eso se lee `RESEND_API_KEY` como
 * variable de entorno de servidor, igual que SUPABASE_SERVICE_ROLE_KEY.
 *
 * Reintenta hasta MAX_ATTEMPTS veces solo ante fallas de RED (DNS, conexión
 * caída, timeout -- `fetch` lanzando excepción), no ante respuestas de
 * Resend con error (esas son definitivas, reintentarlas no cambia nada).
 * Sin esto, un DNS que falla una sola vez tumbaba el registro completo con
 * un 500 genérico en vez de solo el envío del correo.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY no está configurada en el servidor" };

  const body = JSON.stringify({
    from: fromEmail,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  });

  let lastNetworkError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Resend respondió ${res.status}: ${text || res.statusText}` };
      }
      return { ok: true };
    } catch (e) {
      lastNetworkError = e;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  const message = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
  return { ok: false, error: `No se pudo conectar con Resend tras ${MAX_ATTEMPTS} intentos: ${message}` };
}
