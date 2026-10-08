import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentLink, getPaymentLink, type BoldLinkStatus } from "./bold";
import { sendEmail } from "./resend-server";
import { leagueActivatedHtml, leagueActivatedSubject } from "./email-templates/league-activated";
import { leaguePaidFederationHtml, leaguePaidFederationSubject } from "./email-templates/league-paid-federation";

/** Prefijo de la referencia de Bold que distingue un cobro de afiliación de una inscripción. */
export const LEAGUE_REFERENCE_PREFIX = "liga-";

/**
 * Referencia única por link (Bold pide una referencia única por cobro, y un
 * link regenerado no debe chocar con el anterior): liga-<uuid>-<sufijo>.
 * Cabe en el límite de 60 caracteres de Bold.
 */
export function newLeagueReference(tenantId: string): string {
  return `${LEAGUE_REFERENCE_PREFIX}${tenantId}-${Date.now().toString(36)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Devuelve el id de la liga si la referencia es de un cobro de afiliación; null si es otra cosa (p. ej. una inscripción). */
export function tenantIdFromLeagueReference(reference: string | null | undefined): string | null {
  if (!reference?.startsWith(LEAGUE_REFERENCE_PREFIX)) return null;
  const id = reference.slice(LEAGUE_REFERENCE_PREFIX.length, LEAGUE_REFERENCE_PREFIX.length + 36);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** Vigencia de un link de pago (Bold permite hasta 7 días; se deja una hora de margen). */
const LINK_VALID_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

export type IssueLinkResult = { ok: true; linkId: string; url: string; expiresAt: Date } | { ok: false; error: string };

/** Crea un link de pago nuevo en Bold para la afiliación de la liga y lo deja registrado como el cobro vigente. */
export async function issueLeaguePaymentLink(
  admin: SupabaseClient,
  input: { tenantId: string; leagueName: string; amount: number; createdBy: string | null; callbackUrl: string },
): Promise<IssueLinkResult> {
  const expiresAt = new Date(Date.now() + LINK_VALID_MS);
  const created = await createPaymentLink({
    amount: input.amount,
    reference: newLeagueReference(input.tenantId),
    description: `Afiliacion Liga ${input.leagueName}`.slice(0, 100),
    expiresAt,
    callbackUrl: input.callbackUrl,
  });
  if (!created.ok) return created;

  const { error } = await admin.from("league_affiliation_payments").upsert({
    tenant_id: input.tenantId,
    amount: input.amount,
    bold_link_id: created.linkId,
    payment_url: created.url,
    status: "pending",
    bold_payment_id: null,
    paid_at: null,
    expires_at: expiresAt.toISOString(),
    created_by: input.createdBy,
  }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, linkId: created.linkId, url: created.url, expiresAt };
}

/** Estados de un link de Bold en los que ya no se puede pagar: hay que emitir uno nuevo. */
const DEAD_LINK_STATUSES: BoldLinkStatus[] = ["REJECTED", "EXPIRED", "CANCELLED"];

export type RenewResult = { state: "renewed"; url: string; expiresAt: Date } | { state: "not_needed" } | { state: "error"; error: string };

/** Si el link vigente quedó rechazado, vencido o cancelado, emite uno nuevo con el mismo monto. */
export async function renewLeagueLinkIfDead(
  admin: SupabaseClient,
  tenantId: string,
  boldStatus: BoldLinkStatus,
  createdBy: string | null,
  callbackUrl: string,
): Promise<RenewResult> {
  if (!DEAD_LINK_STATUSES.includes(boldStatus)) return { state: "not_needed" };
  const [{ data: pay }, { data: tenant }] = await Promise.all([
    admin.from("league_affiliation_payments").select("amount").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("name, status").eq("id", tenantId).maybeSingle(),
  ]);
  if (!pay || !tenant || tenant.status !== "awaiting_payment") return { state: "not_needed" };
  const issued = await issueLeaguePaymentLink(admin, {
    tenantId, leagueName: tenant.name as string, amount: Number(pay.amount), createdBy, callbackUrl,
  });
  return issued.ok ? { state: "renewed", url: issued.url, expiresAt: issued.expiresAt } : { state: "error", error: issued.error };
}

/**
 * Red de seguridad del webhook: revisa contra Bold los cobros de afiliación
 * aún pendientes y activa los que ya figuren pagados. Sirve cuando el aviso
 * llega con una referencia que no reconocemos (p. ej. si un link de pago la
 * trae en otro campo): de todos modos Bold solo activa lo que realmente pagó.
 */
export async function activatePendingLeagues(admin: SupabaseClient, panelUrl: string): Promise<number> {
  const { data: pending } = await admin
    .from("league_affiliation_payments")
    .select("tenant_id")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  let activated = 0;
  for (const row of pending ?? []) {
    const result = await activateLeagueIfPaid(admin, row.tenant_id as string, panelUrl);
    if (result.state === "activated") activated += 1;
    else if (result.state === "error") console.error("Revisión de cobros de afiliación:", result.error);
  }
  return activated;
}

export type ActivationResult =
  | { state: "activated" }
  | { state: "not_paid"; boldStatus: BoldLinkStatus }
  | { state: "no_payment" }
  | { state: "error"; error: string };

/**
 * Activa la liga SOLO si Bold confirma el pago: se consulta el estado real
 * del link (no se confía en el cuerpo de un webhook) y se valida que monto
 * y referencia coincidan con lo que se cobró. Idempotente: llamarla de
 * nuevo con la liga ya activada no repite el correo ni cambia nada.
 */
export async function activateLeagueIfPaid(admin: SupabaseClient, tenantId: string, panelUrl: string): Promise<ActivationResult> {
  const { data: pay, error: payErr } = await admin
    .from("league_affiliation_payments")
    .select("bold_link_id, amount, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (payErr) return { state: "error", error: payErr.message };
  if (!pay) return { state: "no_payment" };
  if (pay.status === "paid") return { state: "activated" };

  const res = await getPaymentLink(pay.bold_link_id as string);
  if (!res.ok) return { state: "error", error: res.error };
  if (res.link.status !== "PAID") return { state: "not_paid", boldStatus: res.link.status };
  if (res.link.total !== Number(pay.amount) || tenantIdFromLeagueReference(res.link.reference) !== tenantId) {
    return { state: "error", error: "El pago en Bold no coincide con el monto o la referencia esperados" };
  }

  // Reclamo atómico: si dos llamadas llegan a la vez, solo una pasa de pending a paid.
  const { data: claimed, error: claimErr } = await admin
    .from("league_affiliation_payments")
    .update({ status: "paid", paid_at: new Date().toISOString(), bold_payment_id: res.link.transactionId })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .select("tenant_id");
  if (claimErr) return { state: "error", error: claimErr.message };
  if (!claimed?.length) return { state: "activated" };

  const { error: tenantErr } = await admin
    .from("tenants")
    .update({ status: "active" })
    .eq("id", tenantId)
    .in("status", ["awaiting_payment", "pending"]);
  if (tenantErr) return { state: "error", error: tenantErr.message };

  // Avisos de pago confirmado: a la liga (su admin) y a la federación (superadmins).
  // Un correo que falla no revierte la activación: ya está pagada y activa.
  const [{ data: tenant }, { data: admins }, { data: federation }] = await Promise.all([
    admin.from("tenants").select("name, department, city").eq("id", tenantId).maybeSingle(),
    admin.from("profiles").select("email, full_name").eq("tenant_id", tenantId).eq("role", "admin"),
    admin.from("profiles").select("email").eq("role", "superadmin"),
  ]);
  const leagueName = (tenant?.name as string | undefined) ?? "tu liga";
  const leagueAdmins = (admins ?? []).filter((a) => a.email) as { email: string; full_name: string | null }[];

  const contact = leagueAdmins[0];
  const federationEmails = [...new Set((federation ?? []).map((f) => f.email as string | null).filter((e): e is string => Boolean(e)))];

  // En paralelo: Bold exige que el webhook responda en menos de 2 s, y enviar los
  // correos uno tras otro tardaba varios segundos.
  await Promise.all([
    ...leagueAdmins.map(async (a) => {
      const sent = await sendEmail({
        to: a.email,
        subject: leagueActivatedSubject(leagueName),
        html: leagueActivatedHtml({ fullName: a.full_name ?? "", leagueName, panelUrl }),
      });
      if (!sent.ok) console.error("No se pudo avisar la activación a la liga:", sent.error);
    }),
    ...federationEmails.map(async (to) => {
      const sent = await sendEmail({
        to,
        subject: leaguePaidFederationSubject(leagueName),
        html: leaguePaidFederationHtml({
          leagueName,
          department: (tenant?.department as string | undefined) ?? "—",
          city: (tenant?.city as string | null | undefined) ?? null,
          adminName: contact?.full_name ?? "—",
          adminEmail: contact?.email ?? "—",
          amountCop: Number(pay.amount),
          transactionId: res.link.transactionId,
          paidAt: new Date(),
          panelUrl,
        }),
      });
      if (!sent.ok) console.error("No se pudo avisar el pago a la federación:", sent.error);
    }),
  ]);
  return { state: "activated" };
}
