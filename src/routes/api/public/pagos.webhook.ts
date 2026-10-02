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

const ok = (body = "ok") => new Response(body, { status: 200 });

export const Route = createFileRoute("/api/public/pagos/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();

        if (!isBoldConfigured) return new Response("Webhook no configurado", { status: 503 });
        if (!process.env["EXT_SUPABASE_URL"] || !process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"]) {
          return new Response("Supabase externo no configurado", { status: 503 });
        }

        if (!verifyBoldSignature(raw, request.headers.get("x-bold-signature") ?? "")) {
          return new Response("Firma inválida", { status: 401 });
        }

        let payload: BoldWebhookPayload;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Payload inválido", { status: 400 });
        }

        const type = payload.type ?? "";
        const reference = payload.data?.metadata?.reference ?? null;
        const panelUrl = `${siteUrl(request)}/panel`;
        const admin = serviceClient();

        // Sin referencia (p. ej. ventas del datáfono, o un link de pago que la trae en otro
        // campo): no se asume que no es nuestro. Si hay cobros de afiliación pendientes se
        // revisan contra Bold; si no, no hay nada que hacer.
        if (!reference) {
          console.warn("Webhook de Bold sin metadata.reference:", type, Object.keys(payload.data ?? {}).join(","));
          if (type === "SALE_APPROVED") await activatePendingLeagues(admin, panelUrl);
          return ok("ignorado");
        }

        const leagueId = tenantIdFromLeagueReference(reference);
        if (leagueId) {
          if (type !== "SALE_APPROVED") return ok("ignorado");
          let result = await activateLeagueIfPaid(admin, leagueId, panelUrl);
          // Bold a veces avisa antes de que el link figure como PAID: un reintento breve lo resuelve
          // sin esperar los 15 minutos de su política de reintentos.
          if (result.state === "not_paid" && (result.boldStatus === "PROCESSING" || result.boldStatus === "ACTIVE")) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            result = await activateLeagueIfPaid(admin, leagueId, panelUrl);
          }
          if (result.state === "error") {
            console.error("Webhook de afiliación de liga:", result.error);
            return new Response("Error activando la liga", { status: 500 });
          }
          // Bold avisa la aprobación antes de que el link figure como PAID: que reintente.
          if (result.state === "not_paid" && (result.boldStatus === "PROCESSING" || result.boldStatus === "ACTIVE")) {
            return new Response("Pago aún no confirmado en Bold", { status: 503 });
          }
          return ok();
        }

        if (type !== "SALE_APPROVED" && type !== "SALE_REJECTED") return ok("ignorado");
        const approved = type === "SALE_APPROVED";

        // Un rechazo solo cancela una inscripción aún pendiente: nunca una ya pagada.
        let update = admin.from("registrations").update({ status: approved ? "paid" : "cancelled" }).eq("qr_code", reference);
        if (!approved) update = update.eq("status", "pending");
        const { data: registration, error: regError } = await update.select("id").maybeSingle();
        if (regError) return new Response("Error actualizando inscripción", { status: 500 });
        if (!registration) {
          console.warn("Webhook de Bold: sin inscripción pendiente para la referencia", reference);
          if (approved) await activatePendingLeagues(admin, panelUrl);
          return ok("ignorado");
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

        return ok();
      },
    },
  },
});
