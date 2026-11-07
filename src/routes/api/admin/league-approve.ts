import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateUser, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail } from "../../../lib/server/resend-server";
import { getPaymentLink, isBoldConfigured } from "../../../lib/server/bold";
import { issueLeaguePaymentLink } from "../../../lib/server/league-affiliation";
import { leaguePaymentLinkHtml, leaguePaymentLinkSubject } from "../../../lib/server/email-templates/league-payment-link";
import { leagueActivatedHtml, leagueActivatedSubject } from "../../../lib/server/email-templates/league-activated";

// Bold: mínimo $1.000 por medio de pago; tarjeta y PSE llegan hasta $5.000.000, Nequi y Bancolombia hasta $10.000.000.
const bodySchema = z
  .object({
    id: z.string().uuid(),
    amount: z.number().int().min(1000).max(10_000_000).optional(),
    /** La federación exime a la liga del pago: queda activa de inmediato, sin link de Bold. */
    exempt: z.boolean().optional(),
  })
  .refine((d) => d.exempt === true || d.amount !== undefined);

/** Un link ya creado se reutiliza si sigue vigente al menos este tiempo. */
const REUSE_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/admin/league-approve  { id, amount } | { id, exempt: true }
 * Solo la federación (superadmin). Aprueba una liga pendiente. Con `exempt` la
 * exime del pago: queda activa al instante y se le avisa por correo. Con
 * `amount` crea el link
 * de pago de la cuota de afiliación en Bold, pasa la liga a
 * awaiting_payment y le envía el link por correo a su admin. Se puede
 * llamar de nuevo sobre una liga ya en awaiting_payment para reenviar el
 * link (o cambiar el monto: ahí se crea uno nuevo).
 *
 * La liga se activa cuando Bold confirma el pago: ver
 * api/public/pagos.webhook.ts y api/admin/league-check-payment.ts.
 */
export const Route = createFileRoute("/api/admin/league-approve")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, userId } = await authenticateUser(request);
        if (role !== "superadmin") {
          return apiError("FORBIDDEN", "Solo la federación puede aprobar una liga", 403);
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiError("BAD_REQUEST", "Indica la liga y un monto entero entre $1.000 y $10.000.000, o exímela del pago", 400);
        }
        const { id, exempt } = parsed.data;
        const amount = parsed.data.amount ?? 0;

        if (exempt) {
          const adminDb = serviceClient();
          const { data: league } = await adminDb.from("tenants").select("id, name, status").eq("id", id).maybeSingle();
          if (!league) return apiError("NOT_FOUND", "No se encontró esa liga", 404);
          if (league.status !== "pending" && league.status !== "awaiting_payment") {
            return apiError("INVALID_STATE", "Esa liga no está pendiente de aprobación", 409);
          }
          const { error: payErr } = await adminDb.from("league_affiliation_payments").upsert({
            tenant_id: id, amount: 0, exempt: true, status: "exempt", bold_link_id: null, payment_url: null,
            bold_payment_id: null, expires_at: null, paid_at: new Date().toISOString(), created_by: userId,
          }, { onConflict: "tenant_id" });
          if (payErr) return apiError("DB_ERROR", payErr.message, 500);
          const { error: actErr } = await adminDb.from("tenants").update({ status: "active" }).eq("id", id);
          if (actErr) return apiError("DB_ERROR", actErr.message, 500);

          const { data: leagueAdmins } = await adminDb.from("profiles").select("email, full_name").eq("tenant_id", id).eq("role", "admin");
          const results = await Promise.all((leagueAdmins ?? []).filter((a) => a.email).map(async (a) => {
            const sent = await sendEmail({
              to: a.email as string,
              subject: leagueActivatedSubject(league.name as string),
              html: leagueActivatedHtml({ fullName: (a.full_name as string | null) ?? "", leagueName: league.name as string, panelUrl: `${siteUrl(request)}/panel`, exempt: true }),
            });
            if (!sent.ok) console.error("No se pudo avisar a la liga que quedó exenta del pago:", sent.error);
            return sent.ok;
          }));
          return json({ ok: true, exempt: true, emails_sent: results.filter(Boolean).length });
        }

        if (!isBoldConfigured) {
          return apiError("BOLD_NOT_CONFIGURED", "BOLD_IDENTITY_KEY / BOLD_SECRET_KEY no están configuradas en el servidor", 503);
        }

        const admin = serviceClient();
        const { data: tenant } = await admin.from("tenants").select("id, name, status").eq("id", id).maybeSingle();
        if (!tenant) return apiError("NOT_FOUND", "No se encontró esa liga", 404);
        if (tenant.status !== "pending" && tenant.status !== "awaiting_payment") {
          return apiError("INVALID_STATE", "Esa liga no está pendiente de aprobación", 409);
        }
        const leagueName = tenant.name as string;

        const { data: existing } = await admin
          .from("league_affiliation_payments")
          .select("bold_link_id, payment_url, amount, status, expires_at")
          .eq("tenant_id", id)
          .maybeSingle();

        let paymentUrl: string;
        let expiresAt: Date;

        let reuse = false;
        if (
          existing && existing.status === "pending" && Number(existing.amount) === amount && existing.expires_at &&
          new Date(existing.expires_at as string).getTime() - Date.now() > REUSE_MIN_REMAINING_MS
        ) {
          const current = await getPaymentLink(existing.bold_link_id as string);
          reuse = current.ok && current.link.status === "ACTIVE";
        }

        if (existing && reuse) {
          paymentUrl = existing.payment_url as string;
          expiresAt = new Date(existing.expires_at as string);
        } else {
          const issued = await issueLeaguePaymentLink(admin, {
            tenantId: id, leagueName, amount, createdBy: userId, callbackUrl: `${siteUrl(request)}/panel`,
          });
          if (!issued.ok) return apiError("BOLD_ERROR", issued.error, 502);
          paymentUrl = issued.url;
          expiresAt = issued.expiresAt;
        }

        const { error: statusErr } = await admin.from("tenants").update({ status: "awaiting_payment" }).eq("id", id);
        if (statusErr) return apiError("DB_ERROR", statusErr.message, 500);

        const { data: admins } = await admin.from("profiles").select("email, full_name").eq("tenant_id", id).eq("role", "admin");
        let emailsSent = 0;
        let emailError: string | null = null;
        for (const a of admins ?? []) {
          const email = a.email as string | null;
          if (!email) continue;
          const sent = await sendEmail({
            to: email,
            subject: leaguePaymentLinkSubject(leagueName),
            html: leaguePaymentLinkHtml({
              fullName: (a.full_name as string | null) ?? "",
              leagueName,
              amountCop: amount,
              paymentUrl,
              expiresAt,
            }),
          });
          if (sent.ok) emailsSent += 1;
          else emailError = sent.error;
        }

        return json({ ok: true, payment_url: paymentUrl, expires_at: expiresAt.toISOString(), emails_sent: emailsSent, email_error: emailError });
      }),
    },
  },
});
