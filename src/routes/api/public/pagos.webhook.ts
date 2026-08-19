import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Webhook de confirmación de pago (Bold / PayU).
 * Configura en el panel de la pasarela:
 *   https://<tu-dominio>/api/public/pagos/webhook
 *
 * Variables de entorno requeridas (servidor):
 *   PAYMENT_WEBHOOK_SECRET  (llave secreta de Bold/PayU para firmar)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (proyecto externo de la Federación)
 */
export const Route = createFileRoute("/api/public/pagos/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env["PAYMENT_WEBHOOK_SECRET"];
        const signature =
          request.headers.get("x-bold-signature") ?? request.headers.get("x-signature") ?? "";

        if (!secret) {
          return new Response("Webhook no configurado", { status: 503 });
        }

        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("Firma inválida", { status: 401 });
        }

        let payload: {
          reference?: string;
          status?: string;
          transaction_id?: string;
          amount?: number;
          method?: string;
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Payload inválido", { status: 400 });
        }

        const reference = payload.reference;
        if (!reference) return new Response("Falta la referencia", { status: 400 });

        const approved = ["APPROVED", "PAID", "SUCCESS", "approved", "paid"].includes(
          payload.status ?? "",
        );

        const url = process.env["SUPABASE_URL"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!url || !serviceKey) {
          return new Response("Supabase externo no configurado", { status: 503 });
        }

        const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

        const { data: registration, error: regError } = await admin
          .from("registrations")
          .update({ status: approved ? "paid" : "cancelled" })
          .eq("qr_code", reference)
          .select("id")
          .maybeSingle();

        if (regError) return new Response("Error actualizando inscripción", { status: 500 });
        if (!registration) return new Response("Inscripción no encontrada", { status: 404 });

        await admin.from("payments").insert({
          registration_id: registration.id,
          transaction_id: payload.transaction_id ?? reference,
          amount: payload.amount ?? 0,
          method: payload.method ?? "unknown",
          status: approved ? "approved" : "declined",
        });

        return new Response("ok");
      },
    },
  },
});
