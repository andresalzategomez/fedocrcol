import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { isBoldConfigured, verifyBoldSignature } from "../../../lib/server/bold";
import { activateLeagueIfPaid, activatePendingLeagues, tenantIdFromLeagueReference } from "../../../lib/server/league-affiliation";

/**
 * Webhook de Bold. Configúralo en el panel de Bold (Integraciones ->
 * Webhooks) con la URL:
 *   https://<tu-dominio>/api/public/pagos/webhook
 *
 * Variables de entorno (servidor):
 *   BOLD_SECRET_KEY, BOLD_IDENTITY_KEY, BOLD_TEST_MODE (ver lib/server/bold.ts)
 *   EXT_SUPABASE_URL, EXT_SUPABASE_SERVICE_ROLE_KEY
 *
 * Bold exige responder 200 en menos de 2 s; ante cualquier otra respuesta
 * reintenta (15 min, 1 h, 4 h, 8 h, 24 h). Por eso solo se responde no-200
 * cuando un reintento puede arreglar algo (error nuestro, o el link de
 * Bold aún no aparece como pagado).
 *
 * El mismo endpoint atiende dos tipos de cobro, según la referencia del
 * pago (data.metadata.reference):
 *   - "liga-<uuid>-..."  cuota de afiliación de una liga -> la activa
 *   - cualquier otra     el qr_code de una inscripción  -> la marca pagada
 *
 * Payload (CloudEvents): { id, type, subject, source, data: {
 *   payment_id, metadata: { reference }, amount: { total }, payment_method } }
 * type: SALE_APPROVED | SALE_REJECTED | VOID_APPROVED | VOID_REJECTED
 */
interface BoldWebhookPayload {
  type?: string;
  data?: {
    payment_id?: string;
    metadata?: { reference?: string | null };
    amount?: { total?: number };
    payment_method?: string;
  };
}

/** Resumen de cada aviso para diagnóstico (tabla payment_webhook_events). Sin datos personales. */
interface WebhookLog {
  signature_valid: boolean | null;
  event_type: string | null;
  reference: string | null;
  payment_id: string | null;
  payment_method: string | null;
  amount: number | null;
  outcome: string;
  summary: Record<string, unknown> | null;
}

function reply(log: WebhookLog, outcome: string, status: number, body: string): Response {
  log.outcome = outcome;
  return new Response(body, { status });
}

/** Mejor esfuerzo: un fallo al guardar el registro nunca debe cambiar la respuesta a Bold. */
async function saveLog(request: Request, log: WebhookLog, status: number): Promise<void> {
  try {
    if (!process.env["EXT_SUPABASE_URL"] || !process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"]) return;
    await serviceClient().from("payment_webhook_events").insert({
      ...log,
      http_status: status,
      user_agent: request.headers.get("user-agent"),
    });
  } catch (e) {
    console.error("No se pudo guardar el registro del webhook:", e);
  }
}

async function handleBoldWebhook(request: Request, raw: string, log: WebhookLog): Promise<Response> {
  if (!isBoldConfigured) return reply(log, "no_configurado", 503, "Webhook no configurado");
  if (!process.env["EXT_SUPABASE_URL"] || !process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"]) {
    return reply(log, "supabase_no_configurado", 503, "Supabase externo no configurado");
  }

  log.signature_valid = verifyBoldSignature(raw, request.headers.get("x-bold-signature") ?? "");
  if (!log.signature_valid) return reply(log, "firma_invalida", 401, "Firma inválida");

  let payload: BoldWebhookPayload & Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply(log, "payload_invalido", 400, "Payload inválido");
  }

  const type = payload.type ?? "";
  const reference = payload.data?.metadata?.reference ?? null;
  log.event_type = type || null;
  log.reference = reference;
  log.payment_id = payload.data?.payment_id ?? null;
  log.payment_method = payload.data?.payment_method ?? null;
  log.amount = payload.data?.amount?.total ?? null;
  log.summary = {
    keys: Object.keys(payload),
    data_keys: Object.keys(payload.data ?? {}),
    metadata_keys: Object.keys(payload.data?.metadata ?? {}),
    source: payload["source"] ?? null,
    subject: payload["subject"] ?? null,
    integration: (payload.data as Record<string, unknown> | undefined)?.["integration"] ?? null,
  };

  const panelUrl = `${siteUrl(request)}/panel`;
  const admin = serviceClient();

  // Sin referencia (p. ej. ventas del datáfono, o un link de pago que la trae en otro
  // campo): no se asume que no es nuestro. Si hay cobros de afiliación pendientes se
  // revisan contra Bold; si no, no hay nada que hacer.
  if (!reference) {
    console.warn("Webhook de Bold sin metadata.reference:", type, Object.keys(payload.data ?? {}).join(","));
    if (type === "SALE_APPROVED") {
      const activated = await activatePendingLeagues(admin, panelUrl);
      return reply(log, activated > 0 ? "sin_referencia:ligas_activadas" : "sin_referencia:nada_que_hacer", 200, "ignorado");
    }
    return reply(log, "sin_referencia:ignorado", 200, "ignorado");
  }

  const leagueId = tenantIdFromLeagueReference(reference);
  if (leagueId) {
    if (type !== "SALE_APPROVED") return reply(log, "liga:evento_ignorado", 200, "ignorado");
    let result = await activateLeagueIfPaid(admin, leagueId, panelUrl);
    // Bold a veces avisa antes de que el link figure como PAID: un reintento breve lo resuelve
    // sin esperar los 15 minutos de su política de reintentos.
    if (result.state === "not_paid" && (result.boldStatus === "PROCESSING" || result.boldStatus === "ACTIVE")) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await activateLeagueIfPaid(admin, leagueId, panelUrl);
    }
    if (result.state === "error") {
      console.error("Webhook de afiliación de liga:", result.error);
      log.summary = { ...log.summary, error: result.error };
      return reply(log, "liga:error", 500, "Error activando la liga");
    }
    // Bold avisa la aprobación antes de que el link figure como PAID: que reintente.
    if (result.state === "not_paid" && (result.boldStatus === "PROCESSING" || result.boldStatus === "ACTIVE")) {
      return reply(log, `liga:pendiente_bold_${result.boldStatus}`, 503, "Pago aún no confirmado en Bold");
    }
    return reply(log, `liga:${result.state}`, 200, "ok");
  }

  if (type !== "SALE_APPROVED" && type !== "SALE_REJECTED") return reply(log, "inscripcion:evento_ignorado", 200, "ignorado");
  const approved = type === "SALE_APPROVED";

  // Un rechazo solo cancela una inscripción aún pendiente: nunca una ya pagada.
  let update = admin.from("registrations").update({ status: approved ? "paid" : "cancelled" }).eq("qr_code", reference);
  if (!approved) update = update.eq("status", "pending");
  const { data: registration, error: regError } = await update.select("id").maybeSingle();
  if (regError) return reply(log, "inscripcion:error", 500, "Error actualizando inscripción");
  if (!registration) {
    console.warn("Webhook de Bold: sin inscripción pendiente para la referencia", reference);
    if (approved) await activatePendingLeagues(admin, panelUrl);
    return reply(log, "inscripcion:no_encontrada", 200, "ignorado");
  }

  const transactionId = payload.data?.payment_id ?? reference;
  const { data: already } = await admin
    .from("payments")
    .select("id")
    .eq("registration_id", registration.id)
    .eq("transaction_id", transactionId)
    .maybeSingle();
  if (!already) {
    await admin.from("payments").insert({
      registration_id: registration.id,
      transaction_id: transactionId,
      amount: payload.data?.amount?.total ?? 0,
      method: payload.data?.payment_method ?? "unknown",
      status: approved ? "approved" : "declined",
    });
  }

  return reply(log, approved ? "inscripcion:pagada" : "inscripcion:cancelada", 200, "ok");
}

export const Route = createFileRoute("/api/public/pagos/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const log: WebhookLog = {
          signature_valid: null, event_type: null, reference: null, payment_id: null,
          payment_method: null, amount: null, outcome: "sin_procesar", summary: null,
        };
        let response: Response;
        try {
          response = await handleBoldWebhook(request, raw, log);
        } catch (e) {
          console.error("Webhook de Bold:", e);
          log.outcome = "excepcion";
          log.summary = { ...log.summary, error: e instanceof Error ? e.message : String(e) };
          response = new Response("Error interno", { status: 500 });
        }
        await saveLog(request, log, response.status);
        return response;
      },
    },
  },
});
