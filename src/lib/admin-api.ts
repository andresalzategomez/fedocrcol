import { supabase } from "./supabase";

/**
 * Capa de datos del panel de administración (contra Supabase, respetando RLS).
 * Todas las funciones asumen que `supabase` está configurado; la UI valida
 * `isSupabaseConfigured` antes de usarlas.
 */
function db() {
  if (!supabase) throw new Error("Supabase no está configurado (revisa las variables VITE_).");
  return supabase;
}

/**
 * Token de acceso vigente para llamar los endpoints /api/admin/*. Si el que
 * hay guardado ya venció (o está por vencer en los próximos 60s), fuerza un
 * refresh antes de usarlo -- evita el caso típico de una pestaña que llevaba
 * rato abierta y cuyo access_token quedó vencido sin que el refresh
 * automático de supabase-js alcanzara a renovarlo a tiempo.
 */
async function getFreshToken(forceRefresh: boolean): Promise<string | null> {
  if (forceRefresh) {
    const { data, error } = await db().auth.refreshSession();
    return error ? null : (data.session?.access_token ?? null);
  }
  const { data } = await db().auth.getSession();
  const session = data.session;
  if (!session) return null;
  const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
  if (expiresInMs > 60_000) return session.access_token;
  const { data: refreshed, error } = await db().auth.refreshSession();
  return error ? session.access_token : (refreshed.session?.access_token ?? session.access_token);
}

/**
 * Petición autenticada a un endpoint /api/admin/*: arma el Bearer con un
 * token fresco y, si el servidor igual responde "token inválido o expirado"
 * (pudo vencer justo entre el chequeo y la llamada), reintenta una vez tras
 * forzar un refresh antes de rendirse.
 */
async function authFetch(path: string, body: unknown, method: "POST" | "DELETE" = "POST"): Promise<unknown> {
  let token = await getFreshToken(false);
  if (!token) throw new Error("Tu sesión expiró, vuelve a iniciar sesión.");

  async function call(bearer: string) {
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => ({}) as { error?: { code?: string; message?: string } });
    return { res, parsed: parsed as { error?: { code?: string; message?: string } } };
  }

  let { res, parsed } = await call(token);

  if (!res.ok && parsed.error?.code === "UNAUTHORIZED") {
    const fresh = await getFreshToken(true);
    if (fresh) ({ res, parsed } = await call(fresh));
  }

  if (!res.ok) {
    throw new Error(parsed.error?.message ?? "No se pudo completar la solicitud");
  }
  return parsed;
}

// ----------------------------- Tipos ---------------------------------
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  department: string;
  city: string | null;
  description: string | null;
  primary_color: string;
  secondary_color: string;
  status: "active" | "suspended" | "pending" | "awaiting_payment" | "rejected";
  /** false en el tenant de un club independiente: no puede crear carreras, solo ser club responsable. */
  allows_events?: boolean;
}
export interface PublicClub { id: string; name: string; tenant_id: string | null; }
export interface AdminClub {
  id: string; name: string; tenant_id: string | null; owner_id: string | null;
  approval_status: string; contact_email: string | null; city: string | null; department: string | null;
  status?: string;
}
export type EventStatus = "draft" | "pending_federation" | "approved" | "in_progress" | "finished" | "cancelled";
export interface EventRow {
  id: string;
  tenant_id: string;
  title: string;
  date: string;
  location: string;
  distance_km: number | null;
  obstacles: number | null;
  max_capacity: number;
  published: boolean;
  status: EventStatus;
  league_approved: boolean;
  federation_approved: boolean;
  is_official: boolean | null;
  /** Club responsable (solo carreras oficiales); null = la responsable es la liga. */
  club_id: string | null;
  club?: { name: string } | null;
  /** Último día (inclusive, hora de Colombia) para pagar la inscripción; null = sin fecha límite. */
  payment_deadline: string | null;
  /** Cuándo el director extendió el plazo por última vez (posponerlo o quitarlo). */
  payment_deadline_extended_at?: string | null;
  created_by: string | null;
  /** Quién aprueba la carrera cuando un gestor la envía: el director de la liga o la federación (si ella la creó). */
  approval_by?: "league" | "federation";
  /** La carrera entrega camiseta: el formulario de inscripción pide nombre y talla. */
  includes_shirt?: boolean;
  visibility: "public" | "private";
}
export interface EventCategory { id: string; event_id: string; name: string; price: number; slots_available: number; gender: string | null; min_age: number | null; max_age: number | null; }
export interface Checkpoint { id: string; event_id: string; name: string; ord: number; is_start: boolean; is_finish: boolean; }
export interface Judge { id: string; email: string | null; full_name: string | null; password_set_at: string | null; role?: string; tenant_id?: string | null; }
export interface RaceManager { id: string; email: string | null; full_name: string | null; password_set_at: string | null; }
export interface Wave { id: string; event_id: string; wave_number: number | null; name: string; scheduled_time: string | null; started_at: string | null; status: string; }
export interface EventResult {
  id: string;
  registration_id: string | null;
  bib_number: string | null;
  athlete_name: string | null;
  athlete_document: string | null;
  wave_id: string | null;
  wave_name: string | null;
  category_id: string | null;
  status: "finished" | "dnf" | "dns" | "dsq";
  start_time: string | null;
  finish_at: string | null;
  duration_ms: number | null;
  penalty_seconds: number;
  position: number | null;
}
export interface Category { id: string; name: string; level: string; gender: string; }
export interface Registration {
  id: string; event_id: string; bib_number: string | null; wave_id: string | null;
  status: string; athlete_name: string | null; athlete_document: string | null;
  athlete_gender: string | null; ranking_category_id: string | null; category_id: string;
}

// --------------------------- Ligas (tenants) -------------------------
export async function listTenants(): Promise<Tenant[]> {
  const { data, error } = await db().from("tenants").select("*").order("name");
  if (error) throw error;
  return data as Tenant[];
}

/** Clubes VIGENTES de una liga (aprobados y con la cuota de la temporada actual al día) -- para el combo del registro de atleta. */
export async function listClubsForTenant(tenantId: string): Promise<PublicClub[]> {
  const { data, error } = await db().from("clubs_current")
    .select("id, name, tenant_id")
    .eq("tenant_id", tenantId)
    .order("name");
  if (error) throw error;
  return data as PublicClub[];
}

// ------------------- Aprobaciones: ligas y clubes --------------------
/** Ligas por aprobar (pending) y ligas aprobadas que aún no pagan la afiliación (awaiting_payment). */
export async function listPendingLeagues(): Promise<Tenant[]> {
  const { data, error } = await db().from("tenants").select("*").in("status", ["pending", "awaiting_payment"]).order("name");
  if (error) throw error;
  return data as Tenant[];
}

/** Cobro de afiliación de una liga (tabla league_affiliation_payments; solo la federación y el admin de esa liga la leen). */
export interface LeaguePayment {
  tenant_id: string;
  amount: number;
  /** null cuando la federación eximió a la liga del pago. */
  payment_url: string | null;
  status: "pending" | "paid" | "exempt";
  expires_at: string | null;
}
export async function getLeaguePayment(tenantId: string): Promise<LeaguePayment | null> {
  const { data, error } = await db().from("league_affiliation_payments")
    .select("tenant_id, amount, payment_url, status, expires_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return data ? ({ ...data, amount: Number(data.amount) } as LeaguePayment) : null;
}
export async function listLeaguePayments(): Promise<Record<string, LeaguePayment>> {
  const { data, error } = await db().from("league_affiliation_payments")
    .select("tenant_id, amount, payment_url, status, expires_at");
  if (error) throw error;
  const byTenant: Record<string, LeaguePayment> = {};
  (data ?? []).forEach((r) => { byTenant[r.tenant_id as string] = { ...r, amount: Number(r.amount) } as LeaguePayment; });
  return byTenant;
}

/**
 * Solo la federación. Aprueba la liga definiendo la cuota de afiliación: el
 * servidor crea el link de pago en Bold y se lo envía por correo al admin de
 * la liga. También sirve para reenviar el link de una liga en awaiting_payment.
 */
export async function approveLeague(id: string, amount: number): Promise<{ payment_url: string; emails_sent: number; email_error: string | null }> {
  return (await authFetch("/api/admin/league-approve", { id, amount })) as { payment_url: string; emails_sent: number; email_error: string | null };
}
/** Solo la federación. Aprueba la liga eximiéndola del pago de afiliación: queda activa de inmediato. */
export async function approveLeagueExempt(id: string): Promise<{ emails_sent: number }> {
  return (await authFetch("/api/admin/league-approve", { id, exempt: true })) as { emails_sent: number };
}
export interface LeaguePaymentCheck {
  activated: boolean;
  bold_status?: string;
  /** El link anterior ya no servía (rechazado, vencido o cancelado) y se emitió uno nuevo con el mismo monto. */
  renewed?: boolean;
  payment_url?: string;
}
/** Pregunta a Bold si ya se pagó la afiliación y, si es así, activa la liga. Si el link murió, emite uno nuevo. */
export async function checkLeaguePayment(id: string, opts: { renew?: boolean } = {}): Promise<LeaguePaymentCheck> {
  return (await authFetch("/api/admin/league-check-payment", { id, ...opts })) as LeaguePaymentCheck;
}
export async function rejectLeague(id: string) {
  const { error } = await db().from("tenants").update({ status: "rejected" }).eq("id", id);
  if (error) throw error;
}
/** El propio admin de una liga rechazada puede reintentar (única transición que el trigger le permite). */
export async function retryLeague(id: string) {
  const { error } = await db().from("tenants").update({ status: "pending" }).eq("id", id);
  if (error) throw error;
}

/** Clubes que pidieron afiliarse a esta liga, pendientes de que su admin los apruebe. */
export async function listPendingClubRequests(tenantId: string): Promise<AdminClub[]> {
  const { data, error } = await db().from("clubs")
    .select("id, name, tenant_id, owner_id, approval_status, contact_email, city, department")
    .eq("tenant_id", tenantId).eq("approval_status", "pending").order("name");
  if (error) throw error;
  return data as AdminClub[];
}
/** Todos los clubes de una liga, sin importar su estado -- para la sección "Clubes" del panel. */
export async function listClubs(tenantId: string): Promise<AdminClub[]> {
  const { data, error } = await db().from("clubs")
    .select("id, name, tenant_id, owner_id, approval_status, contact_email, city, department, status")
    .eq("tenant_id", tenantId).order("name");
  if (error) throw error;
  return data as AdminClub[];
}
export async function rejectClubRequest(id: string) {
  const { error } = await db().from("clubs").update({ approval_status: "rejected" }).eq("id", id);
  if (error) throw error;
}
/**
 * Aprobación de un club por su liga (o la federación). Con cobro: el servidor crea el link de pago de la cuota de la
 * temporada actual y se lo envía al club; con `exempt` queda activo sin cobro. Sobre un club ya aprobado y sin pagar,
 * reenvía el link.
 */
export async function approveClub(id: string, opts: { exempt?: boolean; reason?: string } = {}): Promise<{
  payment_url?: string; amount?: number; season: number; email_sent?: boolean; email_error?: string | null; exempt?: boolean; already_current?: boolean;
}> {
  return (await authFetch("/api/club/membership", { action: "approve", club_id: id, ...opts })) as never;
}
/** Exonera a un club aprobado de la cuota de la temporada actual (motivo obligatorio). */
export async function exemptClub(id: string, reason: string): Promise<{ season: number }> {
  return (await authFetch("/api/club/membership", { action: "exempt", club_id: id, reason })) as never;
}
/** El club (o su liga) genera/reutiliza el link de pago de la temporada actual. */
export async function payClubMembership(clubId?: string): Promise<{ payment_url?: string; amount?: number; season: number; already_current?: boolean }> {
  return (await authFetch("/api/club/membership", { action: "pay", ...(clubId ? { club_id: clubId } : {}) })) as never;
}
/** Pregunta a Bold si ya se pagó la cuota y, si es así, deja el club activo. */
export async function checkClubMembership(clubId?: string): Promise<{ status: "none" | "awaiting_payment" | "paid" | "exempt"; season: number; bold_status?: string | null }> {
  return (await authFetch("/api/club/membership", { action: "check", ...(clubId ? { club_id: clubId } : {}) })) as never;
}

// ------------------------- Temporadas y cuotas -------------------------
export interface LeagueSeason {
  id: string; tenant_id: string; season: number; is_current: boolean; club_fee: number | null; athlete_fee: number | null;
}
const toSeason = (r: Record<string, unknown>): LeagueSeason => ({
  ...(r as unknown as LeagueSeason),
  club_fee: r["club_fee"] == null ? null : Number(r["club_fee"]),
  athlete_fee: r["athlete_fee"] == null ? null : Number(r["athlete_fee"]),
});
export async function listLeagueSeasons(tenantId: string): Promise<LeagueSeason[]> {
  const { data, error } = await db().from("league_seasons").select("*").eq("tenant_id", tenantId).order("season", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toSeason);
}
/** El administrador guarda una temporada y sus cuotas y, si lo pide, la deja como la actual (los clubes reciben el aviso de renovación). */
export async function saveSeason(input: { season: number; club_fee: number | null; athlete_fee: number | null; make_current: boolean }): Promise<{
  season: number; current_changed: boolean; notified: number; failed: number;
}> {
  return (await authFetch("/api/admin/season", input)) as never;
}

export interface ClubMembership {
  id: string; club_id: string; tenant_id: string; season: number; amount: number;
  status: "awaiting_payment" | "paid" | "exempt"; exempt_reason: string | null; payment_url: string | null;
  paid_at: string | null; expires_at: string | null;
}
const MEMBERSHIP_COLS = "id, club_id, tenant_id, season, amount, status, exempt_reason, payment_url, paid_at, expires_at";
const toMembership = (r: Record<string, unknown>): ClubMembership => ({ ...(r as unknown as ClubMembership), amount: Number(r["amount"]) });
/** Cuotas de club de una liga, de una temporada o de todas. */
export async function listClubMemberships(tenantId: string, season?: number): Promise<ClubMembership[]> {
  let q = db().from("club_season_memberships").select(MEMBERSHIP_COLS).eq("tenant_id", tenantId);
  if (season != null) q = q.eq("season", season);
  const { data, error } = await q.order("season", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toMembership);
}
/** La cuota de un club en la temporada indicada (null si aún no existe). */
export async function getClubMembership(clubId: string, season: number): Promise<ClubMembership | null> {
  const { data, error } = await db().from("club_season_memberships").select(MEMBERSHIP_COLS).eq("club_id", clubId).eq("season", season).maybeSingle();
  if (error) throw error;
  return data ? toMembership(data) : null;
}

// ------------------------ Afiliación del atleta (por temporada) ------------------------
export interface AthleteMembership {
  id: string; athlete_id: string; tenant_id: string; season: number; amount: number;
  status: "awaiting_payment" | "paid" | "exempt"; exempt_reason: string | null; payment_url: string | null; paid_at: string | null;
}
const ATHLETE_MEMBERSHIP_COLS = "id, athlete_id, tenant_id, season, amount, status, exempt_reason, payment_url, paid_at";
const toAthleteMembership = (r: Record<string, unknown>): AthleteMembership => ({ ...(r as unknown as AthleteMembership), amount: Number(r["amount"]) });

/** La afiliación de un atleta en una temporada (null si aún no existe). */
export async function getAthleteMembership(athleteId: string, tenantId: string, season: number): Promise<AthleteMembership | null> {
  const { data, error } = await db().from("athlete_season_memberships").select(ATHLETE_MEMBERSHIP_COLS)
    .eq("athlete_id", athleteId).eq("tenant_id", tenantId).eq("season", season).maybeSingle();
  if (error) throw error;
  return data ? toAthleteMembership(data) : null;
}
/** El atleta genera/reutiliza el link de pago de su afiliación a su liga en la temporada actual. */
export async function payAthleteMembership(): Promise<{ payment_url?: string; amount?: number; season: number; already_current?: boolean }> {
  return (await authFetch("/api/athlete/membership", { action: "pay" })) as never;
}
/** Pregunta a Bold si ya se pagó la afiliación y, si es así, la deja activa. */
export async function checkAthleteMembership(): Promise<{ status: "none" | "awaiting_payment" | "paid" | "exempt"; season: number; bold_status?: string | null }> {
  return (await authFetch("/api/athlete/membership", { action: "check" })) as never;
}
/** La liga (o la federación) exonera a un atleta de la afiliación de la temporada actual (motivo obligatorio). */
export async function exemptAthlete(athleteId: string, reason: string): Promise<{ season: number }> {
  return (await authFetch("/api/athlete/membership", { action: "exempt", athlete_id: athleteId, reason })) as never;
}

export interface LeagueAthlete {
  id: string; full_name: string | null; email: string | null; document_id: string | null; phone: string | null;
  gender: string | null; club_name: string | null; membership: AthleteMembership | null;
}
/** Atletas de la liga con el estado de su afiliación en la temporada indicada (para la pestaña Atletas de la liga). */
export async function listLeagueAthletes(tenantId: string, season: number | null): Promise<LeagueAthlete[]> {
  type P = { id: string; full_name: string | null; email: string | null; document_id: string | null; phone: string | null; gender: string | null };
  const profiles = await fetchAllRows<P>((f, t) => db().from("profiles")
    .select("id, full_name, email, document_id, phone, gender").eq("tenant_id", tenantId).eq("role", "athlete").order("full_name").range(f, t) as unknown as PromiseLike<{ data: P[] | null; error: unknown }>);
  const memberships = season == null ? [] : await fetchAllRows<AthleteMembership>((f, t) => db().from("athlete_season_memberships")
    .select(ATHLETE_MEMBERSHIP_COLS).eq("tenant_id", tenantId).eq("season", season).range(f, t) as unknown as PromiseLike<{ data: AthleteMembership[] | null; error: unknown }>);
  const byAthlete = new Map(memberships.map((m) => [m.athlete_id, toAthleteMembership(m as unknown as Record<string, unknown>)]));
  type A = { athlete_id: string; club: { name: string } | null };
  const affiliations = await fetchAllRows<A>((f, t) => db().from("affiliations")
    .select("athlete_id, club:clubs(name)").eq("tenant_id", tenantId).not("club_id", "is", null).range(f, t) as unknown as PromiseLike<{ data: A[] | null; error: unknown }>);
  const clubByAthlete = new Map(affiliations.map((a) => [a.athlete_id, a.club?.name ?? null]));
  return profiles.map((p) => ({ ...p, club_name: clubByAthlete.get(p.id) ?? null, membership: byAthlete.get(p.id) ?? null }));
}

// ------------------------ Acuerdo federación - liga ------------------------
/** Porcentaje de la afiliación de atletas que la federación le liquida a cada liga (por liga; solo lo edita la federación). */
export async function listLeagueAgreements(): Promise<Record<string, number | null>> {
  const { data, error } = await db().from("league_agreements").select("tenant_id, athlete_fee_league_pct");
  if (error) throw error;
  const byTenant: Record<string, number | null> = {};
  (data ?? []).forEach((r) => { byTenant[r.tenant_id as string] = r.athlete_fee_league_pct == null ? null : Number(r.athlete_fee_league_pct); });
  return byTenant;
}
export async function setLeagueAthleteFeePct(tenantId: string, pct: number | null): Promise<void> {
  if (pct != null && (pct < 0 || pct > 100)) throw new Error("El porcentaje debe estar entre 0 y 100");
  const { data: userData } = await db().auth.getUser();
  const { error } = await db().from("league_agreements")
    .upsert({ tenant_id: tenantId, athlete_fee_league_pct: pct, updated_by: userData.user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) throw error;
}

// ----------------------- Reporte de cobros por concepto -----------------------
export type ChargeConcept = "liga" | "club" | "atleta" | "inscripcion";
export const CHARGE_CONCEPT_LABEL: Record<ChargeConcept, string> = {
  liga: "Afiliación de liga", club: "Cuota de club", atleta: "Afiliación de atleta", inscripcion: "Inscripción a carrera",
};
export interface Charge {
  key: string;
  concept: ChargeConcept;
  /** Fecha del pago (ISO). */
  date: string;
  /** Quién pagó. */
  payer: string;
  /** Liga a la que corresponde el cobro (para filtrar). */
  league: string;
  /** Carrera, temporada, etc. */
  detail: string;
  amount: number;
  exempt: boolean;
  /** Lo que la federación debe liquidar al beneficiario: el total, salvo en la afiliación de atleta (porcentaje acordado con la liga). */
  payout: number;
  /** Afiliación de atleta: % acordado para la liga; null si la federación aún no lo definió. */
  share_pct: number | null;
  /** A quién le corresponde el dinero (quien liquida la federación). */
  beneficiary: string;
  beneficiary_kind: "federacion" | "liga" | "club";
}

/**
 * Reporte para la federación: cada cobro aprobado con su concepto, quién pagó y a quién le corresponde.
 * Afiliación de liga -> federación; cuota de club -> la liga; inscripción -> el club responsable (carrera oficial
 * con club) o la liga. La liquidación se hace a mano. Las exoneraciones salen en $0. Solo la federación lo ve (RLS).
 */
export async function listChargesReport(): Promise<Charge[]> {
  type LeagueRaw = { tenant_id: string; amount: number; exempt: boolean; paid_at: string | null; tenant: { name: string } | null };
  type ClubRaw = { id: string; season: number; amount: number; status: string; paid_at: string | null; club: { name: string } | null; tenant: { name: string } | null };
  type PayRaw = {
    id: string; amount: number; created_at: string;
    registration: { athlete_name: string | null; event: { title: string; is_official: boolean | null; club: { name: string } | null; league: { name: string } | null } | null } | null;
  };
  type AthleteRaw = { id: string; tenant_id: string; season: number; amount: number; status: string; paid_at: string | null; athlete: { full_name: string | null } | null; tenant: { name: string } | null };
  const [leagues, clubs, pays, athletes, agreements] = await Promise.all([
    fetchAllRows<LeagueRaw>((f, t) => db().from("league_affiliation_payments")
      .select("tenant_id, amount, exempt, paid_at, tenant:tenants(name)").in("status", ["paid", "exempt"]).range(f, t) as unknown as PromiseLike<{ data: LeagueRaw[] | null; error: unknown }>),
    fetchAllRows<ClubRaw>((f, t) => db().from("club_season_memberships")
      .select("id, season, amount, status, paid_at, club:clubs(name), tenant:tenants(name)").in("status", ["paid", "exempt"]).range(f, t) as unknown as PromiseLike<{ data: ClubRaw[] | null; error: unknown }>),
    fetchAllRows<PayRaw>((f, t) => db().from("payments")
      .select("id, amount, created_at, registration:registrations(athlete_name, event:events(title, is_official, club:clubs(name), league:tenants(name)))")
      .eq("status", "approved").range(f, t) as unknown as PromiseLike<{ data: PayRaw[] | null; error: unknown }>),
    fetchAllRows<AthleteRaw>((f, t) => db().from("athlete_season_memberships")
      .select("id, tenant_id, season, amount, status, paid_at, athlete:profiles(full_name), tenant:tenants(name)").in("status", ["paid", "exempt"]).range(f, t) as unknown as PromiseLike<{ data: AthleteRaw[] | null; error: unknown }>),
    listLeagueAgreements(),
  ]);

  const out: Charge[] = [];
  leagues.forEach((r) => out.push({
    key: `liga:${r.tenant_id}`, concept: "liga", date: r.paid_at ?? "", payer: r.tenant?.name ?? "—", league: r.tenant?.name ?? "—",
    detail: r.exempt ? "Exonerada por la federación" : "Cuota de afiliación", amount: Number(r.amount), exempt: Boolean(r.exempt),
    payout: Number(r.amount), share_pct: null, beneficiary: "Federación", beneficiary_kind: "federacion",
  }));
  clubs.forEach((r) => out.push({
    key: `club:${r.id}`, concept: "club", date: r.paid_at ?? "", payer: r.club?.name ?? "—", league: r.tenant?.name ?? "—",
    detail: `Temporada ${r.season}${r.status === "exempt" ? " (exonerado)" : ""}`, amount: Number(r.amount), exempt: r.status === "exempt",
    payout: Number(r.amount), share_pct: null, beneficiary: r.tenant?.name ?? "—", beneficiary_kind: "liga",
  }));
  athletes.forEach((r) => {
    const pct = agreements[r.tenant_id] ?? null;
    out.push({
      key: `atleta:${r.id}`, concept: "atleta", date: r.paid_at ?? "", payer: r.athlete?.full_name ?? "—", league: r.tenant?.name ?? "—",
      detail: `Temporada ${r.season}${r.status === "exempt" ? " (exonerado)" : ""}`, amount: Number(r.amount), exempt: r.status === "exempt",
      // La federación recauda y liquida a la liga el % acordado; sin % definido no hay nada que liquidar todavía.
      payout: pct == null ? 0 : Math.round((Number(r.amount) * pct) / 100), share_pct: pct,
      beneficiary: r.tenant?.name ?? "—", beneficiary_kind: "liga",
    });
  });
  pays.forEach((r) => {
    const ev = r.registration?.event;
    const byClub = Boolean(ev?.is_official && ev.club);
    out.push({
      key: `pago:${r.id}`, concept: "inscripcion", date: r.created_at, payer: r.registration?.athlete_name ?? "—", league: ev?.league?.name ?? "—",
      detail: ev?.title ?? "—", amount: Number(r.amount), exempt: false, payout: Number(r.amount), share_pct: null,
      beneficiary: byClub ? (ev?.club?.name ?? "—") : (ev?.league?.name ?? "—"), beneficiary_kind: byClub ? "club" : "liga",
    });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function createTenant(input: {
  name: string; slug: string; department: string; city?: string;
  primary_color?: string; secondary_color?: string;
}): Promise<Tenant> {
  const { data, error } = await db().from("tenants").insert({
    name: input.name,
    slug: input.slug,
    department: input.department,
    city: input.city ?? null,
    primary_color: input.primary_color ?? "#2de47f",
    secondary_color: input.secondary_color ?? "#ff9f1c",
    status: "active",
  }).select("*").single();
  if (error) throw error;
  return data as Tenant;
}

/** Identidad de la liga: nombre, ubicación, descripción y colores -- lo que se ve en el sitio público. */
export async function updateTenant(id: string, patch: {
  name?: string; department?: string; city?: string | null; description?: string | null;
  primary_color?: string; secondary_color?: string;
}) {
  const { error } = await db().from("tenants").update(patch).eq("id", id);
  if (error) throw error;
}

export async function setTenantStatus(id: string, status: "active" | "suspended") {
  const { error } = await db().from("tenants").update({ status }).eq("id", id);
  if (error) throw error;
}

// ------------------------------ Eventos ------------------------------
export async function listEvents(tenantId: string): Promise<EventRow[]> {
  const { data, error } = await db().from("events").select("*, club:clubs(name)").eq("tenant_id", tenantId).order("date", { ascending: false });
  if (error) throw error;
  return data as EventRow[];
}

/**
 * Carreras que un gestor tiene asignadas. No basta con listEvents(): las carreras publicadas son de
 * lectura pública, así que el gestor las vería todas aunque no las gestione.
 */
export async function listAssignedEvents(tenantId: string, userId: string): Promise<EventRow[]> {
  const { data, error } = await db().from("event_managers").select("event_id").eq("user_id", userId);
  if (error) throw error;
  const assigned = new Set((data ?? []).map((r) => (r as { event_id: string }).event_id));
  return (await listEvents(tenantId)).filter((e) => assigned.has(e.id));
}

export async function createEvent(input: {
  tenant_id: string; title: string; date: string; location: string; is_official: boolean; club_id?: string | null; payment_deadline?: string | null;
  distance_km?: number | undefined; obstacles?: number | undefined; max_capacity?: number | undefined; visibility?: "public" | "private";
  includes_shirt?: boolean;
}): Promise<EventRow> {
  if (input.payment_deadline && input.payment_deadline > input.date) {
    throw new Error("La fecha límite de pago no puede ser posterior a la fecha de la carrera");
  }
  const { data, error } = await db().from("events").insert({
    tenant_id: input.tenant_id,
    title: input.title,
    date: input.date,
    location: input.location,
    is_official: input.is_official,
    club_id: input.is_official ? (input.club_id ?? null) : null,
    payment_deadline: input.payment_deadline || null,
    visibility: input.visibility ?? "private",
    includes_shirt: input.includes_shirt ?? false,
    distance_km: input.distance_km ?? null,
    obstacles: input.obstacles ?? null,
    max_capacity: input.max_capacity ?? 0,
    published: false,
    status: "draft",
  }).select("*").single();
  if (error) throw error;
  const ev = data as EventRow;
  // Sembrar el maestro de categorías de la carrera con el catálogo nacional.
  await seedStandardCategories(ev.id);
  return ev;
}

/** Edita los datos propios de la carrera (no su estado/aprobación). Usado por admin y por race_manager. */
export async function updateEvent(id: string, patch: {
  title?: string; date?: string; location?: string; is_official?: boolean; club_id?: string | null; payment_deadline?: string | null;
  distance_km?: number | null; obstacles?: number | null; max_capacity?: number; visibility?: "public" | "private";
  includes_shirt?: boolean;
}): Promise<void> {
  const { error } = await db().from("events").update(patch).eq("id", id);
  if (error) throw error;
}

export interface ResponsibleClub { id: string; name: string; independent: boolean; }
/** Clubes que pueden ser responsables de una carrera oficial de esta liga: los vigentes de la propia liga. */
export async function listEligibleResponsibleClubs(tenantId: string): Promise<ResponsibleClub[]> {
  const { data, error } = await db().from("clubs_current").select("id, name").eq("tenant_id", tenantId).order("name");
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id as string, name: c.name as string, independent: false }));
}

/** Lee todas las filas de una consulta (PostgREST devuelve máximo 1.000 por página). */
async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

/** Una carrera en el reporte de cobros de la federación. */
export interface CobroCarrera {
  event_id: string;
  title: string;
  date: string;
  status: string;
  league: string;
  is_official: boolean | null;
  /** Quién recibe el cobro: el club (carrera oficial con club responsable) o, si no, la liga. */
  responsible_key: string;
  responsible: string;
  responsible_kind: "club" | "liga";
  independent_club: boolean;
  paid: number;
  pending: number;
  collected: number;
}

/**
 * Reporte para que la federación liquide a mano: por carrera, quién es el responsable del cobro
 * (el club si es oficial y tiene club responsable; la liga si no) y cuánto se recaudó en pagos
 * aprobados. Solo lo ve la federación (RLS de payments/registrations/events).
 */
export async function listCollectionsReport(): Promise<CobroCarrera[]> {
  type EventRaw = {
    id: string; title: string; date: string; status: string; is_official: boolean | null;
    club_id: string | null; tenant_id: string;
    club: { name: string; tenant: { allows_events: boolean } | null } | null;
    league: { name: string } | null;
  };
  const [events, regs, pays] = await Promise.all([
    fetchAllRows<EventRaw>((f, t) => db().from("events")
      .select("id, title, date, status, is_official, club_id, tenant_id, club:clubs(name, tenant:tenants(allows_events)), league:tenants(name)")
      .order("date", { ascending: false }).range(f, t) as unknown as PromiseLike<{ data: EventRaw[] | null; error: unknown }>),
    fetchAllRows<{ event_id: string; status: string }>((f, t) => db().from("registrations").select("event_id, status").range(f, t)),
    fetchAllRows<{ amount: number; registrations: { event_id: string } | null }>((f, t) => db().from("payments")
      .select("amount, registrations!inner(event_id)").eq("status", "approved").range(f, t) as unknown as PromiseLike<{ data: { amount: number; registrations: { event_id: string } | null }[] | null; error: unknown }>),
  ]);

  const paid = new Map<string, number>();
  const pending = new Map<string, number>();
  regs.forEach((r) => {
    if (r.status === "paid") paid.set(r.event_id, (paid.get(r.event_id) ?? 0) + 1);
    else if (r.status === "pending") pending.set(r.event_id, (pending.get(r.event_id) ?? 0) + 1);
  });
  const collected = new Map<string, number>();
  pays.forEach((p) => {
    const id = p.registrations?.event_id;
    if (id) collected.set(id, (collected.get(id) ?? 0) + Number(p.amount));
  });

  return events.map((e) => {
    const byClub = Boolean(e.is_official && e.club_id && e.club);
    const league = e.league?.name ?? "—";
    return {
      event_id: e.id, title: e.title, date: e.date, status: e.status, league, is_official: e.is_official,
      responsible_key: byClub ? `club:${e.club_id}` : `liga:${e.tenant_id}`,
      responsible: byClub ? (e.club as { name: string }).name : league,
      responsible_kind: byClub ? "club" : "liga",
      independent_club: byClub && e.club?.tenant?.allows_events === false,
      paid: paid.get(e.id) ?? 0, pending: pending.get(e.id) ?? 0, collected: collected.get(e.id) ?? 0,
    } satisfies CobroCarrera;
  });
}

/** "18-29 Femenino" → 18–29; "50+ Masculino" → desde 50; sin edad en el nombre → sin rango. */
export function ageRangeFromName(name: string): { min_age: number | null; max_age: number | null } {
  const range = name.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (range) return { min_age: Number(range[1]), max_age: Number(range[2]) };
  const open = name.match(/(\d{1,2})\s*\+/);
  if (open) return { min_age: Number(open[1]), max_age: null };
  return { min_age: null, max_age: null };
}

/** Copia el catálogo nacional de categorías al maestro de esta carrera. */
export async function seedStandardCategories(eventId: string): Promise<void> {
  const cats = await listCategories();
  if (!cats.length) return;
  const rows = cats.map((c) => ({
    event_id: eventId, name: c.name, gender: (c as unknown as { gender: string }).gender ?? null,
    ...ageRangeFromName(c.name),
    price: 0, slots_available: 0,
  }));
  // Evitar duplicados si ya hay categorías con esos nombres.
  const existing = await listEventCategories(eventId);
  const have = new Set(existing.map((e) => e.name));
  const toInsert = rows.filter((r) => !have.has(r.name));
  if (toInsert.length) {
    const { error } = await db().from("event_categories").insert(toInsert);
    if (error) throw error;
  }
}

/** Carreras pendientes de aprobación de la federación: solo las que ella misma creó (las de las ligas las aprueba su director). */
export async function listPendingFederation(): Promise<EventRow[]> {
  const { data, error } = await db().from("events").select("*").eq("status", "pending_federation").eq("approval_by", "federation").order("date");
  if (error) throw error;
  return data as EventRow[];
}

/** Envía la carrera a aprobación (la aprueba el director de la liga, o la federación si ella la creó). */
export async function submitEvent(id: string) {
  const { error } = await db().from("events")
    .update({ status: "pending_federation", submitted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Aprueba el evento (queda publicado y descargable por el Timer). Lo hace quien corresponde según approval_by. */
export async function approveEvent(id: string) {
  const { error } = await db().from("events")
    .update({ status: "approved", league_approved: true, federation_approved: true, published: true, approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** La federación rechaza: vuelve a borrador para que la liga lo corrija. */
export async function rejectEvent(id: string) {
  const { error } = await db().from("events")
    .update({ status: "draft", league_approved: false, federation_approved: false, published: false })
    .eq("id", id);
  if (error) throw error;
}

/** Cambia el estado de carrera (in_progress / finished / cancelled). */
export async function setEventStatus(id: string, status: EventStatus) {
  const { error } = await db().from("events").update({ status }).eq("id", id);
  if (error) throw error;
}

// --------------------------- Modalidades -----------------------------
export async function listEventCategories(eventId: string): Promise<EventCategory[]> {
  const { data, error } = await db().from("event_categories").select("*").eq("event_id", eventId).order("name");
  if (error) throw error;
  return data as EventCategory[];
}
export async function createEventCategory(eventId: string, input: {
  name: string; gender?: string | null; min_age?: number | null; max_age?: number | null;
  price?: number; slots_available?: number;
}) {
  const { error } = await db().from("event_categories").insert({
    event_id: eventId, name: input.name, gender: input.gender ?? null,
    min_age: input.min_age ?? null, max_age: input.max_age ?? null,
    price: input.price ?? 0, slots_available: input.slots_available ?? 0,
  });
  if (error) throw error;
}

/** Precio y cupos de una categoría -- sin esto quedan en 0 y el formulario público nunca la deja seleccionar. */
export async function updateEventCategory(id: string, patch: { price?: number; slots_available?: number; min_age?: number | null; max_age?: number | null }) {
  const { error } = await db().from("event_categories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteEventCategory(id: string) {
  const { error } = await db().from("event_categories").delete().eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23503") {
      throw new Error("No se puede eliminar esta categoría: ya tiene atletas inscritos o depende de ella una oleada.");
    }
    throw error;
  }
}

// ---------------------------- Checkpoints ----------------------------
export async function listCheckpoints(eventId: string): Promise<Checkpoint[]> {
  const { data, error } = await db().from("checkpoints").select("*").eq("event_id", eventId).order("ord");
  if (error) throw error;
  return data as Checkpoint[];
}
/**
 * Crea el checkpoint al final de la lista. Salida (primero) y Meta (último) ya no se marcan a mano:
 * se deducen del orden (ver reorder_checkpoints en la base de datos).
 */
export async function createCheckpoint(tenantId: string, eventId: string, input: { name: string }): Promise<string> {
  const existing = await listCheckpoints(eventId);
  const ord = existing.reduce((m, c) => Math.max(m, c.ord), 0) + 1;
  const { data, error } = await db().from("checkpoints")
    .insert({ tenant_id: tenantId, event_id: eventId, name: input.name, ord, is_start: false, is_finish: false })
    .select("id").single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await reorderCheckpoints(eventId, [...existing.map((c) => c.id), id]);
  return id;
}

/** Fija el orden consecutivo (1..N) según la lista y recalcula Salida (primero) y Meta (último). */
export async function reorderCheckpoints(eventId: string, orderedIds: string[]): Promise<void> {
  const { error } = await db().rpc("reorder_checkpoints", { p_event_id: eventId, p_ids: orderedIds });
  if (error) throw error;
}

/** Elimina el checkpoint y reacomoda el orden para que quede consecutivo. */
export async function deleteCheckpoint(id: string, eventId: string) {
  const { error } = await db().from("checkpoints").delete().eq("id", id);
  if (error) throw error;
  const remaining = await listCheckpoints(eventId);
  if (remaining.length) await reorderCheckpoints(eventId, remaining.map((c) => c.id));
}

// ------------------------------- Jueces -------------------------------
/**
 * Jueces de la liga, para asignarlos a checkpoints de cualquiera de sus
 * carreras: cuentas dedicadas (rol `judge`, tenant_id = esta liga) más
 * los admins/superadmins o jueces de OTRA liga marcados en tenant_judges
 * como "también disponibles como juez" de esta -- conservan su rol y su
 * liga de origen, ver migraciones 0026/0028.
 */
export async function listJudges(tenantId: string): Promise<Judge[]> {
  const [{ data: dedicated, error: dedicatedErr }, { data: extra, error: extraErr }] = await Promise.all([
    db().from("profiles").select("id, email, full_name, password_set_at, role, tenant_id").eq("tenant_id", tenantId).eq("role", "judge"),
    db().from("tenant_judges").select("profiles(id, email, full_name, password_set_at, role, tenant_id)").eq("tenant_id", tenantId),
  ]);
  if (dedicatedErr) throw dedicatedErr;
  if (extraErr) throw extraErr;
  const extraJudges = (extra ?? [])
    .map((r) => {
      const p = (r as { profiles: Judge | Judge[] }).profiles;
      return Array.isArray(p) ? p[0] : p;
    })
    .filter((j): j is Judge => Boolean(j));
  return [...(dedicated as Judge[]), ...extraJudges].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

/** Invita a un juez por correo (crea su cuenta vía service_role en el servidor). Requiere sesión activa. */
export async function inviteJudge(input: { full_name: string; email: string }): Promise<Judge> {
  return (await authFetch("/api/admin/judges", input)) as Judge;
}

/** Elimina la cuenta de un juez (invitación pendiente o ya aceptada). Requiere sesión activa. */
export async function removeJudge(id: string): Promise<void> {
  await authFetch("/api/admin/judges", { id }, "DELETE");
}

export async function listRaceManagers(tenantId: string): Promise<RaceManager[]> {
  const { data, error } = await db().from("profiles")
    .select("id, email, full_name, password_set_at").eq("tenant_id", tenantId).eq("role", "race_manager").order("full_name");
  if (error) throw error;
  return data as RaceManager[];
}

/** Invita a un gestor de carreras por correo (crea su cuenta vía service_role en el servidor). Requiere sesión activa. */
export async function inviteRaceManager(input: { full_name: string; email: string }): Promise<RaceManager> {
  return (await authFetch("/api/admin/race-managers", input)) as RaceManager;
}

/** IDs de los gestores asignados a una carrera. */
export async function listEventManagerIds(eventId: string): Promise<string[]> {
  const { data, error } = await db().from("event_managers").select("user_id").eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { user_id: string }).user_id);
}

/** Asigna un gestor a la carrera (lo hace el director de la liga, o la federación si ella la creó). */
export async function assignEventManager(eventId: string, userId: string): Promise<void> {
  const { error } = await db().from("event_managers").insert({ event_id: eventId, user_id: userId, tenant_id: "00000000-0000-0000-0000-000000000000" });
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

export async function unassignEventManager(eventId: string, userId: string): Promise<void> {
  const { error } = await db().from("event_managers").delete().eq("event_id", eventId).eq("user_id", userId);
  if (error) throw error;
}

/** Elimina la cuenta de un gestor de carreras (invitación pendiente o ya aceptada). Requiere sesión activa. */
export async function removeRaceManager(id: string): Promise<void> {
  await authFetch("/api/admin/race-managers", { id }, "DELETE");
}

/** IDs de checkpoints asignados a cada juez, para una carrera puntual. */
export async function listCheckpointJudges(eventId: string): Promise<Record<string, string[]>> {
  const { data, error } = await db().from("checkpoint_judges")
    .select("judge_id, checkpoint_id, checkpoints!inner(event_id)").eq("checkpoints.event_id", eventId);
  if (error) throw error;
  const byJudge: Record<string, string[]> = {};
  (data ?? []).forEach((r) => {
    const judgeId = (r as { judge_id: string }).judge_id;
    (byJudge[judgeId] ??= []).push((r as { checkpoint_id: string }).checkpoint_id);
  });
  return byJudge;
}

export async function assignJudgeToCheckpoint(tenantId: string, checkpointId: string, judgeId: string) {
  const { error } = await db().from("checkpoint_judges").insert({ tenant_id: tenantId, checkpoint_id: checkpointId, judge_id: judgeId });
  if (error && (error as { code?: string }).code !== "23505") throw error; // 23505: ya estaba asignado, no pasa nada
}

export async function unassignJudgeFromCheckpoint(checkpointId: string, judgeId: string) {
  const { error } = await db().from("checkpoint_judges").delete().eq("checkpoint_id", checkpointId).eq("judge_id", judgeId);
  if (error) throw error;
}

// ------------------------------ Oleadas ------------------------------
export async function listWaves(eventId: string): Promise<Wave[]> {
  const { data, error } = await db().from("waves").select("*").eq("event_id", eventId).order("wave_number");
  if (error) throw error;
  return data as Wave[];
}
export async function createWave(tenantId: string, eventId: string, input: {
  wave_number: number; name: string; scheduled_time?: string | null;
}) {
  const { error } = await db().from("waves").insert({
    tenant_id: tenantId, event_id: eventId,
    wave_number: input.wave_number, name: input.name,
    scheduled_time: input.scheduled_time ?? null, status: "pending",
  });
  if (error) throw error;
}

// ---------------------- Categorías (catálogo) ------------------------
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await db().from("categories").select("id, name, level, gender").order("name");
  if (error) throw error;
  return data as Category[];
}

/** Conteo de inscritos por evento (para reportes). */
export async function registrationCountsByEvent(tenantId: string): Promise<Record<string, number>> {
  const { data, error } = await db().from("registrations").select("event_id").eq("tenant_id", tenantId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  (data ?? []).forEach((r) => { const id = (r as { event_id: string }).event_id; counts[id] = (counts[id] ?? 0) + 1; });
  return counts;
}

// --------------------------- Inscripciones ---------------------------
export async function listRegistrations(eventId: string): Promise<Registration[]> {
  const { data, error } = await db().from("registrations")
    .select("id, event_id, bib_number, wave_id, status, athlete_name, athlete_document, athlete_gender, ranking_category_id, category_id")
    .eq("event_id", eventId).order("bib_number");
  if (error) throw error;
  return data as Registration[];
}

/** Atleta que se inscribió pero aún no pagó: dato de mercadeo para contactarlo y entender por qué. */
export interface UnpaidRegistration {
  id: string; athlete_name: string | null; athlete_document: string | null;
  athlete_email: string | null; athlete_phone: string | null;
  category_id: string; amount: number; created_at: string;
}
/** Inscripciones pendientes de pago de una carrera, las más antiguas primero. Solo las lee el admin de la liga o la federación (RLS). */
export async function listUnpaidRegistrations(eventId: string): Promise<UnpaidRegistration[]> {
  const { data, error } = await db().from("registrations")
    .select("id, athlete_name, athlete_document, athlete_email, athlete_phone, category_id, amount, created_at")
    .eq("event_id", eventId).eq("status", "pending").order("created_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as UnpaidRegistration[];
}

/** Dorsal para mostrar/exportar: siempre 4 dígitos con ceros a la izquierda ("0001"). */
export function formatBib(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * Próximo dorsal disponible del evento (máximo + 1, empezando en 1).
 * Trae todos los dorsales del evento y los parsea en el cliente en vez de
 * ordenar por texto en la BD — bib_number es texto con ceros a la
 * izquierda, y un `order by` de texto solo da el máximo numérico correcto
 * si todos los valores tienen el mismo ancho (ya no se puede asumir con
 * datos históricos).
 */
export async function nextBib(eventId: string): Promise<number> {
  const { data } = await db().from("registrations")
    .select("bib_number").eq("event_id", eventId).not("bib_number", "is", null);
  const max = (data ?? []).reduce((m, r) => {
    const n = parseInt(String((r as { bib_number: string }).bib_number), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return max + 1;
}

export async function updateRegistration(id: string, patch: {
  bib_number?: number | null; wave_id?: string | null; status?: string; category_id?: string;
}) {
  const dbPatch: Record<string, unknown> = { ...patch };
  if ("bib_number" in patch) dbPatch["bib_number"] = patch.bib_number == null ? null : formatBib(patch.bib_number);
  const { error } = await db().from("registrations").update(dbPatch).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505" && "bib_number" in patch) {
      throw new Error("Ese dorsal ya está en uso en esta carrera");
    }
    throw error;
  }
}

/** Asigna dorsal a los inscritos que aún no tienen, en orden de inscripción. Devuelve cuántos se asignaron. */
export async function bulkAssignBibs(eventId: string): Promise<number> {
  const { data, error } = await db().from("registrations")
    .select("id, bib_number, created_at")
    .eq("event_id", eventId)
    .is("bib_number", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const pending = (data ?? []) as { id: string }[];
  if (!pending.length) return 0;
  let next = await nextBib(eventId);
  for (const r of pending) {
    const { error: upErr } = await db().from("registrations").update({ bib_number: formatBib(next) }).eq("id", r.id);
    if (upErr) throw upErr;
    next += 1;
  }
  return pending.length;
}

// ------------------- Generación automática de oleadas ----------------
export async function deleteWave(id: string) {
  const { error } = await db().from("waves").delete().eq("id", id);
  if (error) throw error;
}
export async function updateWave(id: string, patch: { wave_number?: number; name?: string; scheduled_time?: string | null; status?: string }) {
  const { error } = await db().from("waves").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Genera oleadas automáticamente: separadas por categoría y con máximo
 * `waveSize` atletas por oleada. Borra las oleadas previas del evento y
 * reasigna a los inscritos. Devuelve cuántas oleadas se crearon.
 *
 * `schedule`, si viene, fija `scheduled_time` de cada oleada como
 * `startTime + (n-1) * intervalMinutes` según su `wave_number` — el mismo
 * intervalo configurado en el panel para "cada cuántos minutos salen".
 */
export async function generateWaves(
  tenantId: string, eventId: string, waveSize: number,
  schedule?: { startTime: string; intervalMinutes: number } | null,
): Promise<number> {
  if (!waveSize || waveSize < 1) throw new Error("El tamaño de oleada debe ser mayor que 0");

  // 1) Borrar oleadas previas (los registros quedan con wave_id = null por FK).
  const existing = await listWaves(eventId);
  for (const w of existing) await deleteWave(w.id);

  // 2) Traer inscritos y categorías del evento.
  const [regs, cats] = await Promise.all([listRegistrations(eventId), listEventCategories(eventId)]);
  const catName = new Map(cats.map((c) => [c.id, c.name] as const));

  // 3) Agrupar por categoría.
  const byCat = new Map<string, typeof regs>();
  for (const r of regs) {
    const key = r.category_id;
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(r);
  }

  // 4) Crear oleadas por categoría en bloques de waveSize y reasignar.
  let waveNo = 0;
  for (const [catId, list] of byCat) {
    list.sort((a, b) => parseInt(a.bib_number ?? "0", 10) - parseInt(b.bib_number ?? "0", 10));
    const name = catName.get(catId) ?? "Categoría";
    for (let i = 0; i < list.length; i += waveSize) {
      waveNo += 1;
      const chunk = list.slice(i, i + waveSize);
      const scheduled_time = schedule
        ? new Date(new Date(schedule.startTime).getTime() + (waveNo - 1) * schedule.intervalMinutes * 60000).toISOString()
        : null;
      const { data, error } = await db().from("waves").insert({
        tenant_id: tenantId, event_id: eventId, category_id: catId,
        wave_number: waveNo, name: `${name} - Oleada ${Math.floor(i / waveSize) + 1}`, status: "pending",
        scheduled_time,
      }).select("id").single();
      if (error) throw error;
      const waveId = (data as { id: string }).id;
      const ids = chunk.map((c) => c.id);
      const { error: upErr } = await db().from("registrations").update({ wave_id: waveId }).in("id", ids);
      if (upErr) throw upErr;
    }
  }
  return waveNo;
}

// ------------------------- Resultados en vivo -------------------------
interface ResultRow {
  id: string;
  registration_id: string | null;
  status: EventResult["status"];
  start_time: string | null;
  finish_at: string | null;
  duration_ms: number | null;
  penalty_seconds: number;
  position: number | null;
  registrations: {
    bib_number: string | null; athlete_name: string | null; athlete_document: string | null; wave_id: string | null;
    category_id: string | null; waves: { name: string } | null;
  } | null;
}

export async function listResults(eventId: string): Promise<EventResult[]> {
  const { data, error } = await db().from("results")
    .select("id, registration_id, status, start_time, finish_at, duration_ms, penalty_seconds, position, registrations(bib_number, athlete_name, athlete_document, wave_id, category_id, waves(name))")
    .eq("event_id", eventId)
    .order("position", { ascending: true, nullsFirst: false })
    .order("duration_ms", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data as unknown as ResultRow[] ?? []).map((r) => ({
    id: r.id,
    registration_id: r.registration_id,
    bib_number: r.registrations?.bib_number ?? null,
    athlete_name: r.registrations?.athlete_name ?? null,
    athlete_document: r.registrations?.athlete_document ?? null,
    wave_id: r.registrations?.wave_id ?? null,
    wave_name: r.registrations?.waves?.name ?? null,
    category_id: r.registrations?.category_id ?? null,
    status: r.status,
    start_time: r.start_time,
    finish_at: r.finish_at,
    duration_ms: r.duration_ms,
    penalty_seconds: r.penalty_seconds,
    position: r.position,
  }));
}

/** Pide al servidor (service role) que recalcule las posiciones del evento. */
export async function recalculatePositions(eventId: string): Promise<void> {
  await authFetch("/api/admin/recalculate-positions", { event_id: eventId });
}
