import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentLink, getPaymentLink, type BoldLinkStatus } from "./bold";
import { sendEmail } from "./resend-server";
import {
  clubPaymentLinkHtml, clubPaymentLinkSubject,
  clubActivatedHtml, clubActivatedSubject,
  clubPaidLeagueHtml, clubPaidLeagueSubject,
} from "./email-templates/club-membership";

/** Prefijo de la referencia de Bold que distingue la cuota de un club de una afiliación de liga o una inscripción. */
export const CLUB_REFERENCE_PREFIX = "club-";

/** Bold: mínimo $1.000 por cobro; hasta $10.000.000 (tarjeta y PSE solo hasta $5.000.000). */
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 10_000_000;
const LINK_VALID_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
const REUSE_MIN_REMAINING_MS = 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** club-<id de la cuota>-<sufijo>: única por link (Bold no permite repetir una referencia); cabe en los 60 caracteres de Bold. */
export function newClubReference(membershipId: string): string {
  return `${CLUB_REFERENCE_PREFIX}${membershipId}-${Date.now().toString(36)}`;
}

/** Id de la cuota si la referencia es de un cobro de club; null si es otra cosa. */
export function membershipIdFromClubReference(reference: string | null | undefined): string | null {
  if (!reference?.startsWith(CLUB_REFERENCE_PREFIX)) return null;
  const id = reference.slice(CLUB_REFERENCE_PREFIX.length, CLUB_REFERENCE_PREFIX.length + 36);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

export interface CurrentSeason { season: number; clubFee: number | null; athleteFee: number | null }

export async function getCurrentSeason(admin: SupabaseClient, tenantId: string): Promise<CurrentSeason | null> {
  const { data } = await admin.from("league_seasons").select("season, club_fee, athlete_fee").eq("tenant_id", tenantId).eq("is_current", true).maybeSingle();
  if (!data) return null;
  return {
    season: data.season as number,
    clubFee: data.club_fee == null ? null : Number(data.club_fee),
    athleteFee: data.athlete_fee == null ? null : Number(data.athlete_fee),
  };
}

function plain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

interface ClubRow { id: string; name: string; tenant_id: string; owner_id: string | null; contact_email: string | null; approval_status: string }

async function loadClub(admin: SupabaseClient, clubId: string): Promise<ClubRow | null> {
  const { data } = await admin.from("clubs").select("id, name, tenant_id, owner_id, contact_email, approval_status").eq("id", clubId).maybeSingle();
  return (data as ClubRow | null) ?? null;
}

async function clubContact(admin: SupabaseClient, club: ClubRow): Promise<{ email: string | null; fullName: string }> {
  if (club.owner_id) {
    const { data } = await admin.from("profiles").select("email, full_name").eq("id", club.owner_id).maybeSingle();
    if (data?.email) return { email: data.email as string, fullName: (data.full_name as string | null) ?? club.name };
  }
  return { email: club.contact_email, fullName: club.name };
}

async function leagueInfo(admin: SupabaseClient, tenantId: string): Promise<{ name: string; adminEmails: string[] }> {
  const [{ data: tenant }, { data: admins }] = await Promise.all([
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    admin.from("profiles").select("email").eq("tenant_id", tenantId).eq("role", "admin"),
  ]);
  return {
    name: (tenant?.name as string | undefined) ?? "tu liga",
    adminEmails: [...new Set((admins ?? []).map((a) => a.email as string | null).filter((e): e is string => Boolean(e)))],
  };
}

export type PrepareClubResult =
  | { ok: true; state: "link"; url: string; amount: number; season: number; expiresAt: Date; membershipId: string }
  | { ok: true; state: "already_current"; season: number }
  | { ok: false; code: string; message: string; status: number };

const fail = (code: string, message: string, status: number): PrepareClubResult => ({ ok: false, code, message, status });

/**
 * Deja listo el cobro de la temporada actual de un club ya aprobado: crea (o reutiliza) la cuota y su link de Bold.
 * El valor lo fija la liga en su temporada actual; el cliente nunca elige el monto.
 */
export async function prepareClubMembership(
  admin: SupabaseClient,
  clubId: string,
  input: { createdBy: string | null; callbackUrl: string },
): Promise<PrepareClubResult> {
  const club = await loadClub(admin, clubId);
  if (!club) return fail("NOT_FOUND", "No encontramos ese club", 404);
  if (club.approval_status !== "active") return fail("NOT_APPROVED", "El club aún no fue aprobado por la liga", 409);

  const season = await getCurrentSeason(admin, club.tenant_id);
  if (!season) return fail("NO_SEASON", "La liga aún no definió su temporada actual", 409);

  const { data: existing } = await admin
    .from("club_season_memberships")
    .select("id, status, amount, bold_link_id, payment_url, expires_at")
    .eq("club_id", clubId).eq("season", season.season).maybeSingle();
  if (existing && (existing.status === "paid" || existing.status === "exempt")) {
    return { ok: true, state: "already_current", season: season.season };
  }

  const amount = season.clubFee ?? 0;
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return fail("NO_FEE", "La liga aún no definió la cuota de club de esta temporada (mínimo $1.000)", 409);
  }

  if (
    existing && existing.bold_link_id && existing.payment_url && Number(existing.amount) === amount && existing.expires_at &&
    new Date(existing.expires_at as string).getTime() - Date.now() > REUSE_MIN_REMAINING_MS
  ) {
    const current = await getPaymentLink(existing.bold_link_id as string);
    if (current.ok && current.link.status === "ACTIVE") {
      return { ok: true, state: "link", url: existing.payment_url as string, amount, season: season.season, expiresAt: new Date(existing.expires_at as string), membershipId: existing.id as string };
    }
  }

  let membershipId = existing?.id as string | undefined;
  if (!membershipId) {
    const { data: created, error } = await admin.from("club_season_memberships")
      .insert({ club_id: clubId, tenant_id: club.tenant_id, season: season.season, amount, status: "awaiting_payment", created_by: input.createdBy })
      .select("id").single();
    if (error || !created) return fail("DB_ERROR", error?.message ?? "No se pudo crear la cuota del club", 500);
    membershipId = created.id as string;
  }

  const { name: leagueName } = await leagueInfo(admin, club.tenant_id);
  const expiresAt = new Date(Date.now() + LINK_VALID_MS);
  const reference = newClubReference(membershipId);
  const link = await createPaymentLink({
    amount,
    reference,
    description: plain(`Cuota club ${club.name} - ${leagueName} ${season.season}`).slice(0, 100),
    expiresAt,
    callbackUrl: input.callbackUrl,
  });
  if (!link.ok) return fail("BOLD_ERROR", link.error, 502);

  const { error: upErr } = await admin.from("club_season_memberships").update({
    amount, status: "awaiting_payment", bold_link_id: link.linkId, payment_url: link.url, reference,
    expires_at: expiresAt.toISOString(), bold_payment_id: null, paid_at: null,
  }).eq("id", membershipId);
  if (upErr) return fail("DB_ERROR", upErr.message, 500);

  return { ok: true, state: "link", url: link.url, amount, season: season.season, expiresAt, membershipId };
}

/** Envía por correo el link de pago al club (aprobación o renovación). Devuelve si el correo salió. */
export async function emailClubPaymentLink(
  admin: SupabaseClient,
  clubId: string,
  info: { url: string; amount: number; season: number; expiresAt: Date; renewal: boolean },
): Promise<{ sent: boolean; error?: string }> {
  const club = await loadClub(admin, clubId);
  if (!club) return { sent: false, error: "club no encontrado" };
  const [contact, league] = await Promise.all([clubContact(admin, club), leagueInfo(admin, club.tenant_id)]);
  if (!contact.email) return { sent: false, error: "el club no tiene correo" };
  const sent = await sendEmail({
    to: contact.email,
    subject: clubPaymentLinkSubject({ clubName: club.name, season: info.season, renewal: info.renewal }),
    html: clubPaymentLinkHtml({
      fullName: contact.fullName, clubName: club.name, leagueName: league.name, season: info.season,
      amountCop: info.amount, paymentUrl: info.url, expiresAt: info.expiresAt, renewal: info.renewal,
    }),
  });
  return sent.ok ? { sent: true } : { sent: false, error: sent.error };
}

/** Avisos de club activo: al club y a los administradores de la liga, en paralelo (Bold exige responder al webhook en < 2 s). */
async function notifyClubActive(
  admin: SupabaseClient,
  club: ClubRow,
  season: number,
  amount: number,
  exempt: boolean,
  panelUrl: string,
): Promise<void> {
  const [contact, league] = await Promise.all([clubContact(admin, club), leagueInfo(admin, club.tenant_id)]);
  await Promise.all([
    contact.email
      ? sendEmail({
          to: contact.email,
          subject: clubActivatedSubject({ clubName: club.name, season }),
          html: clubActivatedHtml({ fullName: contact.fullName, clubName: club.name, leagueName: league.name, season, panelUrl, exempt }),
        }).then((r) => { if (!r.ok) console.error("No se pudo avisar al club que quedó activo:", r.error); })
      : Promise.resolve(),
    ...league.adminEmails.map((to) =>
      sendEmail({
        to,
        subject: clubPaidLeagueSubject({ clubName: club.name, exempt }),
        html: clubPaidLeagueHtml({ leagueName: league.name, clubName: club.name, season, amountCop: amount, exempt, panelUrl }),
      }).then((r) => { if (!r.ok) console.error("No se pudo avisar a la liga del pago del club:", r.error); })),
  ]);
}

export type ClubActivation =
  | { state: "activated" }
  | { state: "not_paid"; boldStatus: BoldLinkStatus }
  | { state: "no_payment" }
  | { state: "error"; error: string };

/**
 * Marca la cuota como pagada SOLO si Bold confirma el link (se consulta a Bold, no se confía en el cuerpo de un
 * webhook) y monto y referencia coinciden. Idempotente: repetirla no duplica el pago ni los correos.
 */
export async function activateClubMembershipIfPaid(admin: SupabaseClient, membershipId: string, panelUrl: string): Promise<ClubActivation> {
  const { data: m, error } = await admin.from("club_season_memberships")
    .select("id, club_id, season, amount, status, bold_link_id, reference").eq("id", membershipId).maybeSingle();
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
  const { data: claimed, error: claimErr } = await admin.from("club_season_memberships")
    .update({ status: "paid", paid_at: new Date().toISOString(), bold_payment_id: res.link.transactionId })
    .eq("id", membershipId).eq("status", "awaiting_payment").select("id");
  if (claimErr) return { state: "error", error: claimErr.message };
  if (!claimed?.length) return { state: "activated" };

  const club = await loadClub(admin, m.club_id as string);
  if (club) await notifyClubActive(admin, club, m.season as number, Number(m.amount), false, panelUrl);
  return { state: "activated" };
}

/** Red de seguridad del webhook: revisa contra Bold las cuotas de club aún pendientes y activa las que figuren pagadas. */
export async function activatePendingClubMemberships(admin: SupabaseClient, panelUrl: string): Promise<number> {
  const { data: pending } = await admin.from("club_season_memberships")
    .select("id").eq("status", "awaiting_payment").not("bold_link_id", "is", null)
    .order("created_at", { ascending: false }).limit(5);
  let activated = 0;
  for (const row of pending ?? []) {
    const r = await activateClubMembershipIfPaid(admin, row.id as string, panelUrl);
    if (r.state === "activated") activated += 1;
    else if (r.state === "error") console.error("Revisión de cuotas de club:", r.error);
  }
  return activated;
}

/** La liga exonera a un club de la cuota de la temporada actual: queda activo sin cobro. */
export async function exemptClubMembership(
  admin: SupabaseClient,
  clubId: string,
  input: { reason: string; createdBy: string | null; panelUrl: string },
): Promise<{ ok: true; season: number } | { ok: false; code: string; message: string; status: number }> {
  const club = await loadClub(admin, clubId);
  if (!club) return { ok: false, code: "NOT_FOUND", message: "No encontramos ese club", status: 404 };
  if (club.approval_status !== "active") return { ok: false, code: "NOT_APPROVED", message: "El club aún no fue aprobado por la liga", status: 409 };
  const season = await getCurrentSeason(admin, club.tenant_id);
  if (!season) return { ok: false, code: "NO_SEASON", message: "La liga aún no definió su temporada actual", status: 409 };

  const { data: existing } = await admin.from("club_season_memberships").select("id, status").eq("club_id", clubId).eq("season", season.season).maybeSingle();
  if (existing && (existing.status === "paid" || existing.status === "exempt")) return { ok: true, season: season.season };

  const row = {
    club_id: clubId, tenant_id: club.tenant_id, season: season.season, amount: 0, status: "exempt",
    exempt_reason: input.reason, paid_at: new Date().toISOString(), created_by: input.createdBy,
    bold_link_id: null, payment_url: null, reference: null, expires_at: null,
  };
  const { error } = existing
    ? await admin.from("club_season_memberships").update(row).eq("id", existing.id as string)
    : await admin.from("club_season_memberships").insert(row);
  if (error) return { ok: false, code: "DB_ERROR", message: error.message, status: 500 };

  await notifyClubActive(admin, club, season.season, 0, true, input.panelUrl);
  return { ok: true, season: season.season };
}

/**
 * Al cambiar la temporada actual de una liga: a cada club aprobado que aún no tiene su cuota de la nueva temporada se le
 * crea el link de pago y se le avisa por correo. Devuelve cuántos correos salieron y cuántos clubes no se pudieron avisar.
 */
export async function notifyClubsOfNewSeason(
  admin: SupabaseClient,
  tenantId: string,
  input: { callbackUrl: string; createdBy: string | null },
): Promise<{ notified: number; failed: number }> {
  const season = await getCurrentSeason(admin, tenantId);
  if (!season || !season.clubFee) return { notified: 0, failed: 0 };
  const { data: clubs } = await admin.from("clubs").select("id").eq("tenant_id", tenantId).eq("approval_status", "active").eq("status", "active");
  let notified = 0;
  let failed = 0;
  const ids = (clubs ?? []).map((c) => c.id as string);
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const prepared = await prepareClubMembership(admin, id, input);
      if (!prepared.ok) { failed += 1; console.error("Renovación de club:", prepared.message); return; }
      if (prepared.state === "already_current") return;
      const sent = await emailClubPaymentLink(admin, id, { url: prepared.url, amount: prepared.amount, season: prepared.season, expiresAt: prepared.expiresAt, renewal: true });
      if (sent.sent) notified += 1; else { failed += 1; console.error("Correo de renovación de club:", sent.error); }
    }));
  }
  return { notified, failed };
}
