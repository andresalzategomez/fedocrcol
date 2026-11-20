import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentLink, getPaymentLink, type BoldLinkStatus } from "./bold";
import { sendEmail } from "./resend-server";
import { athleteMembershipHtml, athleteMembershipSubject } from "./email-templates/athlete-membership";
import { getCurrentSeason } from "./club-membership";

/** Prefijo de la referencia de Bold de una afiliación de atleta (las de liga son "liga-", las de club "club-"). */
export const ATHLETE_REFERENCE_PREFIX = "atl-";

/** Bold: mínimo $1.000 por cobro; hasta $10.000.000 (tarjeta y PSE solo hasta $5.000.000). */
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 10_000_000;
const LINK_VALID_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
const REUSE_MIN_REMAINING_MS = 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** atl-<id de la afiliación>-<sufijo>: única por link (Bold no permite repetir una referencia); cabe en los 60 caracteres de Bold. */
export function newAthleteReference(membershipId: string): string {
  return `${ATHLETE_REFERENCE_PREFIX}${membershipId}-${Date.now().toString(36)}`;
}

export function membershipIdFromAthleteReference(reference: string | null | undefined): string | null {
  if (!reference?.startsWith(ATHLETE_REFERENCE_PREFIX)) return null;
  const id = reference.slice(ATHLETE_REFERENCE_PREFIX.length, ATHLETE_REFERENCE_PREFIX.length + 36);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

function plain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

interface AthleteRow { id: string; role: string; tenant_id: string | null; full_name: string | null; email: string | null }

async function loadAthlete(admin: SupabaseClient, athleteId: string): Promise<AthleteRow | null> {
  const { data } = await admin.from("profiles").select("id, role, tenant_id, full_name, email").eq("id", athleteId).maybeSingle();
  return (data as AthleteRow | null) ?? null;
}

async function leagueName(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  return (data?.name as string | undefined) ?? "tu liga";
}

export type PrepareAthleteResult =
  | { ok: true; state: "link"; url: string; amount: number; season: number; expiresAt: Date }
  | { ok: true; state: "already_current"; season: number }
  | { ok: false; code: string; message: string; status: number };

const fail = (code: string, message: string, status: number): PrepareAthleteResult => ({ ok: false, code, message, status });

/**
 * Deja listo el cobro de la afiliación del atleta a SU liga en la temporada actual: crea (o reutiliza) la
 * afiliación y su link de Bold. El valor lo fija la liga; el navegador nunca lo elige.
 */
export async function prepareAthleteMembership(
  admin: SupabaseClient,
  athleteId: string,
  input: { createdBy: string | null; callbackUrl: string },
): Promise<PrepareAthleteResult> {
  const athlete = await loadAthlete(admin, athleteId);
  if (!athlete || athlete.role !== "athlete") return fail("NOT_FOUND", "No encontramos a ese atleta", 404);
  if (!athlete.tenant_id) return fail("NO_LEAGUE", "El atleta no pertenece a ninguna liga", 409);

  const season = await getCurrentSeason(admin, athlete.tenant_id);
  if (!season) return fail("NO_SEASON", "Tu liga aún no definió la temporada actual", 409);

  const { data: existing } = await admin
    .from("athlete_season_memberships")
    .select("id, status, amount, bold_link_id, payment_url, expires_at")
    .eq("athlete_id", athleteId).eq("tenant_id", athlete.tenant_id).eq("season", season.season).maybeSingle();
  if (existing && (existing.status === "paid" || existing.status === "exempt")) {
    return { ok: true, state: "already_current", season: season.season };
  }

  const amount = season.athleteFee ?? 0;
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return fail("NO_FEE", "Tu liga aún no definió la cuota de afiliación de atletas de esta temporada", 409);
  }

  if (
    existing && existing.bold_link_id && existing.payment_url && Number(existing.amount) === amount && existing.expires_at &&
    new Date(existing.expires_at as string).getTime() - Date.now() > REUSE_MIN_REMAINING_MS
  ) {
    const current = await getPaymentLink(existing.bold_link_id as string);
    if (current.ok && current.link.status === "ACTIVE") {
      return { ok: true, state: "link", url: existing.payment_url as string, amount, season: season.season, expiresAt: new Date(existing.expires_at as string) };
    }
  }

  let membershipId = existing?.id as string | undefined;
  if (!membershipId) {
    const { data: created, error } = await admin.from("athlete_season_memberships")
      .insert({ athlete_id: athleteId, tenant_id: athlete.tenant_id, season: season.season, amount, status: "awaiting_payment", created_by: input.createdBy })
      .select("id").single();
    if (error || !created) return fail("DB_ERROR", error?.message ?? "No se pudo crear la afiliación", 500);
    membershipId = created.id as string;
  }

  const league = await leagueName(admin, athlete.tenant_id);
  const expiresAt = new Date(Date.now() + LINK_VALID_MS);
  const reference = newAthleteReference(membershipId);
  const link = await createPaymentLink({
    amount,
    reference,
    description: plain(`Afiliacion atleta ${athlete.full_name ?? ""} - ${league} ${season.season}`).slice(0, 100),
    expiresAt,
    callbackUrl: input.callbackUrl,
  });
  if (!link.ok) return fail("BOLD_ERROR", link.error, 502);

  const { error: upErr } = await admin.from("athlete_season_memberships").update({
    amount, status: "awaiting_payment", bold_link_id: link.linkId, payment_url: link.url, reference,
    expires_at: expiresAt.toISOString(), bold_payment_id: null, paid_at: null,
  }).eq("id", membershipId);
  if (upErr) return fail("DB_ERROR", upErr.message, 500);

  return { ok: true, state: "link", url: link.url, amount, season: season.season, expiresAt };
}

async function notifyAthlete(admin: SupabaseClient, athlete: AthleteRow, season: number, amount: number, exempt: boolean, panelUrl: string): Promise<void> {
  if (!athlete.email || !athlete.tenant_id) return;
  const league = await leagueName(admin, athlete.tenant_id);
  const sent = await sendEmail({
    to: athlete.email,
    subject: athleteMembershipSubject({ leagueName: league, season }),
    html: athleteMembershipHtml({ fullName: athlete.full_name ?? "", leagueName: league, season, amountCop: amount, exempt, panelUrl }),
  });
  if (!sent.ok) console.error("No se pudo avisar al atleta de su afiliación:", sent.error);
}

export type AthleteActivation =
  | { state: "activated" }
  | { state: "not_paid"; boldStatus: BoldLinkStatus }
  | { state: "no_payment" }
  | { state: "error"; error: string };

/**
 * Marca la afiliación como pagada SOLO si Bold confirma el link (se consulta a Bold, no se confía en el cuerpo de
 * un webhook) y monto y referencia coinciden. Idempotente: repetirla no duplica el pago ni el correo.
 */
export async function activateAthleteMembershipIfPaid(admin: SupabaseClient, membershipId: string, panelUrl: string): Promise<AthleteActivation> {
  const { data: m, error } = await admin.from("athlete_season_memberships")
    .select("id, athlete_id, season, amount, status, bold_link_id, reference").eq("id", membershipId).maybeSingle();
  if (error) return { state: "error", error: error.message };
  if (!m) return { state: "no_payment" };
  if (m.status === "paid" || m.status === "exempt") return { state: "activated" };
  if (!m.bold_link_id) return { state: "no_payment" };

  const res = await getPaymentLink(m.bold_link_id as string);
  if (!res.ok) return { state: "error", error: res.error };
  if (res.link.status !== "PAID") return { state: "not_paid", boldStatus: res.link.status };
  if (res.link.total !== Number(m.amount) || res.link.reference !== (m.reference as string | null)) {
    return { state: "error", error: "El pago en Bold no coincide con el monto o la referencia esperados" };
  }

  // Reclamo atómico: si dos avisos llegan a la vez, solo uno pasa de awaiting_payment a paid.
  const { data: claimed, error: claimErr } = await admin.from("athlete_season_memberships")
    .update({ status: "paid", paid_at: new Date().toISOString(), bold_payment_id: res.link.transactionId })
    .eq("id", membershipId).eq("status", "awaiting_payment").select("id");
  if (claimErr) return { state: "error", error: claimErr.message };
  if (!claimed?.length) return { state: "activated" };

  const athlete = await loadAthlete(admin, m.athlete_id as string);
  if (athlete) await notifyAthlete(admin, athlete, m.season as number, Number(m.amount), false, panelUrl);
  return { state: "activated" };
}

/** Red de seguridad del webhook: revisa contra Bold las afiliaciones pendientes y activa las que figuren pagadas. */
export async function activatePendingAthleteMemberships(admin: SupabaseClient, panelUrl: string): Promise<number> {
  const { data: pending } = await admin.from("athlete_season_memberships")
    .select("id").eq("status", "awaiting_payment").not("bold_link_id", "is", null)
    .order("created_at", { ascending: false }).limit(5);
  let activated = 0;
  for (const row of pending ?? []) {
    const r = await activateAthleteMembershipIfPaid(admin, row.id as string, panelUrl);
    if (r.state === "activated") activated += 1;
    else if (r.state === "error") console.error("Revisión de afiliaciones de atleta:", r.error);
  }
  return activated;
}

/** La liga exonera a un atleta de la afiliación de la temporada actual: queda afiliado sin cobro. */
export async function exemptAthleteMembership(
  admin: SupabaseClient,
  athleteId: string,
  input: { reason: string; createdBy: string | null; panelUrl: string },
): Promise<{ ok: true; season: number } | { ok: false; code: string; message: string; status: number }> {
  const athlete = await loadAthlete(admin, athleteId);
  if (!athlete || athlete.role !== "athlete") return { ok: false, code: "NOT_FOUND", message: "No encontramos a ese atleta", status: 404 };
  if (!athlete.tenant_id) return { ok: false, code: "NO_LEAGUE", message: "El atleta no pertenece a ninguna liga", status: 409 };
  const season = await getCurrentSeason(admin, athlete.tenant_id);
  if (!season) return { ok: false, code: "NO_SEASON", message: "La liga aún no definió la temporada actual", status: 409 };

  const { data: existing } = await admin.from("athlete_season_memberships").select("id, status")
    .eq("athlete_id", athleteId).eq("tenant_id", athlete.tenant_id).eq("season", season.season).maybeSingle();
  if (existing && (existing.status === "paid" || existing.status === "exempt")) return { ok: true, season: season.season };

  const row = {
    athlete_id: athleteId, tenant_id: athlete.tenant_id, season: season.season, amount: 0, status: "exempt",
    exempt_reason: input.reason, paid_at: new Date().toISOString(), created_by: input.createdBy,
    bold_link_id: null, payment_url: null, reference: null, expires_at: null,
  };
  const { error } = existing
    ? await admin.from("athlete_season_memberships").update(row).eq("id", existing.id as string)
    : await admin.from("athlete_season_memberships").insert(row);
  if (error) return { ok: false, code: "DB_ERROR", message: error.message, status: 500 };

  await notifyAthlete(admin, athlete, season.season, 0, true, input.panelUrl);
  return { ok: true, season: season.season };
}
