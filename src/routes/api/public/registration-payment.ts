import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { isBoldConfigured } from "../../../lib/server/bold";
import { activateRegistrationIfPaid, prepareRegistrationPayment } from "../../../lib/server/registration-payment";

const bodySchema = z.object({
  qr_code: z.string().min(5).max(80),
  action: z.enum(["pay", "check"]).default("pay"),
});

/**
 * POST /api/public/registration-payment  { qr_code, action: "pay" | "check" }
 *
 *  - pay:   crea (o reutiliza) el link de pago de Bold de la inscripción y lo devuelve.
 *           El monto lo calcula el servidor, nunca el navegador.
 *  - check: pregunta a Bold si el link ya se pagó y, si es así, confirma la inscripción.
 *           Es la red de seguridad por si el webhook se pierde o demora: la página del
 *           atleta lo llama sola mientras espera la confirmación.
 *
 * Público a propósito: el atleta puede pagar sin tener cuenta, y la identifica su código
 * de inscripción. No expone datos personales ni permite elegir el monto.
 */
export const Route = createFileRoute("/api/public/registration-payment")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Falta el código de la inscripción", 400);
        if (!isBoldConfigured) {
          return apiError("BOLD_NOT_CONFIGURED", "El pago en línea no está disponible por ahora", 503);
        }
        const admin = serviceClient();

        if (parsed.data.action === "check") {
          const result = await activateRegistrationIfPaid(admin, parsed.data.qr_code);
          // Datos mínimos del ticket para mostrarlo al volver de Bold aunque el atleta no haya iniciado sesión.
          const ticket = async (status: string) => {
            const { data: reg } = await admin.from("registrations").select("amount, category_id").eq("qr_code", parsed.data.qr_code).maybeSingle();
            const { data: cat } = reg
              ? await admin.from("event_categories").select("name").eq("id", reg.category_id as string).maybeSingle()
              : { data: null };
            return json({ ok: true, status, amount: reg ? Number(reg.amount) : null, category: (cat?.name as string | undefined) ?? null });
          };
          switch (result.state) {
            case "paid":
              return ticket("paid");
            case "not_paid":
            case "no_link":
              return ticket("pending");
            case "not_found":
              return apiError("NOT_FOUND", "No encontramos esa inscripción", 404);
            case "paid_but_cancelled":
              return ticket("cancelled");
            default:
              return apiError("BOLD_ERROR", "No pudimos consultar el pago. Intenta de nuevo en un momento.", 502);
          }
        }

        const result = await prepareRegistrationPayment(admin, parsed.data.qr_code, siteUrl(request));
        if (!result.ok) return apiError(result.code, result.message, result.status);
        return json({ ok: true, payment_url: result.url, amount: result.amount });
      }),
    },
  },
});
