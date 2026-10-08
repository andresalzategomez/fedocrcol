import { createHmac, timingSafeEqual } from "crypto";

/**
 * Cliente mínimo de Bold (Colombia): API de Links de Pago + validación de la
 * firma de sus webhooks. Documentación: developers.bold.co
 *
 * Variables de entorno (servidor):
 *   BOLD_IDENTITY_KEY  llave de identidad (pública, identifica el comercio)
 *   BOLD_SECRET_KEY    llave secreta (firma de los webhooks)
 *   BOLD_TEST_MODE     "true" con llaves de pruebas: Bold firma los webhooks
 *                      con llave VACÍA en ese ambiente.
 */
const BASE_URL = "https://integrations.api.bold.co";

const identityKey = process.env["BOLD_IDENTITY_KEY"];
const secretKey = process.env["BOLD_SECRET_KEY"];
const testMode = process.env["BOLD_TEST_MODE"] === "true";

export const isBoldConfigured = Boolean(identityKey && secretKey);

function authHeaders(): Record<string, string> {
  return { Authorization: `x-api-key ${identityKey}`, "Content-Type": "application/json" };
}

function describeErrors(data: unknown, fallback: string): string {
  const errors = (data as { errors?: unknown } | null)?.errors;
  if (Array.isArray(errors) && errors.length) return JSON.stringify(errors);
  return fallback;
}

export type BoldResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface CreatePaymentLinkInput {
  amount: number;
  /** Solo alfanumérico, guion y guion bajo; máx. 60 caracteres. */
  reference: string;
  /** 2 a 100 caracteres. */
  description: string;
  expiresAt: Date;
  callbackUrl?: string;
}

/** Crea un link de pago de monto cerrado (el comercio fija el valor). */
export async function createPaymentLink(input: CreatePaymentLinkInput): Promise<BoldResult<{ linkId: string; url: string }>> {
  if (!isBoldConfigured) return { ok: false, error: "Bold no está configurado en el servidor" };
  try {
    const res = await fetch(`${BASE_URL}/online/link/v1`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        amount_type: "CLOSE",
        amount: { currency: "COP", total_amount: input.amount, tip_amount: 0 },
        reference: input.reference,
        description: input.description,
        // Unix time en nanosegundos.
        expiration_date: input.expiresAt.getTime() * 1_000_000,
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as { payload?: { payment_link?: string; url?: string } } | null;
    const linkId = data?.payload?.payment_link;
    const url = data?.payload?.url;
    if (!res.ok || !linkId || !url) {
      return { ok: false, error: `Bold respondió ${res.status}: ${describeErrors(data, res.statusText)}` };
    }
    return { ok: true, linkId, url };
  } catch (e) {
    return { ok: false, error: `No se pudo conectar con Bold: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type BoldLinkStatus = "ACTIVE" | "PROCESSING" | "PAID" | "REJECTED" | "CANCELLED" | "EXPIRED";

export interface BoldLink {
  status: BoldLinkStatus;
  total: number;
  reference: string | null;
  transactionId: string | null;
  paymentMethod: string | null;
}

/** Consulta el estado real de un link: es la fuente de verdad, más que el cuerpo de un webhook. */
export async function getPaymentLink(linkId: string): Promise<BoldResult<{ link: BoldLink }>> {
  if (!isBoldConfigured) return { ok: false, error: "Bold no está configurado en el servidor" };
  try {
    const res = await fetch(`${BASE_URL}/online/link/v1/${encodeURIComponent(linkId)}`, { headers: authHeaders() });
    const data = (await res.json().catch(() => null)) as
      | { status?: BoldLinkStatus; total?: number; reference?: string; transaction_id?: string; payment_method?: string }
      | null;
    if (!res.ok || !data?.status) {
      return { ok: false, error: `Bold respondió ${res.status}: ${describeErrors(data, res.statusText)}` };
    }
    return {
      ok: true,
      link: {
        status: data.status,
        total: Number(data.total ?? 0),
        reference: data.reference ?? null,
        transactionId: data.transaction_id ?? null,
        paymentMethod: data.payment_method ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: `No se pudo conectar con Bold: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Valida el header x-bold-signature: HMAC-SHA256, en hexadecimal, de la
 * versión en Base64 del cuerpo crudo, con la llave secreta (llave vacía si
 * son llaves de pruebas). Comparación en tiempo constante.
 */
export function verifyBoldSignature(rawBody: string, signature: string): boolean {
  if (!secretKey || !signature) return false;
  const message = Buffer.from(rawBody, "utf8").toString("base64");
  const keys = testMode ? [secretKey, ""] : [secretKey];
  const received = Buffer.from(signature.trim().toLowerCase());
  return keys.some((key) => {
    const expected = Buffer.from(createHmac("sha256", key).update(message).digest("hex"));
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
