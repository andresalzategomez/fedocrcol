import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, CalendarPlus, Flag, Users, Timer, Plus, Trash2, Send, CheckCircle2, XCircle, ClipboardCheck, Wand2, Layers, GripVertical, ArrowUp, ArrowDown, FileSpreadsheet, FileText, Hash, RefreshCw, Trophy, Gavel, Mail, UserCog, Palette, Link2, Banknote } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useSession, type Profile } from "@/lib/use-session";
import { useColombiaLocation } from "@/lib/use-colombia-location";
import { useTenantTheme } from "@/lib/tenant-theme";
import * as api from "@/lib/admin-api";
import type { Tenant, EventRow, EventStatus } from "@/lib/admin-api";
import { validateForm, required, slug as slugRule, numeric, positiveInt, decimalNonNeg } from "@/lib/validate";
import { exportExcel, exportPDF, type Column } from "@/lib/export";
import { RESULT_STATUS_LABEL, formatDuration, rankResults } from "@/lib/results";
import { formatCOP } from "@/data/demo";
import { bogotaToday, paymentWindow } from "@/lib/payment-window";

export const Route = createFileRoute("/panel")({
  head: () => ({ meta: [{ title: "Panel de administración — FEDOCR Colombia" }, { name: "robots", content: "noindex" }] }),
  component: PanelPage,
});

function PanelPage() {
  const { loading, email, profile, signOut } = useSession();
  if (!isSupabaseConfigured) return <Shell><Note>Configura las variables de Supabase para usar el panel real.</Note></Shell>;
  if (loading) return <Shell><Note>Cargando…</Note></Shell>;
  if (!profile) return <Shell><Note>Debes iniciar sesión para administrar. <Link className="text-primary underline" to="/auth">Ir a ingresar</Link>.</Note></Shell>;
  if (profile.role === "athlete") {
    return (
      <Shell>
        <AthleteProfilePanel profile={profile} email={email} onSignOut={signOut} />
      </Shell>
    );
  }
  if (profile.role === "judge") return <Shell><Note>Tu cuenta es de juez. Usa FedOCR Timer para cronometrar — este panel es para administradores de liga.</Note></Shell>;
  if (profile.role === "club") {
    return (
      <Shell>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-4xl">Panel de administración</h1>
            <p className="text-sm text-muted-foreground">{email} · Club</p>
          </div>
          <Button variant="outline" onClick={signOut}>Salir</Button>
        </div>
        <ClubStatusNote userId={profile.id} />
      </Shell>
    );
  }

  if (profile.role === "race_manager") {
    if (!profile.tenant_id) return <Shell><Note>Tu cuenta no tiene una liga asignada.</Note></Shell>;
    return (
      <Shell>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-4xl">Panel de administración</h1>
            <p className="text-sm text-muted-foreground">{email} · Gestor de carreras</p>
          </div>
          <Button variant="outline" onClick={signOut}>Salir</Button>
        </div>
        <GestorConsole tenantId={profile.tenant_id} userId={profile.id} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Panel de administración</h1>
          <p className="text-sm text-muted-foreground">{email} · {profile.role === "superadmin" ? "Administración nacional" : "Administrador de liga"}</p>
        </div>
        <Button variant="outline" onClick={signOut}>Salir</Button>
      </div>
      {profile.role === "admin" ? (
        <AdminGate tenantId={profile.tenant_id} userId={profile.id} />
      ) : (
        <AdminConsole role={profile.role} userId={profile.id} fixedTenant={profile.tenant_id} />
      )}
    </Shell>
  );
}

/** Para un admin de liga: bloquea el panel si su liga sigue pendiente de aprobación (o suspendida). */
function AdminGate({ tenantId, userId }: { tenantId: string | null; userId: string }) {
  const [tenant, setTenant] = useState<Tenant | "loading" | "none">("loading");
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) { setTenant("none"); return; }
    try {
      const all = await api.listTenants();
      setTenant(all.find((t) => t.id === tenantId) ?? "none");
    } catch { setTenant("none"); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  // El panel de un admin de liga es una página "de esa liga" -- se ve con
  // sus colores, igual que /ligas/:slug y el detalle de sus carreras.
  useTenantTheme(
    tenant !== "loading" && tenant !== "none"
      ? { primary_color: tenant.primary_color, secondary_color: tenant.secondary_color }
      : null,
  );

  async function retry() {
    if (!tenantId) return;
    setRetrying(true);
    try { await api.retryLeague(tenantId); toast.success("Solicitud reenviada"); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setRetrying(false); }
  }

  if (tenant === "loading") return <Note>Cargando…</Note>;
  if (tenant === "none") return <Note>Tu cuenta no tiene una liga asignada.</Note>;
  if (tenant.status === "pending") return <Note>Tu liga está <strong>pendiente de aprobación</strong> de la federación. Te avisaremos por correo cuando quede activa.</Note>;
  if (tenant.status === "awaiting_payment") return <AffiliationPaymentNote tenantId={tenant.id} onActivated={load} />;
  if (tenant.status === "suspended") return <Note>Tu liga está suspendida. Contacta a la federación.</Note>;
  if (tenant.status === "rejected") {
    return (
      <Note>
        <p className="mb-3">La solicitud de tu liga fue rechazada.</p>
        <Button size="sm" onClick={retry} disabled={retrying}>{retrying ? "Enviando..." : "Volver a solicitar"}</Button>
      </Note>
    );
  }
  return <AdminConsole role="admin" userId={userId} fixedTenant={tenantId} />;
}

/** Liga aprobada por la federación a la espera del pago de la cuota de afiliación (link de Bold). */
function AffiliationPaymentNote({ tenantId, onActivated }: { tenantId: string; onActivated: () => void }) {
  const [payment, setPayment] = useState<api.LeaguePayment | null | "loading">("loading");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.getLeaguePayment(tenantId).then(setPayment).catch(() => setPayment(null));
  }, [tenantId]);

  // Bold devuelve a la admin a este panel al terminar de pagar: mientras la pantalla esté
  // abierta se pregunta a Bold cada 10 s, así la liga se activa aunque el webhook no llegue.
  const onActivatedRef = useRef(onActivated);
  onActivatedRef.current = onActivated;
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await api.checkLeaguePayment(tenantId, { renew: false });
        if (!stopped && r.activated) {
          toast.success("¡Pago confirmado! Tu liga ya está activa.");
          onActivatedRef.current();
        }
      } catch { /* sin sesión o sin red: se reintenta en el siguiente ciclo */ }
    }
    poll();
    const timer = setInterval(poll, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [tenantId]);

  async function check() {
    setChecking(true);
    try {
      const r = await api.checkLeaguePayment(tenantId);
      if (r.activated) { toast.success("¡Pago confirmado! Tu liga ya está activa."); onActivated(); }
      else if (r.renewed) {
        toast.warning("El pago anterior no se completó (fue rechazado o el link venció). Generamos un link nuevo: pulsa \"Pagar la afiliación\".");
        setPayment(await api.getLeaguePayment(tenantId));
      }
      else toast.info("Todavía no vemos el pago. Si ya pagaste, espera unos minutos y vuelve a verificar.");
    } catch (e) { toast.error((e as Error).message); } finally { setChecking(false); }
  }

  if (payment === "loading") return <Note>Cargando…</Note>;
  if (!payment) {
    return <Note>Tu liga fue <strong>aprobada</strong>, pero aún no encontramos el link de pago de la afiliación. Contacta a la federación.</Note>;
  }
  return (
    <Note>
      <p className="mb-1">Tu liga fue <strong>aprobada</strong> por la federación. Para activarla falta pagar la cuota de afiliación:</p>
      <p className="mb-3 font-display text-2xl">{formatCOP(payment.amount)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => payment.payment_url && window.open(payment.payment_url, "_blank", "noopener,noreferrer")}>Pagar la afiliación</Button>
        <Button size="sm" variant="outline" onClick={check} disabled={checking}>{checking ? "Verificando..." : "Ya pagué, verificar"}</Button>
      </div>
      {payment.expires_at ? (
        <p className="mt-3 text-xs text-muted-foreground">El link vence el {new Date(payment.expires_at).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}. Al confirmarse el pago, tu liga se activa sola y te avisamos por correo.</p>
      ) : null}
    </Note>
  );
}

/** Para un club: muestra su estado de aprobación, o le permite reintentar si fue rechazado. */
function ClubStatusNote({ userId }: { userId: string }) {
  const [club, setClub] = useState<{ id: string; name: string; tenant_id: string | null; approval_status: string } | "loading" | "none">("loading");
  const [season, setSeason] = useState<api.LeagueSeason | null>(null);
  const [membership, setMembership] = useState<api.ClubMembership | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setClub("none"); return; }
    const { data } = await supabase.from("clubs").select("id, name, tenant_id, approval_status").eq("owner_id", userId).maybeSingle();
    if (!data) { setClub("none"); return; }
    const c = { id: data.id as string, name: data.name as string, tenant_id: data.tenant_id as string | null, approval_status: data.approval_status as string };
    setClub(c);
    if (c.approval_status === "active" && c.tenant_id) {
      try {
        const current = (await api.listLeagueSeasons(c.tenant_id)).find((s) => s.is_current) ?? null;
        setSeason(current);
        setMembership(current ? await api.getClubMembership(c.id, current.season) : null);
      } catch { setSeason(null); setMembership(null); }
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const awaiting = club !== "loading" && club !== "none" && club.approval_status === "active" && !!season && !(membership && (membership.status === "paid" || membership.status === "exempt"));

  // Bold devuelve al club a este panel al terminar de pagar: mientras haya un pago pendiente se pregunta a Bold cada 10 s.
  useEffect(() => {
    if (!awaiting || !membership || membership.status !== "awaiting_payment") return;
    let stopped = false;
    async function poll() {
      try {
        const r = await api.checkClubMembership();
        if (!stopped && (r.status === "paid" || r.status === "exempt")) { toast.success("¡Pago confirmado! Tu club ya está activo."); load(); }
      } catch { /* sin red: se reintenta */ }
    }
    const timer = setInterval(poll, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [awaiting, membership, load]);

  async function retry() {
    if (!supabase || club === "loading" || club === "none") return;
    setRetrying(true);
    try {
      const { error } = await supabase.from("clubs").update({ approval_status: "pending" }).eq("id", club.id);
      if (error) throw error;
      toast.success("Solicitud reenviada");
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setRetrying(false); }
  }

  async function pay() {
    setPaying(true);
    try {
      const r = await api.payClubMembership();
      if (r.already_current) { toast.success("Tu club ya está al día"); load(); return; }
      if (r.payment_url) window.open(r.payment_url, "_blank", "noopener,noreferrer");
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setPaying(false); }
  }

  async function check() {
    setChecking(true);
    try {
      const r = await api.checkClubMembership();
      if (r.status === "paid" || r.status === "exempt") { toast.success("¡Pago confirmado! Tu club ya está activo."); load(); }
      else toast.info("Todavía no vemos el pago. Si ya pagaste, espera unos minutos y vuelve a verificar.");
    } catch (e) { toast.error((e as Error).message); } finally { setChecking(false); }
  }

  if (club === "loading") return <Note>Cargando…</Note>;
  if (club === "none") return <Note>No encontramos tu club. Contacta a soporte.</Note>;
  if (club.approval_status === "pending") return <Note>Tu club <strong>{club.name}</strong> está <strong>pendiente de aprobación</strong> de la liga. Te avisaremos por correo cuando responda.</Note>;
  if (club.approval_status === "rejected") {
    return (
      <Note>
        <p className="mb-3">Tu solicitud de club fue rechazada.</p>
        <Button size="sm" onClick={retry} disabled={retrying}>{retrying ? "Enviando..." : "Volver a solicitar"}</Button>
      </Note>
    );
  }
  if (!season) return <Note>Tu club <strong>{club.name}</strong> fue aprobado, pero tu liga aún no definió la temporada actual. Te avisaremos por correo.</Note>;
  if (membership && (membership.status === "paid" || membership.status === "exempt")) {
    return (
      <Note>
        <p className="mb-1">Tu club <strong>{club.name}</strong> está <strong>activo</strong> en la temporada <strong>{season.season}</strong>.</p>
        <p className="text-xs">
          {membership.status === "exempt"
            ? "Tu liga te exoneró de la cuota de esta temporada."
            : `Cuota pagada: ${formatCOP(membership.amount)}${membership.paid_at ? ` el ${new Date(membership.paid_at).toLocaleDateString("es-CO")}` : ""}.`}
        </p>
      </Note>
    );
  }
  const fee = membership?.amount ?? season.club_fee;
  return (
    <Note>
      <p className="mb-1">Tu club <strong>{club.name}</strong> fue <strong>aprobado</strong> por la liga. Para dejarlo activo en la temporada <strong>{season.season}</strong> falta pagar la cuota:</p>
      {fee ? <p className="mb-3 font-display text-2xl">{formatCOP(fee)}</p> : <p className="mb-3 text-xs">Tu liga aún no definió el valor de la cuota.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={pay} disabled={paying || !fee}>{paying ? "Generando link..." : "Pagar la cuota"}</Button>
        <Button size="sm" variant="outline" onClick={check} disabled={checking || !membership}>{checking ? "Verificando..." : "Ya pagué, verificar"}</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Sin el pago, tu club no aparece en la liga y tus atletas no pueden elegirlo. Se activa solo cuando Bold confirma el pago.</p>
    </Note>
  );
}

const PROFILE_DOCUMENT_TYPES = [
  { value: "CC", label: "Cédula de ciudadanía" },
  { value: "TI", label: "Tarjeta de identidad" },
  { value: "CE", label: "Cédula de extranjería" },
  { value: "PA", label: "Pasaporte" },
] as const;
const PROFILE_BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;
const PROFILE_SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

/** Afiliación del atleta a SU liga en la temporada actual (pago por Bold). No es requisito para inscribirse a carreras. */
function AfiliacionCard({ profile }: { profile: Profile }) {
  const tenantId = profile.tenant_id;
  const [state, setState] = useState<"loading" | "no_league" | "ready">("loading");
  const [league, setLeague] = useState("");
  const [season, setSeason] = useState<api.LeagueSeason | null>(null);
  const [membership, setMembership] = useState<api.AthleteMembership | null>(null);
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) { setState("no_league"); return; }
    try {
      const [{ data: t }, seasons] = await Promise.all([
        supabase ? supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
        api.listLeagueSeasons(tenantId),
      ]);
      setLeague((t?.name as string | undefined) ?? "tu liga");
      const current = seasons.find((s) => s.is_current) ?? null;
      setSeason(current);
      setMembership(current ? await api.getAthleteMembership(profile.id, tenantId, current.season) : null);
    } catch { /* se muestra el estado sin datos */ }
    setState("ready");
  }, [tenantId, profile.id]);
  useEffect(() => { load(); }, [load]);

  const affiliated = membership?.status === "paid" || membership?.status === "exempt";

  // Bold devuelve al atleta a este panel al terminar de pagar: con un pago pendiente se pregunta a Bold cada 10 s.
  useEffect(() => {
    if (!membership || membership.status !== "awaiting_payment") return;
    let stopped = false;
    async function poll() {
      try {
        const r = await api.checkAthleteMembership();
        if (!stopped && (r.status === "paid" || r.status === "exempt")) { toast.success("¡Pago confirmado! Ya estás afiliado a tu liga."); load(); }
      } catch { /* sin red: se reintenta */ }
    }
    const timer = setInterval(poll, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [membership, load]);

  async function pay() {
    setPaying(true);
    try {
      const r = await api.payAthleteMembership();
      if (r.already_current) { toast.success("Ya estás afiliado"); load(); return; }
      if (r.payment_url) window.open(r.payment_url, "_blank", "noopener,noreferrer");
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setPaying(false); }
  }
  async function check() {
    setChecking(true);
    try {
      const r = await api.checkAthleteMembership();
      if (r.status === "paid" || r.status === "exempt") { toast.success("¡Pago confirmado! Ya estás afiliado a tu liga."); load(); }
      else toast.info("Todavía no vemos el pago. Si ya pagaste, espera unos minutos y vuelve a verificar.");
    } catch (e) { toast.error((e as Error).message); } finally { setChecking(false); }
  }

  if (state === "loading") return null;
  if (state === "no_league") return <div className="mb-6"><Note>Aún no perteneces a ninguna liga.</Note></div>;
  if (!season) return <div className="mb-6"><Note>Tu liga <strong>{league}</strong> aún no definió la temporada actual, por eso todavía no puedes afiliarte.</Note></div>;

  const fee = membership?.amount || season.athlete_fee;
  return (
    <div className="mb-6">
      <Note>
        <p className="mb-1 font-medium text-foreground">Afiliación a la Liga {league} · temporada {season.season}</p>
        {affiliated ? (
          <>
            <p><Badge variant="default"><CheckCircle2 className="mr-1 size-3" />Afiliado</Badge></p>
            <p className="mt-2 text-xs">
              {membership?.status === "exempt"
                ? "Tu liga te exoneró de la cuota de esta temporada."
                : `Cuota pagada: ${formatCOP(membership?.amount ?? 0)}${membership?.paid_at ? ` el ${new Date(membership.paid_at).toLocaleDateString("es-CO")}` : ""}.`}
            </p>
          </>
        ) : fee ? (
          <>
            <p className="mb-2">Para pertenecer a tu liga en esta temporada paga la cuota de afiliación:</p>
            <p className="mb-3 font-display text-2xl">{formatCOP(fee)}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={pay} disabled={paying}>{paying ? "Generando link..." : "Pagar mi afiliación"}</Button>
              <Button size="sm" variant="outline" onClick={check} disabled={checking || !membership}>{checking ? "Verificando..." : "Ya pagué, verificar"}</Button>
            </div>
            <p className="mt-3 text-xs">La afiliación es independiente de la inscripción a carreras: puedes inscribirte a cualquier carrera.</p>
          </>
        ) : (
          <p>Tu liga aún no definió la cuota de afiliación de esta temporada.</p>
        )}
      </Note>
    </div>
  );
}

function AthleteProfilePanel({ profile, email, onSignOut }: { profile: Profile; email: string | null; onSignOut: () => void }) {
  const [form, setForm] = useState({
    full_name: profile.full_name ?? "",
    document_type: profile.document_type ?? "",
    document_id: profile.document_id ?? "",
    birth_date: profile.birth_date ?? "",
    phone: profile.phone ?? "",
    gender: profile.gender ?? "",
    social_media: profile.social_media ?? "",
    eps: profile.eps ?? "",
    blood_type: profile.blood_type ?? "",
    emergency_contact_name: profile.emergency_contact_name ?? "",
    emergency_contact_phone: profile.emergency_contact_phone ?? "",
    shirt_name: profile.shirt_name ?? "",
    shirt_size: profile.shirt_size ?? "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!supabase) return;
    if (!form.full_name.trim()) { toast.error("Escribe tu nombre completo"); return; }
    if (!form.document_type) { toast.error("Selecciona el tipo de documento"); return; }
    if (!form.document_id.trim()) { toast.error("Escribe tu número de documento"); return; }
    if (!form.birth_date) { toast.error("Selecciona tu fecha de nacimiento"); return; }
    if (!form.phone.trim()) { toast.error("Escribe tu celular"); return; }
    if (!form.gender) { toast.error("Selecciona tu género"); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name,
          document_type: form.document_type,
          document_id: form.document_id,
          birth_date: form.birth_date,
          phone: form.phone,
          gender: form.gender,
          social_media: form.social_media || null,
          eps: form.eps || null,
          blood_type: form.blood_type || null,
          emergency_contact_name: form.emergency_contact_name || null,
          emergency_contact_phone: form.emergency_contact_phone || null,
          shirt_name: form.shirt_name || null,
          shirt_size: form.shirt_size || null,
        })
        .eq("id", profile.id);
      if (error) throw error;
      toast.success("Perfil actualizado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Mi perfil</h1>
          <p className="text-sm text-muted-foreground">{email} · Atleta</p>
        </div>
        <Button variant="outline" onClick={onSignOut}>Salir</Button>
      </div>
      <AfiliacionCard profile={profile} />
      <Card className="border-border/70">
        <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
          <Field label="Nombre completo"><Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} /></Field>
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Field label="Tipo doc.">
              <Select value={form.document_type} onValueChange={(v) => set("document_type", v)}>
                <SelectTrigger className="w-28"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>{PROFILE_DOCUMENT_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.value}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Número de documento"><Input value={form.document_id} onChange={(e) => set("document_id", e.target.value)} /></Field>
          </div>
          <Field label="Fecha de nacimiento"><Input type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></Field>
          <Field label="Celular"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Género">
            <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="F">Femenino</SelectItem>
                <SelectItem value="M">Masculino</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Redes sociales (opcional)"><Input value={form.social_media} onChange={(e) => set("social_media", e.target.value)} placeholder="@usuario" /></Field>
          <Field label="EPS"><Input value={form.eps} onChange={(e) => set("eps", e.target.value)} /></Field>
          <Field label="RH">
            <Select value={form.blood_type} onValueChange={(v) => set("blood_type", v)}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>{PROFILE_BLOOD_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Contacto de emergencia"><Input value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} /></Field>
          <Field label="Celular contacto de emergencia"><Input value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} /></Field>
          <Field label="Nombre para camiseta"><Input value={form.shirt_name} onChange={(e) => set("shirt_name", e.target.value)} /></Field>
          <Field label="Talla para camiseta">
            <Select value={form.shirt_size} onValueChange={(v) => set("shirt_size", v)}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>{PROFILE_SHIRT_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen"><SiteHeader /><div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</div><SiteFooter /></div>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{children}</div>;
}

const STATUS_LABEL: Record<EventStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending_federation: { label: "Pend. aprobación", variant: "outline" },
  approved: { label: "Aprobado", variant: "default" },
  in_progress: { label: "En curso", variant: "default" },
  finished: { label: "Finalizado", variant: "secondary" },
  cancelled: { label: "Cancelado", variant: "destructive" },
};
function StatusBadge({ status }: { status: EventStatus }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.draft;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Puede gestionar el contenido de la carrera (categorías, inscritos, oleadas,
 * checkpoints) quien es dueño de su liga, o el superadmin que la creó — nunca
 * si ya está en curso. Espejo de `can_manage_event()` en la base de datos:
 * esto solo evita intentos inútiles en la UI, la regla real la aplica RLS.
 */
function canManageEvent(event: EventRow, isSuper: boolean, userId: string): boolean {
  if (event.status === "in_progress" || event.status === "finished") return false;
  if (isSuper) return event.created_by === userId;
  return true;
}
/**
 * Quién aprueba una carrera enviada a revisión: el director de la liga, o la federación si ella la creó.
 * Espejo de la regla de la base de datos (trigger enforce_events_write_rules).
 */
function canApproveEvent(event: EventRow, isSuper: boolean): boolean {
  return event.approval_by === "federation" ? isSuper : !isSuper;
}
const TENANT_STATUS_LABEL: Record<Tenant["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Activa", variant: "default" },
  pending: { label: "Pendiente", variant: "outline" },
  awaiting_payment: { label: "Falta el pago", variant: "secondary" },
  rejected: { label: "Rechazada", variant: "destructive" },
  suspended: { label: "Suspendida", variant: "destructive" },
};
/** Responsable de una carrera oficial: el club asignado, o la liga si no tiene club. */
function ResponsableText({ event }: { event: EventRow }) {
  if (!event.is_official) return null;
  return <span className="text-xs text-muted-foreground">Responsable: {event.club?.name ?? "la liga"}</span>;
}

/** Solo aplica a carreras oficiales: elegir el club responsable (por defecto, la liga). */
function ResponsableField({ tenantId, isOfficial, value, onChange, disabled }: {
  tenantId: string; isOfficial: string; value: string; onChange: (clubId: string) => void; disabled?: boolean;
}) {
  const [clubs, setClubs] = useState<api.ResponsibleClub[]>([]);
  useEffect(() => {
    if (isOfficial !== "true") return;
    api.listEligibleResponsibleClubs(tenantId).then(setClubs).catch(() => setClubs([]));
  }, [tenantId, isOfficial]);
  if (isOfficial !== "true") return null;
  return (
    <Field label="Responsable de la carrera">
      <Select disabled={disabled ?? false} value={value || "league"} onValueChange={(v) => onChange(v === "league" ? "" : v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="league">La liga</SelectItem>
          {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.independent ? " (independiente)" : ""}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function OficialBadge({ value }: { value: boolean | null }) {
  if (value == null) return <Badge variant="outline">Sin definir</Badge>;
  return <Badge variant={value ? "default" : "secondary"}>{value ? "Oficial" : "No oficial"}</Badge>;
}

// =====================================================================
function AdminConsole({ role, userId, fixedTenant }: { role: string; userId: string; fixedTenant: string | null }) {
  const isSuper = role === "superadmin";
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenant, setActiveTenant] = useState<string | null>(fixedTenant);

  const loadTenants = useCallback(async () => {
    try {
      const t = await api.listTenants();
      setTenants(t);
      const active = t.filter((x) => x.status === "active" && x.allows_events !== false);
      if (isSuper && !activeTenant && active[0]) setActiveTenant(active[0].id);
    } catch (e) { toast.error((e as Error).message); }
  }, [isSuper, activeTenant]);
  useEffect(() => { loadTenants(); }, [loadTenants]);
  const selectableTenants = tenants.filter((t) => t.status === "active" && t.allows_events !== false);

  return (
    <Tabs defaultValue={isSuper ? "ligas" : "carreras"}>
      <TabsList>
        {isSuper ? <TabsTrigger value="ligas"><Building2 className="mr-1 size-4" />Ligas</TabsTrigger> : null}
        <TabsTrigger value="carreras"><Flag className="mr-1 size-4" />Carreras</TabsTrigger>
        <TabsTrigger value="clubes"><Users className="mr-1 size-4" />Clubes</TabsTrigger>
        {isSuper ? <TabsTrigger value="aprobaciones"><ClipboardCheck className="mr-1 size-4" />Aprobaciones</TabsTrigger> : null}
        {isSuper ? <TabsTrigger value="cobros"><Banknote className="mr-1 size-4" />Cobros</TabsTrigger> : null}
        {!isSuper && fixedTenant ? <TabsTrigger value="atletas"><Users className="mr-1 size-4" />Atletas</TabsTrigger> : null}
        {!isSuper && fixedTenant ? <TabsTrigger value="solicitudes"><ClipboardCheck className="mr-1 size-4" />Solicitudes</TabsTrigger> : null}
        {!isSuper && fixedTenant ? <TabsTrigger value="mi-liga"><Palette className="mr-1 size-4" />Mi liga</TabsTrigger> : null}
      </TabsList>

      {isSuper ? <TabsContent value="ligas" className="mt-6"><LigasSection tenants={tenants} onChange={loadTenants} /></TabsContent> : null}

      <TabsContent value="carreras" className="mt-6">
        {isSuper ? (
          <div className="mb-4 grid max-w-sm gap-2">
            <Label>Liga activa</Label>
            <Select value={activeTenant ?? ""} onValueChange={setActiveTenant}>
              <SelectTrigger><SelectValue placeholder="Selecciona una liga" /></SelectTrigger>
              <SelectContent>{selectableTenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {activeTenant ? <CarrerasSection tenantId={activeTenant} isSuper={isSuper} userId={userId} /> : <Note>Selecciona o crea una liga primero.</Note>}
      </TabsContent>

      <TabsContent value="clubes" className="mt-6">
        {isSuper ? (
          <div className="mb-4 grid max-w-sm gap-2">
            <Label>Liga</Label>
            <Select value={activeTenant ?? ""} onValueChange={setActiveTenant}>
              <SelectTrigger><SelectValue placeholder="Selecciona una liga" /></SelectTrigger>
              <SelectContent>{selectableTenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {isSuper
          ? (activeTenant ? <ClubesSection tenantId={activeTenant} /> : <Note>Selecciona o crea una liga primero.</Note>)
          : (fixedTenant ? <ClubesSection tenantId={fixedTenant} /> : <Note>Tu cuenta no tiene una liga asignada.</Note>)}
      </TabsContent>

      {isSuper ? <TabsContent value="aprobaciones" className="mt-6"><Aprobaciones tenants={tenants} /></TabsContent> : null}
      {isSuper ? <TabsContent value="cobros" className="mt-6"><ReporteCobros /></TabsContent> : null}
      {!isSuper && fixedTenant ? <TabsContent value="atletas" className="mt-6"><AtletasSection tenantId={fixedTenant} canExempt /></TabsContent> : null}
      {!isSuper && fixedTenant ? <TabsContent value="solicitudes" className="mt-6"><SolicitudesClub tenantId={fixedTenant} /></TabsContent> : null}
      {!isSuper && fixedTenant ? <TabsContent value="mi-liga" className="mt-6"><MiLigaSection tenantId={fixedTenant} /></TabsContent> : null}
    </Tabs>
  );
}

// ------------------- Identidad de la liga (admin de liga) -------------
/** Temporada actual de la liga y valor de las cuotas (club y atleta). Cambiar la temporada deja a los clubes "por renovar". */
function TemporadaCard({ tenantId }: { tenantId: string }) {
  const [seasons, setSeasons] = useState<api.LeagueSeason[] | null>(null);
  const [form, setForm] = useState({ season: "", club_fee: "", athlete_fee: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listLeagueSeasons(tenantId);
      setSeasons(list);
      const cur = list.find((s) => s.is_current);
      setForm({
        season: String(cur?.season ?? new Date().getFullYear()),
        club_fee: cur?.club_fee != null ? String(cur.club_fee) : "",
        athlete_fee: cur?.athlete_fee != null ? String(cur.athlete_fee) : "",
      });
    } catch (e) { toast.error((e as Error).message); setSeasons([]); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const current = seasons?.find((s) => s.is_current) ?? null;
  const digits = (v: string) => v.replace(/\D/g, "");
  const fee = (v: string) => (v ? Number(v) : null);

  async function save() {
    const season = Number(form.season);
    if (!Number.isInteger(season) || season < 2000 || season > 2100) { toast.error("Escribe una temporada válida (el año, por ejemplo 2026)"); return; }
    const club_fee = fee(form.club_fee);
    const athlete_fee = fee(form.athlete_fee);
    for (const [label, v] of [["de club", club_fee], ["del atleta", athlete_fee]] as const) {
      if (v != null && v !== 0 && (v < 1000 || v > 10_000_000)) { toast.error(`La cuota ${label} debe estar entre $1.000 y $10.000.000`); return; }
    }
    const changing = current != null && current.season !== season;
    if (changing && !confirm(
      `¿Cambiar la temporada actual de ${current?.season} a ${season}?\n\nTodos los clubes pasarán a "por renovar" y recibirán un correo con el link para pagar la cuota de ${season}. Los de la temporada anterior quedan en el historial.`,
    )) return;
    setSaving(true);
    try {
      const r = await api.saveSeason({ season, club_fee, athlete_fee, make_current: true });
      if (r.current_changed) {
        toast.success(`Temporada ${season} activa. Avisamos a ${r.notified} club(es)${r.failed ? ` (${r.failed} sin avisar: revisa Clubes → Pendientes)` : ""}.`);
      } else toast.success("Cuotas guardadas");
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }

  if (seasons === null) return <Note>Cargando…</Note>;

  return (
    <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <h3 className="font-display text-2xl">Temporada y cuotas</h3>
        <p className="text-sm text-muted-foreground">
          {current ? <>Temporada actual: <strong>{current.season}</strong>.</> : "Aún no hay una temporada actual."} Los clubes y atletas pagan su cuota cada temporada;
          el valor lo fijas tú.
        </p>
      </div>
      <Field label="Temporada actual (año)"><Input inputMode="numeric" value={form.season} onChange={(e) => setForm({ ...form, season: digits(e.target.value).slice(0, 4) })} placeholder="2026" /></Field>
      <Field label="Cuota de club (COP)"><Input inputMode="numeric" value={form.club_fee} onChange={(e) => setForm({ ...form, club_fee: digits(e.target.value) })} placeholder="200000" /></Field>
      <Field label="Cuota de atleta (COP)"><Input inputMode="numeric" value={form.athlete_fee} onChange={(e) => setForm({ ...form, athlete_fee: digits(e.target.value) })} placeholder="Aún sin definir" /></Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : current && String(current.season) !== form.season ? "Guardar y cambiar de temporada" : "Guardar"}</Button>
        <span className="text-xs text-muted-foreground">Mínimo $1.000 por cuota (límite de Bold). La cuota del atleta se usará en la afiliación de atletas.</span>
      </div>
    </CardContent></Card>
  );
}

function MiLigaSection({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<Tenant | "loading" | "none">("loading");
  const [form, setForm] = useState({ name: "", description: "", primary_color: "", secondary_color: "" });
  const [saving, setSaving] = useState(false);
  const geo = useColombiaLocation();
  const departmentHydrated = useRef(false);
  const cityHydrated = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) { setTenant("none"); return; }
    const { data } = await supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (!data) { setTenant("none"); return; }
    const t = data as Tenant;
    setTenant(t);
    setForm({ name: t.name, description: t.description ?? "", primary_color: t.primary_color, secondary_color: t.secondary_color });
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  // Precarga el departamento/municipio guardados en el selector en cascada
  // (mismo componente que usa el registro de liga y el de atleta).
  useEffect(() => {
    if (departmentHydrated.current || tenant === "loading" || tenant === "none") return;
    if (geo.loadingDepartments || geo.departments.length === 0) return;
    const match = geo.departments.find((d) => d.name === tenant.department);
    if (match) geo.setDepartmentId(String(match.id));
    departmentHydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, geo.loadingDepartments, geo.departments]);

  useEffect(() => {
    if (cityHydrated.current || tenant === "loading" || tenant === "none") return;
    if (geo.loadingCities || geo.cities.length === 0) return;
    if (tenant.city) geo.setCityName(tenant.city);
    cityHydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.loadingCities, geo.cities]);

  async function save() {
    if (!form.name.trim()) { toast.error("Escribe el nombre de la liga"); return; }
    if (!geo.departmentName) { toast.error("Selecciona el departamento"); return; }
    setSaving(true);
    try {
      await api.updateTenant(tenantId, {
        name: form.name, department: geo.departmentName, city: geo.cityName || null, description: form.description || null,
        primary_color: form.primary_color, secondary_color: form.secondary_color,
      });
      toast.success("Liga actualizada");
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }

  if (tenant === "loading") return <Note>Cargando…</Note>;
  if (tenant === "none") return <Note>No encontramos tu liga.</Note>;

  return (
    <div className="grid gap-6">
      <TemporadaCard tenantId={tenantId} />
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-2">
        <Field label="Nombre de la liga *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Departamento *">
          <Select value={geo.departmentId} onValueChange={geo.setDepartmentId} disabled={geo.loadingDepartments}>
            <SelectTrigger><SelectValue placeholder={geo.loadingDepartments ? "Cargando..." : "Selecciona"} /></SelectTrigger>
            <SelectContent>{geo.departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Ciudad">
          <Select value={geo.cityName} onValueChange={geo.setCityName} disabled={!geo.departmentId || geo.loadingCities}>
            <SelectTrigger><SelectValue placeholder={!geo.departmentId ? "Elige el depto." : geo.loadingCities ? "Cargando..." : "Selecciona"} /></SelectTrigger>
            <SelectContent>{geo.cities.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div />
        <div className="sm:col-span-2">
          <Field label="Descripción">
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Texto que ven los atletas en la página de tu liga"
            />
          </Field>
        </div>
        <Field label="Color primario">
          <div className="flex items-center gap-2">
            <input type="color" className="h-9 w-12 shrink-0 rounded border border-input bg-transparent p-1" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
            <Input value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
          </div>
        </Field>
        <Field label="Color secundario">
          <div className="flex items-center gap-2">
            <input type="color" className="h-9 w-12 shrink-0 rounded border border-input bg-transparent p-1" value={form.secondary_color} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} />
            <Input value={form.secondary_color} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} />
          </div>
        </Field>
        <div
          className="h-16 rounded sm:col-span-2"
          style={{ background: `linear-gradient(120deg, ${form.primary_color}, ${form.secondary_color})` }}
        />
        <div className="sm:col-span-2">
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
        </div>
      </CardContent></Card>
      <Note>
        Estos datos son los que identifican tu liga en el sitio público: nombre, departamento, ciudad,
        descripción y colores (se usan en las tarjetas de liga, el encabezado de tus carreras y el tema visual
        de tus páginas). El slug (<code>/ligas/{tenant.slug}</code>) no se puede editar aquí porque cambiarlo
        rompería los enlaces ya compartidos.
      </Note>
    </div>
  );
}

// ------------------- Solicitudes de club (admin de liga) --------------
/** Atletas de la liga y su afiliación de la temporada actual: quiénes pagaron y a quiénes contactar. */
function AtletasSection({ tenantId, canExempt }: { tenantId: string; canExempt: boolean }) {
  const [rows, setRows] = useState<api.LeagueAthlete[] | null>(null);
  const [season, setSeason] = useState<api.LeagueSeason | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [exempting, setExempting] = useState<api.LeagueAthlete | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const seasons = await api.listLeagueSeasons(tenantId);
      const current = seasons.find((s) => s.is_current) ?? null;
      setSeason(current);
      setRows(await api.listLeagueAthletes(tenantId, current?.season ?? null));
    } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  if (rows === null) return <Note>Cargando…</Note>;

  const isAffiliated = (a: api.LeagueAthlete) => a.membership?.status === "paid" || a.membership?.status === "exempt";
  const affiliated = rows.filter(isAffiliated);
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((a) =>
    (filter === "all" || (filter === "yes" ? isAffiliated(a) : !isAffiliated(a))) &&
    (!needle || [a.full_name, a.document_id, a.email, a.club_name].some((v) => (v ?? "").toLowerCase().includes(needle))));
  const fee = season?.athlete_fee ?? null;
  const collected = affiliated.filter((a) => a.membership?.status === "paid").reduce((s, a) => s + (a.membership?.amount ?? 0), 0);

  function exportRows() {
    const cols: Column[] = [
      { header: "Atleta", key: "name" }, { header: "Documento", key: "doc" }, { header: "Correo", key: "email" }, { header: "Celular", key: "phone" },
      { header: "Club", key: "club" }, { header: "Afiliación", key: "state" }, { header: "Valor (COP)", key: "amount" },
    ];
    const data = shown.map((a) => ({
      name: a.full_name ?? "", doc: a.document_id ?? "", email: a.email ?? "", phone: a.phone ?? "", club: a.club_name ?? "Independiente",
      state: a.membership?.status === "paid" ? "Pagada" : a.membership?.status === "exempt" ? "Exonerada" : "Sin afiliar", amount: a.membership?.status === "paid" ? a.membership.amount : 0,
    }));
    exportExcel(`atletas-temporada-${season?.season ?? "sin-temporada"}`, [{ name: "Atletas", columns: cols, rows: data }]);
  }

  async function confirmExempt() {
    if (!exempting) return;
    if (reason.trim().length < 3) { toast.error("Escribe el motivo de la exoneración"); return; }
    setBusy(true);
    try {
      await api.exemptAthlete(exempting.id, reason.trim());
      toast.success("Atleta afiliado sin cobro");
      setExempting(null); setReason("");
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6">
      {season ? (
        <p className="text-sm text-muted-foreground">
          Temporada actual: <strong>{season.season}</strong>{fee ? <> · cuota de afiliación <strong>{formatCOP(fee)}</strong></> : <> · <strong>sin cuota de atleta definida</strong> (se define en Mi liga)</>}.
          El atleta paga su afiliación desde su perfil; no es requisito para inscribirse a carreras.
        </p>
      ) : (
        <Note>Esta liga aún no tiene una temporada actual definida (se define en Mi liga).</Note>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Atletas de la liga</p><p className="font-display text-3xl">{rows.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Afiliados en la temporada</p><p className="font-display text-3xl">{affiliated.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Recaudado en afiliaciones</p><p className="font-display text-3xl">{formatCOP(collected)}</p></CardContent></Card>
      </div>
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Buscar"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, documento, correo o club" /></Field>
        <Field label="Afiliación">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="yes">Afiliados</SelectItem>
              <SelectItem value="no">Sin afiliar</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Button size="sm" variant="outline" onClick={exportRows}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
      </CardContent></Card>
      <SimpleTable head={["Atleta", "Contacto", "Club", "Afiliación", ""]}>
        {shown.map((a) => {
          const wa = whatsappNumber(a.phone);
          const m = a.membership;
          return (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.full_name ?? "—"}<div className="text-xs font-normal text-muted-foreground">{a.document_id ?? ""}</div></TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1 text-sm">
                  {a.phone ? <span>{a.phone}</span> : <span className="text-muted-foreground">Sin celular</span>}
                  {a.email ? <span className="text-muted-foreground">{a.email}</span> : null}
                  <div className="flex gap-2">
                    {wa ? <a className="text-xs text-primary underline" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${wa}`}>WhatsApp</a> : null}
                    {a.email ? <a className="text-xs text-primary underline" href={`mailto:${a.email}`}>Correo</a> : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{a.club_name ?? "Independiente"}</TableCell>
              <TableCell>
                {m?.status === "paid" ? <Badge variant="default">Afiliado</Badge>
                  : m?.status === "exempt" ? <Badge variant="secondary">Exonerado</Badge>
                  : m?.status === "awaiting_payment" ? <Badge variant="outline">Falta el pago</Badge>
                  : <Badge variant="outline">Sin afiliar</Badge>}
              </TableCell>
              <TableCell className="text-right">
                {canExempt && !isAffiliated(a) && season ? <Button size="sm" variant="outline" onClick={() => { setExempting(a); setReason(""); }}>Exonerar</Button> : null}
              </TableCell>
            </TableRow>
          );
        })}
        {shown.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{rows.length === 0 ? "Esta liga aún no tiene atletas." : "Ningún atleta coincide con los filtros."}</TableCell></TableRow> : null}
      </SimpleTable>

      <Dialog open={exempting !== null} onOpenChange={(open) => { if (!open) setExempting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exonerar afiliación</DialogTitle>
            <DialogDescription>
              <strong>{exempting?.full_name}</strong> queda afiliado a la liga en la temporada {season?.season} sin pagar. El motivo queda registrado y se le avisa por correo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="athlete-exempt-reason">Motivo *</Label>
            <Input id="athlete-exempt-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: deportista de la selección" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExempting(null)}>Cancelar</Button>
            <Button onClick={confirmExempt} disabled={busy}>{busy ? "Guardando..." : "Exonerar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SolicitudesClub({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<api.AdminClub[]>([]);
  const [season, setSeason] = useState<api.LeagueSeason | null | "loading">("loading");
  const [approving, setApproving] = useState<api.AdminClub | null>(null);
  const [exempt, setExempt] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [clubs, seasons] = await Promise.all([api.listPendingClubRequests(tenantId), api.listLeagueSeasons(tenantId)]);
      setRows(clubs);
      setSeason(seasons.find((s) => s.is_current) ?? null);
    } catch (e) { toast.error((e as Error).message); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  function openApprove(c: api.AdminClub) { setApproving(c); setExempt(false); setReason(""); }

  async function confirmApprove() {
    if (!approving) return;
    setBusy(approving.id);
    try {
      const r = await api.approveClub(approving.id, exempt ? { exempt: true, ...(reason.trim() ? { reason: reason.trim() } : {}) } : {});
      if (exempt) toast.success("Club aprobado sin cobro: ya está activo");
      else if (r.email_sent) toast.success("Club aprobado: le enviamos el link de pago de la cuota");
      else {
        if (r.payment_url) await navigator.clipboard?.writeText(r.payment_url).catch(() => undefined);
        toast.warning("Club aprobado, pero no se pudo enviar el correo. El link de pago quedó copiado: envíaselo al club.");
      }
      setApproving(null);
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function reject(id: string) {
    setBusy(id);
    try { await api.rejectClubRequest(id); toast.success("Club rechazado"); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  const fee = season && season !== "loading" ? season.club_fee : null;

  return (
    <>
      {season !== "loading" ? (
        season && fee ? (
          <p className="mb-3 text-sm text-muted-foreground">Temporada <strong>{season.season}</strong> · cuota de club <strong>{formatCOP(fee)}</strong>. Al aprobar, el club recibe el link de pago por correo y queda activo cuando se confirme.</p>
        ) : (
          <div className="mb-3"><Note>Antes de aprobar clubes con cobro define la <strong>temporada actual</strong> y la <strong>cuota de club</strong> en la pestaña <strong>Mi liga</strong>. También puedes aprobarlos sin cobro.</Note></div>
        )
      ) : null}
      <SimpleTable head={["Club", "Ciudad", "Correo", "Acciones"]}>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell className="text-muted-foreground">{c.city ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{c.contact_email ?? "—"}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-2">
              <Button size="sm" disabled={busy === c.id} onClick={() => openApprove(c)}><CheckCircle2 className="mr-1 size-4" />Aprobar</Button>
              <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => reject(c.id)}><XCircle className="mr-1 size-4" />Rechazar</Button>
            </div></TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No hay clubes pidiendo afiliarse a tu liga.</TableCell></TableRow> : null}
      </SimpleTable>

      <Dialog open={approving !== null} onOpenChange={(open) => { if (!open) setApproving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar club</DialogTitle>
            <DialogDescription>
              {exempt
                ? <>El club <strong>{approving?.name}</strong> queda activo en la temporada {season && season !== "loading" ? season.season : "actual"} sin pagar cuota.</>
                : <>El club <strong>{approving?.name}</strong> recibe por correo el link para pagar la cuota de la temporada {season && season !== "loading" ? season.season : "actual"}{fee ? <> (<strong>{formatCOP(fee)}</strong>)</> : null}. Queda activo cuando Bold confirme el pago.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={exempt} onCheckedChange={setExempt} />Aprobar sin cobro (exonerar la cuota)</label>
            {exempt ? (
              <div className="grid gap-2">
                <Label htmlFor="club-exempt-reason">Motivo (opcional)</Label>
                <Input id="club-exempt-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: club fundador de la liga" />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancelar</Button>
            <Button onClick={confirmApprove} disabled={busy !== null || (!exempt && !fee)}>
              {busy ? "Enviando..." : exempt ? "Aprobar sin cobro" : "Aprobar y enviar link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------- Clubes (vista) ------------------------
const CLUB_APPROVAL_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Aprobado", variant: "default" },
  pending: { label: "Pendiente", variant: "outline" },
  rejected: { label: "Rechazado", variant: "destructive" },
};
const CLUB_STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Activo", variant: "default" },
  inactive: { label: "Inactivo", variant: "secondary" },
  suspended: { label: "Suspendido", variant: "destructive" },
};
function ClubStatusBadge({ map, value }: { map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }>; value: string }) {
  const meta = map[value];
  return <Badge variant={meta?.variant ?? "outline"}>{meta?.label ?? value}</Badge>;
}

function ClubesSection({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<api.AdminClub[]>([]);
  const [seasons, setSeasons] = useState<api.LeagueSeason[]>([]);
  const [memberships, setMemberships] = useState<api.ClubMembership[]>([]);
  const [filters, setFilters] = useState({ name: "", city: "", approval: "all" });
  const [historySeason, setHistorySeason] = useState("");
  const [exempting, setExempting] = useState<api.AdminClub | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [clubs, ss, ms] = await Promise.all([api.listClubs(tenantId), api.listLeagueSeasons(tenantId), api.listClubMemberships(tenantId)]);
      setRows(clubs); setSeasons(ss); setMemberships(ms);
      setHistorySeason((cur) => cur || String(ss.find((s) => !s.is_current)?.season ?? ss[0]?.season ?? ""));
    } catch (e) { toast.error((e as Error).message); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const current = seasons.find((s) => s.is_current) ?? null;
  const clubById = new Map(rows.map((c) => [c.id, c]));
  const membersOf = (season: number) => memberships.filter((m) => m.season === season);
  const currentMembers = current ? membersOf(current.season) : [];
  const isPaid = (m: api.ClubMembership) => m.status === "paid" || m.status === "exempt";
  const paidNow = currentMembers.filter(isPaid);
  const paidClubIds = new Set(paidNow.map((m) => m.club_id));
  // Aprobados que aún no tienen vigente la temporada actual: sin cobro generado, esperando el pago o por renovar.
  const pendingClubs = rows.filter((c) => c.approval_status === "active" && !paidClubIds.has(c.id));
  const memberOfCurrent = (clubId: string) => currentMembers.find((m) => m.club_id === clubId);
  const hadBefore = (clubId: string) => memberships.some((m) => m.club_id === clubId && (!current || m.season !== current.season) && isPaid(m));

  const filtered = rows.filter((c) => {
    if (filters.name && !c.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.city && !(c.city ?? "").toLowerCase().includes(filters.city.toLowerCase())) return false;
    if (filters.approval !== "all" && c.approval_status !== filters.approval) return false;
    return true;
  });

  async function run(id: string, fn: () => Promise<string>) {
    setBusy(id);
    try { toast.success(await fn()); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  const resend = (c: api.AdminClub) => run(c.id, async () => {
    const r = await api.approveClub(c.id);
    if (r.already_current) return "Ese club ya está al día";
    if (r.email_sent) return "Link de pago enviado al club";
    if (r.payment_url) await navigator.clipboard?.writeText(r.payment_url).catch(() => undefined);
    return "No se pudo enviar el correo: el link de pago quedó copiado";
  });
  const verify = (c: api.AdminClub) => run(c.id, async () => {
    const r = await api.checkClubMembership(c.id);
    return r.status === "paid" || r.status === "exempt" ? "Pago confirmado: el club quedó activo" : "Bold aún no registra el pago";
  });
  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("Link de pago copiado"); } catch { toast.error("No se pudo copiar el link"); }
  }
  async function confirmExempt() {
    if (!exempting) return;
    if (reason.trim().length < 3) { toast.error("Escribe el motivo de la exoneración"); return; }
    const club = exempting;
    setExempting(null);
    await run(club.id, async () => { await api.exemptClub(club.id, reason.trim()); setReason(""); return "Club exonerado: ya está activo en la temporada"; });
  }

  const memberLabel = (m: api.ClubMembership) => (m.status === "exempt" ? "Exonerado" : "Pagado");
  const memberRows = (list: api.ClubMembership[]) => list.map((m) => ({ m, club: clubById.get(m.club_id) }));

  return (
    <div className="grid gap-6">
      {current ? (
        <p className="text-sm text-muted-foreground">Temporada actual: <strong>{current.season}</strong>{current.club_fee ? <> · cuota de club <strong>{formatCOP(current.club_fee)}</strong></> : null}. Se cambia en <strong>Mi liga</strong>.</p>
      ) : (
        <Note>Esta liga aún no tiene una temporada actual definida (se define en Mi liga).</Note>
      )}
      <Tabs defaultValue="vigentes">
        <TabsList>
          <TabsTrigger value="vigentes">Temporada actual ({paidNow.length})</TabsTrigger>
          <TabsTrigger value="pendientes">Pendientes de pago ({pendingClubs.length})</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
          <TabsTrigger value="todos">Todos los clubes</TabsTrigger>
        </TabsList>

        <TabsContent value="vigentes" className="mt-4">
          <SimpleTable head={["Club", "Ciudad", "Correo", "Pago", "Valor", "Fecha"]}>
            {memberRows(paidNow).map(({ m, club }) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{club?.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{club?.city ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{club?.contact_email ?? "—"}</TableCell>
                <TableCell><Badge variant={m.status === "exempt" ? "secondary" : "default"}>{memberLabel(m)}</Badge></TableCell>
                <TableCell>{m.status === "exempt" ? "—" : formatCOP(m.amount)}</TableCell>
                <TableCell className="text-muted-foreground">{m.paid_at ? new Date(m.paid_at).toLocaleDateString("es-CO") : "—"}</TableCell>
              </TableRow>
            ))}
            {paidNow.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Ningún club ha pagado la temporada actual.</TableCell></TableRow> : null}
          </SimpleTable>
        </TabsContent>

        <TabsContent value="pendientes" className="mt-4">
          <SimpleTable head={["Club", "Correo", "Estado", "Acciones"]}>
            {pendingClubs.map((c) => {
              const m = memberOfCurrent(c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.contact_email ?? "—"}</TableCell>
                  <TableCell>
                    {m ? <Badge variant="secondary">Falta el pago · {formatCOP(m.amount)}</Badge>
                      : hadBefore(c.id) ? <Badge variant="outline">Por renovar</Badge>
                      : <Badge variant="outline">Sin cobro generado</Badge>}
                  </TableCell>
                  <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" disabled={busy === c.id} onClick={() => verify(c)}><RefreshCw className="mr-1 size-4" />Verificar pago</Button>
                    {m?.payment_url ? <Button size="sm" variant="outline" onClick={() => copyLink(m.payment_url as string)}><Link2 className="mr-1 size-4" />Copiar link</Button> : null}
                    <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => resend(c)}><Mail className="mr-1 size-4" />{m ? "Reenviar link" : "Enviar link"}</Button>
                    <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => { setExempting(c); setReason(""); }}>Exonerar</Button>
                  </div></TableCell>
                </TableRow>
              );
            })}
            {pendingClubs.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No hay clubes pendientes de pago.</TableCell></TableRow> : null}
          </SimpleTable>
        </TabsContent>

        <TabsContent value="historial" className="mt-4 grid gap-4">
          <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-3">
            <Field label="Temporada">
              <Select value={historySeason} onValueChange={setHistorySeason}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>{seasons.map((s) => <SelectItem key={s.season} value={String(s.season)}>{s.season}{s.is_current ? " (actual)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </CardContent></Card>
          <SimpleTable head={["Club", "Estado", "Valor", "Fecha"]}>
            {memberRows(historySeason ? membersOf(Number(historySeason)) : []).map(({ m, club }) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{club?.name ?? "—"}</TableCell>
                <TableCell><Badge variant={m.status === "paid" ? "default" : m.status === "exempt" ? "secondary" : "outline"}>{m.status === "awaiting_payment" ? "Sin pagar" : memberLabel(m)}</Badge></TableCell>
                <TableCell>{m.status === "paid" ? formatCOP(m.amount) : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{m.paid_at ? new Date(m.paid_at).toLocaleDateString("es-CO") : "—"}</TableCell>
              </TableRow>
            ))}
            {!historySeason || membersOf(Number(historySeason)).length === 0
              ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sin cuotas registradas en esa temporada.</TableCell></TableRow> : null}
          </SimpleTable>
        </TabsContent>

        <TabsContent value="todos" className="mt-4 grid gap-4">
          <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-3">
            <Field label="Club"><Input value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} placeholder="Buscar por nombre" /></Field>
            <Field label="Ciudad"><Input value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} placeholder="Buscar por ciudad" /></Field>
            <Field label="Estado">
              <Select value={filters.approval} onValueChange={(v) => setFilters({ ...filters, approval: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(CLUB_APPROVAL_LABEL).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent></Card>
          <SimpleTable head={["Club", "Ciudad", "Departamento", "Correo", "Estado", "Temporada actual"]}>
            {filtered.map((c) => {
              const m = memberOfCurrent(c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.city ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.department ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.contact_email ?? "—"}</TableCell>
                  <TableCell><ClubStatusBadge map={CLUB_APPROVAL_LABEL} value={c.approval_status} /></TableCell>
                  <TableCell>
                    {c.approval_status !== "active" ? "—"
                      : m && isPaid(m) ? <Badge variant="default">{memberLabel(m)}</Badge>
                      : <Badge variant="outline">Sin pagar</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {rows.length === 0 ? "Esta liga aún no tiene clubes." : "Ningún club coincide con los filtros."}
                </TableCell>
              </TableRow>
            ) : null}
          </SimpleTable>
        </TabsContent>
      </Tabs>

      <Dialog open={exempting !== null} onOpenChange={(open) => { if (!open) setExempting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exonerar cuota</DialogTitle>
            <DialogDescription>
              <strong>{exempting?.name}</strong> queda activo en la temporada {current?.season} sin pagar. El motivo queda registrado y se le avisa al club.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="club-exempt-reason2">Motivo *</Label>
            <Input id="club-exempt-reason2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: convenio con la liga" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExempting(null)}>Cancelar</Button>
            <Button onClick={confirmExempt}>Exonerar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------- Ligas -------------------------------
function LigasSection({ tenants, onChange }: { tenants: Tenant[]; onChange: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", department: "", city: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ name: "", department: "", status: "all", enabled: "all" });
  const [pcts, setPcts] = useState<Record<string, number | null>>({});
  const geo = useColombiaLocation();
  useEffect(() => { api.listLeagueAgreements().then(setPcts).catch(() => undefined); }, []);

  async function savePct(tenantId: string, value: string) {
    const clean = value.trim().replace(",", ".");
    const pct = clean === "" ? null : Number(clean);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) { toast.error("El porcentaje debe estar entre 0 y 100"); return; }
    try {
      await api.setLeagueAthleteFeePct(tenantId, pct);
      setPcts((cur) => ({ ...cur, [tenantId]: pct }));
      toast.success(pct == null ? "Porcentaje borrado" : `La liga recibirá el ${pct}% de las afiliaciones de atletas`);
    } catch (e) { toast.error((e as Error).message); }
  }

  async function create() {
    const payload = { ...form, department: geo.departmentName, city: geo.cityName };
    const { ok, errors } = validateForm(payload, { name: [required("El nombre")], slug: [slugRule()], department: [required("El departamento")] });
    setErrors(errors as Record<string, string>);
    if (!ok) return;
    setBusy(true);
    try {
      await api.createTenant(payload);
      toast.success("Liga creada");
      setForm({ name: "", slug: "", department: "", city: "" }); setErrors({}); geo.setDepartmentId(""); onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const filtered = tenants.filter((t) => {
    if (filters.name && !t.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.department && !t.department.toLowerCase().includes(filters.department.toLowerCase())) return false;
    if (filters.status !== "all" && t.status !== filters.status) return false;
    if (filters.enabled === "yes" && t.status !== "active") return false;
    if (filters.enabled === "no" && t.status === "active") return false;
    return true;
  });

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="Nombre *" error={errors["name"]}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Liga Valle OCR" /></Field>
        <Field label="Slug *" error={errors["slug"]}><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="valle" /></Field>
        <Field label="Departamento *" error={errors["department"]}>
          <Select value={geo.departmentId} onValueChange={geo.setDepartmentId} disabled={geo.loadingDepartments}>
            <SelectTrigger><SelectValue placeholder={geo.loadingDepartments ? "Cargando..." : "Selecciona"} /></SelectTrigger>
            <SelectContent>{geo.departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Ciudad">
          <Select value={geo.cityName} onValueChange={geo.setCityName} disabled={!geo.departmentId || geo.loadingCities}>
            <SelectTrigger><SelectValue placeholder={!geo.departmentId ? "Elige el depto." : geo.loadingCities ? "Cargando..." : "Selecciona"} /></SelectTrigger>
            <SelectContent>{geo.cities.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-4"><Button onClick={create} disabled={busy}><Plus className="mr-1 size-4" />Crear liga</Button></div>
      </CardContent></Card>
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="Liga"><Input value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} placeholder="Buscar por nombre" /></Field>
        <Field label="Depto"><Input value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })} placeholder="Buscar por departamento" /></Field>
        <Field label="Estado">
          <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(TENANT_STATUS_LABEL).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Habilitada">
          <Select value={filters.enabled} onValueChange={(v) => setFilters({ ...filters, enabled: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="yes">Sí</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </CardContent></Card>
      <SimpleTable head={["Liga", "Depto", "Estado", "% afiliación de atletas para la liga", "Habilitada"]}>
        {filtered.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-medium">{t.name}</TableCell>
            <TableCell className="text-muted-foreground">{t.department}</TableCell>
            <TableCell><Badge variant={TENANT_STATUS_LABEL[t.status].variant}>{TENANT_STATUS_LABEL[t.status].label}</Badge></TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Input className="h-8 w-20" inputMode="decimal" placeholder="Sin definir" key={`${t.id}-${pcts[t.id] ?? ""}`} defaultValue={pcts[t.id] ?? ""}
                  onBlur={(e) => { const prev = pcts[t.id] == null ? "" : String(pcts[t.id]); if (e.target.value.trim() !== prev) savePct(t.id, e.target.value); }} />
                <span className="text-muted-foreground">%</span>
              </div>
            </TableCell>
            <TableCell className="text-right"><Switch checked={t.status === "active"} onCheckedChange={async (v) => {
              try { await api.setTenantStatus(t.id, v ? "active" : "suspended"); toast.success("Actualizada"); onChange(); } catch (e) { toast.error((e as Error).message); }
            }} /></TableCell>
          </TableRow>
        ))}
        {filtered.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{tenants.length === 0 ? "Aún no hay ligas." : "Ninguna liga coincide con los filtros."}</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ---------------------------- Aprobaciones ---------------------------
function Aprobaciones({ tenants }: { tenants: Tenant[] }) {
  return (
    <Tabs defaultValue="carreras">
      <TabsList>
        <TabsTrigger value="carreras">Carreras</TabsTrigger>
        <TabsTrigger value="ligas">Ligas</TabsTrigger>
      </TabsList>
      <TabsContent value="carreras" className="mt-4"><AprobacionesCarreras tenants={tenants} /></TabsContent>
      <TabsContent value="ligas" className="mt-4"><AprobacionesLigas /></TabsContent>
    </Tabs>
  );
}

function AprobacionesCarreras({ tenants }: { tenants: Tenant[] }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const load = useCallback(async () => { try { setRows(await api.listPendingFederation()); } catch (e) { toast.error((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);
  const ligaName = (id: string) => tenants.find((t) => t.id === id)?.name ?? "—";
  async function act(id: string, fn: (id: string) => Promise<void>, msg: string) {
    try { await fn(id); toast.success(msg); load(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <SimpleTable head={["Carrera", "Liga", "Fecha", "Oficial", "Acciones"]}>
      {rows.map((e) => (
        <TableRow key={e.id}>
          <TableCell className="font-medium">{e.title}</TableCell>
          <TableCell className="text-muted-foreground">{ligaName(e.tenant_id)}</TableCell>
          <TableCell className="text-muted-foreground">{e.date}</TableCell>
          <TableCell><OficialBadge value={e.is_official} /></TableCell>
          <TableCell className="text-right"><div className="flex justify-end gap-2">
            <Button size="sm" disabled={e.is_official == null} title={e.is_official == null ? "La liga debe indicar si es oficial antes de aprobar" : undefined}
              onClick={() => act(e.id, api.approveEvent, "Evento aprobado")}><CheckCircle2 className="mr-1 size-4" />Aprobar</Button>
            <Button size="sm" variant="outline" onClick={() => act(e.id, api.rejectEvent, "Devuelto a borrador")}><XCircle className="mr-1 size-4" />Rechazar</Button>
          </div></TableCell>
        </TableRow>
      ))}
      {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No hay carreras de la federación pendientes de aprobación. (Las carreras de las ligas las aprueba el director de cada liga.)</TableCell></TableRow> : null}
    </SimpleTable>
  );
}

function AprobacionesLigas() {
  const [rows, setRows] = useState<Tenant[]>([]);
  const [payments, setPayments] = useState<Record<string, api.LeaguePayment>>({});
  const [approving, setApproving] = useState<Tenant | null>(null);
  const [amount, setAmount] = useState("");
  const [exempt, setExempt] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [leagues, pays] = await Promise.all([api.listPendingLeagues(), api.listLeaguePayments()]);
      setRows(leagues);
      setPayments(pays);
    } catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openApprove(t: Tenant) {
    setApproving(t);
    setExempt(false);
    setAmount(payments[t.id] && payments[t.id]!.amount > 0 ? String(payments[t.id]!.amount) : "");
  }

  async function confirmApprove() {
    if (!approving) return;
    if (exempt) {
      setBusy(approving.id);
      try {
        await api.approveLeagueExempt(approving.id);
        toast.success("Liga aprobada sin cobro: ya está activa y se avisó a su administrador");
        setApproving(null);
        load();
      } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
      return;
    }
    const value = Number(amount.replace(/\D/g, ""));
    if (!Number.isInteger(value) || value < 1000 || value > 10_000_000) {
      toast.error("Ingresa un monto entre $1.000 y $10.000.000");
      return;
    }
    setBusy(approving.id);
    try {
      const r = await api.approveLeague(approving.id, value);
      if (r.emails_sent > 0) toast.success("Liga aprobada: le enviamos el link de pago a su administrador");
      else {
        await navigator.clipboard?.writeText(r.payment_url).catch(() => undefined);
        toast.warning("Liga aprobada, pero no se pudo enviar el correo. El link de pago quedó copiado: envíaselo al administrador.");
      }
      setApproving(null);
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function reject(id: string) {
    setBusy(id);
    try { await api.rejectLeague(id); toast.success("Liga rechazada"); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function verify(t: Tenant) {
    setBusy(t.id);
    try {
      const r = await api.checkLeaguePayment(t.id);
      if (r.activated) toast.success("Pago confirmado: la liga quedó activa");
      else if (r.renewed) toast.warning(`El pago quedó ${r.bold_status} en Bold: se generó un link nuevo (cópialo o usa "Reenviar" para mandárselo por correo)`);
      else toast.info(`Bold aún no registra el pago (estado: ${r.bold_status ?? "sin pago"})`);
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("Link de pago copiado"); }
    catch { toast.error("No se pudo copiar el link"); }
  }

  return (
    <>
      <SimpleTable head={["Liga", "Departamento", "Ciudad", "Estado", "Acciones"]}>
        {rows.map((t) => {
          const pay = payments[t.id];
          const waiting = t.status === "awaiting_payment";
          return (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-muted-foreground">{t.department}</TableCell>
              <TableCell className="text-muted-foreground">{t.city ?? "—"}</TableCell>
              <TableCell>
                {waiting
                  ? <Badge variant="secondary">Falta el pago{pay ? ` · ${formatCOP(pay.amount)}` : ""}</Badge>
                  : <Badge variant="outline">Por aprobar</Badge>}
              </TableCell>
              <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
                {waiting ? (<>
                  <Button size="sm" disabled={busy === t.id} onClick={() => verify(t)}><RefreshCw className="mr-1 size-4" />Verificar pago</Button>
                  {pay?.payment_url ? <Button size="sm" variant="outline" onClick={() => copyLink(pay.payment_url as string)}><Link2 className="mr-1 size-4" />Copiar link</Button> : null}
                  <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => openApprove(t)}><Mail className="mr-1 size-4" />Reenviar</Button>
                </>) : (
                  <Button size="sm" disabled={busy === t.id} onClick={() => openApprove(t)}><CheckCircle2 className="mr-1 size-4" />Aprobar</Button>
                )}
                <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => reject(t.id)}><XCircle className="mr-1 size-4" />Rechazar</Button>
              </div></TableCell>
            </TableRow>
          );
        })}
        {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No hay ligas pendientes de aprobación ni de pago.</TableCell></TableRow> : null}
      </SimpleTable>

      <Dialog open={approving !== null} onOpenChange={(open) => { if (!open) setApproving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{approving?.status === "awaiting_payment" ? "Reenviar link de pago" : "Aprobar liga"}</DialogTitle>
            <DialogDescription>
              Define la cuota de afiliación de <strong>{approving?.name}</strong>. Se crea un link de pago en Bold y se envía por correo al administrador de la liga; la liga se activa sola cuando Bold confirma el pago.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={exempt} onCheckedChange={setExempt} />Eximir del pago de afiliación
            </label>
            {exempt ? (
              <p className="text-xs text-muted-foreground">La liga queda activa de inmediato y su administrador recibe un correo. No se crea link de pago.</p>
            ) : (<>
              <Label htmlFor="affiliation-amount">Cuota de afiliación (COP)</Label>
              <Input id="affiliation-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
              <p className="text-xs text-muted-foreground">Entre $1.000 y $10.000.000 (tarjeta y PSE llegan hasta $5.000.000 en Bold).</p>
            </>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancelar</Button>
            <Button onClick={confirmApprove} disabled={busy !== null}>{busy ? "Enviando..." : exempt ? "Aprobar sin cobro" : "Aprobar y enviar link"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Link público de inscripción: solo el formulario, sin el resto del sitio (para compartir en bio/anuncios). */
async function copyRegistrationLink(eventId: string) {
  const url = `${window.location.origin}/eventos/${eventId}?minimal=1`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link de inscripción copiado");
  } catch {
    toast.error(`No se pudo copiar automáticamente. Link: ${url}`);
  }
}

// ------------------------------ Cobros -------------------------------
function CobrosPorConcepto() {
  const [rows, setRows] = useState<api.Charge[] | null>(null);
  const [concept, setConcept] = useState("all");
  const [league, setLeague] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try { setRows(await api.listChargesReport()); } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (rows === null) return <Note>Cargando…</Note>;

  const leagues = [...new Set(rows.map((r) => r.league))].sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (concept === "all" || r.concept === concept) &&
    (league === "all" || r.league === league) &&
    (!from || r.date.slice(0, 10) >= from) &&
    (!to || r.date.slice(0, 10) <= to) &&
    (!needle || [r.payer, r.detail, r.beneficiary, r.league].some((v) => v.toLowerCase().includes(needle))));

  const byConcept = (Object.keys(api.CHARGE_CONCEPT_LABEL) as api.ChargeConcept[]).map((c) => {
    const list = shown.filter((r) => r.concept === c);
    return { concept: c, label: api.CHARGE_CONCEPT_LABEL[c], count: list.length, exempt: list.filter((r) => r.exempt).length, total: list.reduce((s, r) => s + r.amount, 0), payout: list.reduce((s, r) => s + r.payout, 0) };
  });
  const benef = new Map<string, { name: string; kind: "federacion" | "liga" | "club"; count: number; total: number }>();
  shown.forEach((r) => {
    const key = `${r.beneficiary_kind}:${r.beneficiary}`;
    const cur = benef.get(key) ?? { name: r.beneficiary, kind: r.beneficiary_kind, count: 0, total: 0 };
    cur.count += 1; cur.total += r.payout;
    benef.set(key, cur);
  });
  const byBeneficiary = [...benef.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const total = shown.reduce((s, r) => s + r.amount, 0);
  const totalPayout = shown.reduce((s, r) => s + r.payout, 0);
  const missingPct = shown.some((r) => r.concept === "atleta" && !r.exempt && r.share_pct == null);
  const kindLabel = (k: "federacion" | "liga" | "club") => (k === "federacion" ? "Federación" : k === "liga" ? "Liga" : "Club");
  const dateLabel = (iso: string) => (iso ? new Date(iso).toLocaleDateString("es-CO") : "—");

  function exportReport(kind: "excel" | "pdf") {
    const detCols: Column[] = [
      { header: "Fecha", key: "date" }, { header: "Concepto", key: "concept" }, { header: "Pagó", key: "payer" }, { header: "Liga", key: "league" },
      { header: "Detalle", key: "detail" }, { header: "Valor (COP)", key: "amount" }, { header: "A liquidar (COP)", key: "payout" }, { header: "Corresponde a", key: "beneficiary" }, { header: "Tipo", key: "kind" },
    ];
    const detRows = shown.map((r) => ({
      date: dateLabel(r.date), concept: api.CHARGE_CONCEPT_LABEL[r.concept], payer: r.payer, league: r.league, detail: r.detail,
      amount: r.amount, payout: r.payout, beneficiary: r.beneficiary, kind: kindLabel(r.beneficiary_kind),
    }));
    if (kind === "pdf") {
      exportPDF("cobros-por-concepto", "Cobros por concepto", detCols, [...detRows, { date: "", concept: "TOTAL", payer: "", league: "", detail: "", amount: total, payout: totalPayout, beneficiary: "", kind: "" }]);
      return;
    }
    const conceptCols: Column[] = [{ header: "Concepto", key: "label" }, { header: "Cobros", key: "count" }, { header: "Exonerados", key: "exempt" }, { header: "Total cobrado (COP)", key: "total" }, { header: "A liquidar (COP)", key: "payout" }];
    const benefCols: Column[] = [{ header: "Corresponde a", key: "name" }, { header: "Tipo", key: "kind" }, { header: "Cobros", key: "count" }, { header: "Total (COP)", key: "total" }];
    exportExcel("cobros-por-concepto", [
      { name: "Por concepto", columns: conceptCols, rows: byConcept.map((c) => ({ label: c.label, count: c.count, exempt: c.exempt, total: c.total, payout: c.payout })) },
      { name: "Por beneficiario", columns: benefCols, rows: byBeneficiary.map((b) => ({ name: b.name, kind: kindLabel(b.kind), count: b.count, total: b.total })) },
      { name: "Detalle", columns: detCols, rows: detRows },
    ]);
  }

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-5 sm:items-end">
        <Field label="Concepto">
          <Select value={concept} onValueChange={setConcept}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {(Object.keys(api.CHARGE_CONCEPT_LABEL) as api.ChargeConcept[]).map((c) => <SelectItem key={c} value={c}>{api.CHARGE_CONCEPT_LABEL[c]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Liga">
          <Select value={league} onValueChange={setLeague}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {leagues.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Buscar"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Quién pagó o detalle" /></Field>
        <div className="flex gap-2 sm:col-span-5">
          <Button size="sm" variant="outline" onClick={() => exportReport("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportReport("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-5">
          Cada cobro dice a quién le corresponde el dinero: la <strong>afiliación de liga</strong> es de la federación; la <strong>cuota de club</strong>, de la liga;
          la <strong>inscripción</strong>, del club responsable (carrera oficial con club) o, si no, de la liga. Suma solo pagos aprobados por Bold; las exoneraciones salen en $0.
          La liquidación la haces tú por fuera del sistema.
        </p>
        <p className="text-xs text-muted-foreground sm:col-span-5">
          La <strong>afiliación de atleta</strong> la recauda la federación y a la liga le corresponde el porcentaje acordado (se define por liga en la pestaña Ligas).
          {missingPct ? <strong className="text-foreground"> Hay afiliaciones de ligas sin porcentaje definido: su "a liquidar" aparece en $0 hasta que lo definas.</strong> : null}
        </p>
      </CardContent></Card>

      <div>
        <h3 className="mb-2 font-display text-2xl">Por concepto</h3>
        <SimpleTable head={["Concepto", "Cobros", "Exonerados", "Total cobrado", "A liquidar"]}>
          {byConcept.map((c) => (
            <TableRow key={c.concept}>
              <TableCell className="font-medium">{c.label}</TableCell>
              <TableCell>{c.count}</TableCell>
              <TableCell>{c.exempt}</TableCell>
              <TableCell className="text-right">{formatCOP(c.total)}</TableCell>
              <TableCell className="text-right font-medium">{formatCOP(c.payout)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={3} className="text-right font-semibold">Totales</TableCell>
            <TableCell className="text-right font-semibold">{formatCOP(total)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCOP(totalPayout)}</TableCell>
          </TableRow>
        </SimpleTable>
      </div>

      <div>
        <h3 className="mb-2 font-display text-2xl">Por beneficiario (a quién liquidar)</h3>
        <SimpleTable head={["Corresponde a", "Tipo", "Cobros", "A liquidar"]}>
          {byBeneficiary.map((b) => (
            <TableRow key={`${b.kind}:${b.name}`}>
              <TableCell className="font-medium">{b.name}</TableCell>
              <TableCell><Badge variant={b.kind === "federacion" ? "default" : "outline"}>{kindLabel(b.kind)}</Badge></TableCell>
              <TableCell>{b.count}</TableCell>
              <TableCell className="text-right font-medium">{formatCOP(b.total)}</TableCell>
            </TableRow>
          ))}
          {byBeneficiary.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sin cobros para mostrar.</TableCell></TableRow> : null}
        </SimpleTable>
      </div>

      <div>
        <h3 className="mb-2 font-display text-2xl">Detalle</h3>
        <SimpleTable head={["Fecha", "Concepto", "Pagó", "Liga", "Detalle", "Valor", "A liquidar", "Corresponde a"]}>
          {shown.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="text-muted-foreground">{dateLabel(r.date)}</TableCell>
              <TableCell><Badge variant="outline">{api.CHARGE_CONCEPT_LABEL[r.concept]}</Badge></TableCell>
              <TableCell className="font-medium">{r.payer}</TableCell>
              <TableCell className="text-muted-foreground">{r.league}</TableCell>
              <TableCell className="text-muted-foreground">{r.detail}</TableCell>
              <TableCell className="text-right">{r.exempt ? <Badge variant="secondary">Exonerado</Badge> : formatCOP(r.amount)}</TableCell>
              <TableCell className="text-right">
                {r.exempt ? "—" : formatCOP(r.payout)}
                {r.concept === "atleta" && !r.exempt ? <div className="text-xs text-muted-foreground">{r.share_pct == null ? "% sin definir" : `${r.share_pct}% para la liga`}</div> : null}
              </TableCell>
              <TableCell>{r.beneficiary}<div className="text-xs text-muted-foreground">{kindLabel(r.beneficiary_kind)}</div></TableCell>
            </TableRow>
          ))}
          {shown.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Sin cobros para mostrar.</TableCell></TableRow> : null}
        </SimpleTable>
      </div>
    </div>
  );
}

/** Reporte de cobros (solo la federación): por concepto y, aparte, el detalle de las inscripciones por carrera. */
function ReporteCobros() {
  return (
    <Tabs defaultValue="concepto">
      <TabsList>
        <TabsTrigger value="concepto">Por concepto</TabsTrigger>
        <TabsTrigger value="carrera">Inscripciones por carrera</TabsTrigger>
      </TabsList>
      <TabsContent value="concepto" className="mt-4"><CobrosPorConcepto /></TabsContent>
      <TabsContent value="carrera" className="mt-4"><CobrosPorCarrera /></TabsContent>
    </Tabs>
  );
}

/**
 * Reporte para la federación: quién es el responsable de cada carrera (club si es oficial y tiene club
 * responsable; la liga si no) y cuánto se recaudó con pagos aprobados. La liquidación se hace a mano
 * por fuera del sistema: este reporte solo dice a quién le corresponde cada peso.
 */
function CobrosPorCarrera() {
  const [rows, setRows] = useState<api.CobroCarrera[] | null>(null);
  const [withActivity, setWithActivity] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try { setRows(await api.listCollectionsReport()); } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (rows === null) return <Note>Cargando…</Note>;

  const needle = search.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!withActivity || r.paid + r.pending > 0 || r.collected > 0) &&
    (!needle || [r.title, r.league, r.responsible].some((v) => v.toLowerCase().includes(needle))));

  const byResponsible = new Map<string, { key: string; name: string; kind: "club" | "liga"; independent: boolean; races: number; paid: number; collected: number }>();
  shown.forEach((r) => {
    const cur = byResponsible.get(r.responsible_key)
      ?? { key: r.responsible_key, name: r.responsible, kind: r.responsible_kind, independent: r.independent_club, races: 0, paid: 0, collected: 0 };
    cur.races += 1; cur.paid += r.paid; cur.collected += r.collected;
    byResponsible.set(r.responsible_key, cur);
  });
  const summary = [...byResponsible.values()].sort((a, b) => b.collected - a.collected || a.name.localeCompare(b.name));
  const total = shown.reduce((sum, r) => sum + r.collected, 0);
  const kindLabel = (kind: "club" | "liga", independent: boolean) => (kind === "club" ? (independent ? "Club independiente" : "Club") : "Liga");

  function exportReport(kind: "excel" | "pdf") {
    const sumCols: Column[] = [
      { header: "Responsable", key: "name" }, { header: "Tipo", key: "kind" }, { header: "Carreras", key: "races" },
      { header: "Inscripciones pagadas", key: "paid" }, { header: "Recaudado (COP)", key: "collected" },
    ];
    const sumRows = summary.map((s) => ({ name: s.name, kind: kindLabel(s.kind, s.independent), races: s.races, paid: s.paid, collected: s.collected }));
    if (kind === "pdf") {
      exportPDF("cobros-por-responsable", "Cobros por responsable", sumCols, [...sumRows, { name: "TOTAL", kind: "", races: shown.length, paid: summary.reduce((x, s) => x + s.paid, 0), collected: total }]);
      return;
    }
    const detCols: Column[] = [
      { header: "Carrera", key: "title" }, { header: "Fecha", key: "date" }, { header: "Liga", key: "league" },
      { header: "Oficial", key: "official" }, { header: "Responsable del cobro", key: "responsible" }, { header: "Tipo", key: "kind" },
      { header: "Pagadas", key: "paid" }, { header: "Pendientes", key: "pending" }, { header: "Recaudado (COP)", key: "collected" },
    ];
    const detRows = shown.map((r) => ({
      title: r.title, date: r.date, league: r.league, official: r.is_official == null ? "Sin definir" : r.is_official ? "Sí" : "No",
      responsible: r.responsible, kind: kindLabel(r.responsible_kind, r.independent_club), paid: r.paid, pending: r.pending, collected: r.collected,
    }));
    exportExcel("cobros", [{ name: "Por responsable", columns: sumCols, rows: sumRows }, { name: "Por carrera", columns: detCols, rows: detRows }]);
  }

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Buscar"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Carrera, liga o responsable" /></Field>
        <label className="flex items-center gap-2 text-sm"><Switch checked={withActivity} onCheckedChange={setWithActivity} />Solo carreras con inscritos</label>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportReport("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportReport("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-3">
          En una carrera <strong>oficial con club responsable</strong> el cobro le corresponde al club; en cualquier otro caso, a la liga. Suma solo pagos aprobados por Bold.
          La liquidación la haces tú por fuera del sistema.
        </p>
      </CardContent></Card>

      <div>
        <h3 className="mb-2 font-display text-2xl">Por responsable</h3>
        <SimpleTable head={["Responsable", "Tipo", "Carreras", "Pagadas", "Recaudado"]}>
          {summary.map((s) => (
            <TableRow key={s.key}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell><Badge variant={s.kind === "club" ? "default" : "outline"}>{kindLabel(s.kind, s.independent)}</Badge></TableCell>
              <TableCell>{s.races}</TableCell>
              <TableCell>{s.paid}</TableCell>
              <TableCell className="text-right font-medium">{formatCOP(s.collected)}</TableCell>
            </TableRow>
          ))}
          {summary.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No hay carreras con inscritos todavía.</TableCell></TableRow> : null}
          {summary.length > 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-right font-semibold">Total recaudado</TableCell>
              <TableCell className="text-right font-semibold">{formatCOP(total)}</TableCell>
            </TableRow>
          ) : null}
        </SimpleTable>
      </div>

      <div>
        <h3 className="mb-2 font-display text-2xl">Por carrera</h3>
        <SimpleTable head={["Carrera", "Fecha", "Liga", "Responsable del cobro", "Pagadas", "Pendientes", "Recaudado"]}>
          {shown.map((r) => (
            <TableRow key={r.event_id}>
              <TableCell className="font-medium">{r.title}<div className="mt-0.5"><OficialBadge value={r.is_official} /></div></TableCell>
              <TableCell className="text-muted-foreground">{r.date}</TableCell>
              <TableCell className="text-muted-foreground">{r.league}</TableCell>
              <TableCell>{r.responsible}<div className="text-xs text-muted-foreground">{kindLabel(r.responsible_kind, r.independent_club)}</div></TableCell>
              <TableCell>{r.paid}</TableCell>
              <TableCell>{r.pending}</TableCell>
              <TableCell className="text-right">{formatCOP(r.collected)}</TableCell>
            </TableRow>
          ))}
          {shown.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Sin carreras para mostrar.</TableCell></TableRow> : null}
        </SimpleTable>
      </div>
    </div>
  );
}

// ------------------------------ Carreras -----------------------------
function CarrerasSection({ tenantId, isSuper, userId }: { tenantId: string; isSuper: boolean; userId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [form, setForm] = useState({ title: "", date: "", location: "", is_official: "", club_id: "", payment_deadline: "", visibility: "private", distance_km: "", obstacles: "", max_capacity: "", includes_shirt: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setEvents(await api.listEvents(tenantId)); } catch (e) { toast.error((e as Error).message); } }, [tenantId]);
  useEffect(() => { setSelected(null); load(); }, [load]);

  async function create() {
    const { ok, errors } = validateForm(form, {
      title: [required("El nombre")], date: [required("La fecha")], location: [required("El lugar")],
      is_official: [required("Indica si es oficial")], distance_km: [decimalNonNeg("La distancia")],
    });
    setErrors(errors as Record<string, string>);
    if (!ok) return;
    setBusy(true);
    try {
      await api.createEvent({
        tenant_id: tenantId, title: form.title, date: form.date, location: form.location,
        is_official: form.is_official === "true",
        club_id: form.is_official === "true" && form.club_id ? form.club_id : null,
        payment_deadline: form.payment_deadline || null,
        visibility: form.visibility === "public" ? "public" : "private",
        distance_km: form.distance_km ? Number(form.distance_km) : undefined,
        obstacles: form.obstacles ? Number(form.obstacles) : undefined,
        max_capacity: form.max_capacity ? Number(form.max_capacity) : undefined,
        includes_shirt: form.includes_shirt,
      });
      toast.success("Carrera creada (en borrador)");
      setForm({ title: "", date: "", location: "", is_official: "", club_id: "", payment_deadline: "", visibility: "private", distance_km: "", obstacles: "", max_capacity: "", includes_shirt: false }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function act(id: string, fn: (id: string) => Promise<void>, msg: string) {
    try { await fn(id); toast.success(msg); load(); } catch (e) { toast.error((e as Error).message); }
  }

  async function exportRaces(kind: "excel" | "pdf") {
    try {
      const counts = await api.registrationCountsByEvent(tenantId);
      const cols: Column[] = [
        { header: "Carrera", key: "title" }, { header: "Fecha", key: "date" }, { header: "Lugar", key: "location" },
        { header: "Estado", key: "estado" }, { header: "Inscritos", key: "inscritos" },
      ];
      const data = events.map((e) => ({ title: e.title, date: e.date, location: e.location, estado: STATUS_LABEL[e.status]?.label ?? e.status, inscritos: counts[e.id] ?? 0 }));
      if (kind === "excel") exportExcel("carreras", [{ name: "Carreras", columns: cols, rows: data }]);
      else exportPDF("carreras", "Carreras", cols, data);
    } catch (e) { toast.error((e as Error).message); }
  }

  if (selected) return (
    <EventoDetalle
      tenantId={tenantId} event={selected} isSuper={isSuper} userId={userId}
      onBack={() => setSelected(null)}
      onEventChanged={(updated) => { setSelected(updated); load(); }}
    />
  );

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-3">
        <Field label="Nombre *" error={errors["title"]}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Reto OCR Cali 2026" /></Field>
        <Field label="Fecha *" error={errors["date"]}><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Lugar *" error={errors["location"]}><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Parque del Río" /></Field>
        <Field label="¿Es oficial? *" error={errors["is_official"]}>
          <Select value={form.is_official} onValueChange={(v) => setForm({ ...form, is_official: v, club_id: v === "true" ? form.club_id : "" })}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent><SelectItem value="true">Sí, oficial</SelectItem><SelectItem value="false">No oficial</SelectItem></SelectContent>
          </Select>
        </Field>
        <ResponsableField tenantId={tenantId} isOfficial={form.is_official} value={form.club_id} onChange={(v) => setForm({ ...form, club_id: v })} />
        <Field label="Fecha límite de pago"><Input type="date" value={form.payment_deadline} onChange={(e) => setForm({ ...form, payment_deadline: e.target.value })} /></Field>
        <Field label="Visibilidad">
          <Select value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="private">Privada</SelectItem><SelectItem value="public">Pública (resultados en vivo)</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Distancia (km)" error={errors["distance_km"]}><Input inputMode="decimal" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} placeholder="5" /></Field>
        <Field label="Obstáculos"><Input inputMode="numeric" value={form.obstacles} onChange={(e) => setForm({ ...form, obstacles: e.target.value.replace(/\D/g, "") })} placeholder="20" /></Field>
        <Field label="Cupos"><Input inputMode="numeric" value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: e.target.value.replace(/\D/g, "") })} placeholder="300" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><Switch checked={form.includes_shirt} onCheckedChange={(v) => setForm({ ...form, includes_shirt: v })} />La carrera incluye camiseta (el formulario pedirá nombre y talla)</label>
        <div className="sm:col-span-3"><Button onClick={create} disabled={busy}><CalendarPlus className="mr-1 size-4" />Crear carrera</Button></div>
      </CardContent></Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{events.length} carrera(s)</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportRaces("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportRaces("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
      </div>

      <SimpleTable head={["Carrera", "Fecha", "Estado", "Oficial", "Acciones"]}>
        {events.map((e) => {
          const canManage = canManageEvent(e, isSuper, userId);
          return (
          <TableRow key={e.id}>
            <TableCell className="font-medium">{e.title}</TableCell>
            <TableCell className="text-muted-foreground">{e.date}</TableCell>
            <TableCell><StatusBadge status={e.status} /></TableCell>
            <TableCell><div className="flex flex-col items-start gap-1"><OficialBadge value={e.is_official} /><ResponsableText event={e} /></div></TableCell>
            <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
              {e.status === "draft" && canManage && canApproveEvent(e, isSuper) ? (
                <Button size="sm" disabled={e.is_official == null} title={e.is_official == null ? "Indica si es oficial antes de aprobar" : undefined}
                  onClick={() => act(e.id, api.approveEvent, "Carrera aprobada y publicada")}><CheckCircle2 className="mr-1 size-4" />Aprobar y publicar</Button>
              ) : null}
              {e.status === "draft" && canManage && !canApproveEvent(e, isSuper) ? <Button size="sm" variant="secondary" onClick={() => act(e.id, api.submitEvent, "Enviado a aprobación")}><Send className="mr-1 size-4" />Enviar a aprobación</Button> : null}
              {e.status === "pending_federation" && canApproveEvent(e, isSuper) ? (<>
                <Button size="sm" disabled={e.is_official == null} title={e.is_official == null ? "Indica si es oficial antes de aprobar" : undefined}
                  onClick={() => act(e.id, api.approveEvent, "Aprobado")}><CheckCircle2 className="mr-1 size-4" />Aprobar</Button>
                <Button size="sm" variant="outline" onClick={() => act(e.id, api.rejectEvent, "Rechazado")}><XCircle className="mr-1 size-4" />Rechazar</Button>
              </>) : null}
              <Button size="sm" variant="outline" onClick={() => copyRegistrationLink(e.id)}><Link2 className="mr-1 size-4" />Copiar link de inscripción</Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(e)}><Timer className="mr-1 size-4" />Abrir</Button>
            </div></TableCell>
          </TableRow>
          );
        })}
        {events.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Aún no hay carreras en esta liga.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

/** Enlace único para compartir los resultados de la carrera: copiar, abrir y regenerar. */
function ResultsLinkCard({ eventId, isPublic }: { eventId: string; isPublic: boolean }) {
  const [link, setLink] = useState<api.ResultsLink | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setLink(await api.getResultsLink(eventId)); } catch { setLink(null); }
  }, [eventId]);
  useEffect(() => { load(); }, [load, isPublic]);

  async function regenerate() {
    if (!confirm("¿Generar un enlace nuevo? El enlace anterior dejará de funcionar y tendrás que volver a compartirlo.")) return;
    setBusy(true);
    try { setLink(await api.getResultsLink(eventId, true)); toast.success("Enlace nuevo generado"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); toast.success("Enlace copiado"); } catch { toast.error("No se pudo copiar el enlace"); }
  }

  if (!isPublic) {
    return <p className="text-xs text-muted-foreground">La carrera es <strong>privada</strong>: los resultados solo los ven el administrador de tu liga y la federación. Activa "Resultados públicos" para compartirlos por enlace.</p>;
  }
  if (!link) return null;
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-4 text-sm">
      <p className="font-medium">Enlace de resultados</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={link.url} className="max-w-xl font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" variant="outline" onClick={copy}><Link2 className="mr-1 size-4" />Copiar</Button>
        <Button size="sm" variant="outline" onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}>Abrir</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={regenerate}><RefreshCw className="mr-1 size-4" />Regenerar</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {link.available
          ? <>Funciona hasta el final del día de la carrera ({link.valid_until}); después redirige al inicio de FedOCR. Muestra el estado de la carrera y, cuando empiece, los resultados por categoría y oleada.</>
          : <>Todavía no está activo: la carrera debe estar <strong>aprobada</strong> y ser pública, y el enlace deja de funcionar al terminar el día de la carrera ({link.valid_until}).</>}
      </p>
    </div>
  );
}

// --------------------------- Detalle evento --------------------------
function EventoDetalle({ tenantId, event, isSuper, userId, onBack, onEventChanged }: {
  tenantId: string; event: EventRow; isSuper: boolean; userId: string; onBack: () => void; onEventChanged: (e: EventRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const canManage = canManageEvent(event, isSuper, userId);
  const locked = event.status === "in_progress" || event.status === "finished";
  const foreignEvent = isSuper && event.created_by !== userId && !locked;

  async function togglePublicResults(value: boolean) {
    setBusy(true);
    try {
      await api.updateEvent(event.id, { visibility: value ? "public" : "private" });
      const fresh = (await api.listEvents(tenantId)).find((e) => e.id === event.id);
      toast.success(value ? "Los resultados ahora se pueden compartir por enlace" : "Los resultados ahora son privados");
      if (fresh) onEventChanged(fresh);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleShirt(value: boolean) {
    setBusy(true);
    try {
      await api.updateEvent(event.id, { includes_shirt: value });
      const fresh = (await api.listEvents(tenantId)).find((e) => e.id === event.id);
      toast.success(value ? "La inscripción ahora pide camiseta" : "La inscripción ya no pide camiseta");
      if (fresh) onEventChanged(fresh);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function changeStatus(status: api.EventStatus, msg: string) {
    setBusy(true);
    try {
      await api.setEventStatus(event.id, status);
      const fresh = (await api.listEvents(tenantId)).find((e) => e.id === event.id);
      toast.success(msg);
      if (fresh) onEventChanged(fresh);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4">
      <button onClick={onBack} className="text-left text-sm text-primary">← Volver a carreras</button>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-3xl">{event.title}</h2>
        <StatusBadge status={event.status} />
        <OficialBadge value={event.is_official} />
        <ResponsableText event={event} />
        {canManage && event.status === "approved" ? (
          <Button size="sm" onClick={() => changeStatus("in_progress", "Carrera marcada en curso")} disabled={busy}>Marcar en curso</Button>
        ) : null}
        {canManage && event.status === "in_progress" ? (
          <Button size="sm" variant="outline" onClick={() => changeStatus("finished", "Carrera finalizada")} disabled={busy}>Finalizar carrera</Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{event.date} · {event.location}</p>
      <label className="flex items-center gap-2 text-sm">
        <Switch disabled={!canManage || busy} checked={Boolean(event.includes_shirt)} onCheckedChange={toggleShirt} />
        La carrera incluye camiseta (el formulario de inscripción pide nombre y talla)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch disabled={!canManage || busy} checked={event.visibility === "public"} onCheckedChange={togglePublicResults} />
        Resultados públicos en vivo (se comparten con un enlace único)
      </label>
      <ResultsLinkCard eventId={event.id} isPublic={event.visibility === "public"} />
      {locked ? (
        <Note>
          Esta carrera ya está <strong>{event.status === "finished" ? "finalizada" : "en curso"}</strong>: no se
          puede agregar, modificar ni eliminar nada (categorías, inscritos, oleadas o checkpoints)
          {event.status === "finished" ? "." : " hasta finalizarla."}
        </Note>
      ) : foreignEvent ? (
        <Note>Esta carrera no la creaste tú. Como superadmin solo puedes ver su información, no modificarla (la aprueba el director de su liga).</Note>
      ) : null}
      <Tabs defaultValue="categorias" className="mt-2">
        <TabsList>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
          <TabsTrigger value="inscritos">Inscritos</TabsTrigger>
          <TabsTrigger value="sinpagar">Sin pagar</TabsTrigger>
          <TabsTrigger value="oleadas">Oleadas</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          <TabsTrigger value="jueces"><Gavel className="mr-1 size-4" />Jueces</TabsTrigger>
          <TabsTrigger value="gestores"><UserCog className="mr-1 size-4" />Gestores</TabsTrigger>
          <TabsTrigger value="resultados"><Trophy className="mr-1 size-4" />Resultados</TabsTrigger>
        </TabsList>
        <TabsContent value="categorias" className="mt-4"><Categorias eventId={event.id} locked={!canManage} /></TabsContent>
        <TabsContent value="inscritos" className="mt-4"><Inscritos tenantId={tenantId} eventId={event.id} eventDate={event.date} paymentDeadline={event.payment_deadline} extendedAt={event.payment_deadline_extended_at ?? null} locked={!canManage} /></TabsContent>
        <TabsContent value="sinpagar" className="mt-4"><SinPagar eventId={event.id} eventTitle={event.title} paymentDeadline={event.payment_deadline} /></TabsContent>
        <TabsContent value="oleadas" className="mt-4"><Oleadas tenantId={tenantId} eventId={event.id} eventDate={event.date} locked={!canManage} /></TabsContent>
        <TabsContent value="checkpoints" className="mt-4"><Checkpoints tenantId={tenantId} eventId={event.id} locked={!canManage} /></TabsContent>
        <TabsContent value="jueces" className="mt-4"><Jueces tenantId={tenantId} locked={!canManage} /></TabsContent>
        <TabsContent value="gestores" className="mt-4"><Gestores tenantId={tenantId} eventId={event.id} locked={!canManage} /></TabsContent>
        <TabsContent value="resultados" className="mt-4"><Resultados event={event} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------- Panel restringido: race_manager ------------------
/**
 * Vista para el rol race_manager: ve solo las carreras que le asignaron, edita sus datos
 * básicos mientras siguen en borrador, y las envía a aprobación. También administra
 * categorías, inscritos, oleadas, checkpoints y jueces de sus propias
 * carreras (mismos componentes que usa el admin de liga). A propósito NO
 * incluye la pestaña de Gestores ni el control de estado in_progress/
 * finished: crear otros gestores y esas transiciones siguen siendo
 * terreno exclusivo de admin/superadmin.
 */
function GestorConsole({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const load = useCallback(async () => { try { setEvents(await api.listAssignedEvents(tenantId, userId)); } catch (e) { toast.error((e as Error).message); } }, [tenantId, userId]);
  useEffect(() => { setSelected(null); load(); }, [load]);

  if (selected) return (
    <GestorEventoDetalle tenantId={tenantId} event={selected} onBack={() => setSelected(null)} onEventChanged={(updated) => { setSelected(updated); load(); }} />
  );

  return (
    <div className="grid gap-6">
      <Note>
        Aquí ves solo las carreras que el director de tu liga te asignó. Tú no creas carreras: preparas su contenido
        (datos, categorías, oleadas, checkpoints) y la envías a aprobación.
      </Note>

      <SimpleTable head={["Carrera", "Fecha", "Estado", "Oficial", "Acciones"]}>
        {events.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="font-medium">{e.title}</TableCell>
            <TableCell className="text-muted-foreground">{e.date}</TableCell>
            <TableCell><StatusBadge status={e.status} /></TableCell>
            <TableCell><div className="flex flex-col items-start gap-1"><OficialBadge value={e.is_official} /><ResponsableText event={e} /></div></TableCell>
            <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => copyRegistrationLink(e.id)}><Link2 className="mr-1 size-4" />Copiar link de inscripción</Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(e)}><Timer className="mr-1 size-4" />Abrir</Button>
            </div></TableCell>
          </TableRow>
        ))}
        {events.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Todavía no tienes carreras asignadas. Pídele al director de tu liga que te asigne una.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

function GestorEventoDetalle({ tenantId, event, onBack, onEventChanged }: { tenantId: string; event: EventRow; onBack: () => void; onEventChanged: (e: EventRow) => void }) {
  const locked = event.status !== "draft";
  /** Categorías, inscritos y oleadas siguen editables mientras la carrera no esté en curso ni
   *  finalizada -- igual que un admin de liga (no superadmin), ver canManageEvent() arriba. */
  const contentLocked = event.status === "in_progress" || event.status === "finished";
  const [form, setForm] = useState({
    title: event.title, date: event.date, location: event.location,
    is_official: event.is_official == null ? "" : String(event.is_official),
    club_id: event.club_id ?? "",
    payment_deadline: event.payment_deadline ?? "",
    visibility: event.visibility ?? "private",
    distance_km: event.distance_km != null ? String(event.distance_km) : "",
    obstacles: event.obstacles != null ? String(event.obstacles) : "",
    max_capacity: String(event.max_capacity ?? ""),
    includes_shirt: Boolean(event.includes_shirt),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const { ok, errors } = validateForm(form, {
      title: [required("El nombre")], date: [required("La fecha")], location: [required("El lugar")],
      is_official: [required("Indica si es oficial")], distance_km: [decimalNonNeg("La distancia")],
    });
    setErrors(errors as Record<string, string>);
    if (!ok) return;
    setBusy(true);
    const patch = {
      title: form.title, date: form.date, location: form.location,
      is_official: form.is_official === "true",
        club_id: form.is_official === "true" && form.club_id ? form.club_id : null,
        payment_deadline: form.payment_deadline || null,
      visibility: (form.visibility === "public" ? "public" : "private") as "public" | "private",
      distance_km: form.distance_km ? Number(form.distance_km) : null,
      obstacles: form.obstacles ? Number(form.obstacles) : null,
      max_capacity: form.max_capacity ? Number(form.max_capacity) : 0,
      includes_shirt: form.includes_shirt,
    };
    try {
      await api.updateEvent(event.id, patch);
      toast.success("Carrera actualizada");
      const fresh = (await api.listEvents(tenantId)).find((e) => e.id === event.id);
      onEventChanged(fresh ?? { ...event, ...patch });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    try {
      await api.submitEvent(event.id);
      toast.success("Enviada a aprobación");
      onEventChanged({ ...event, status: "pending_federation" });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4">
      <button onClick={onBack} className="text-left text-sm text-primary">← Volver a carreras</button>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-3xl">{event.title}</h2>
        <StatusBadge status={event.status} />
        <OficialBadge value={event.is_official} />
        <ResponsableText event={event} />
      </div>
      {locked ? (
        <Note>Esta carrera ya se envió a revisión — no puedes seguir editando sus datos. Habla con el director de tu liga si necesitas cambiar algo.</Note>
      ) : null}
      <Tabs defaultValue="datos">
        <TabsList>
          <TabsTrigger value="datos">Datos</TabsTrigger>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
          <TabsTrigger value="inscritos">Inscritos</TabsTrigger>
          <TabsTrigger value="oleadas">Oleadas</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          <TabsTrigger value="jueces"><Gavel className="mr-1 size-4" />Jueces</TabsTrigger>
        </TabsList>
        <TabsContent value="datos" className="mt-4">
          <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-3">
            <Field label="Nombre *" error={errors["title"]}><Input disabled={locked} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Fecha *" error={errors["date"]}><Input disabled={locked} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Lugar *" error={errors["location"]}><Input disabled={locked} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="¿Es oficial? *" error={errors["is_official"]}>
              <Select disabled={locked} value={form.is_official} onValueChange={(v) => setForm({ ...form, is_official: v, club_id: v === "true" ? form.club_id : "" })}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent><SelectItem value="true">Sí, oficial</SelectItem><SelectItem value="false">No oficial</SelectItem></SelectContent>
              </Select>
            </Field>
            <ResponsableField tenantId={tenantId} isOfficial={form.is_official} value={form.club_id} disabled={locked} onChange={(v) => setForm({ ...form, club_id: v })} />
            <Field label="Fecha límite de pago"><Input disabled={locked} type="date" value={form.payment_deadline} onChange={(e) => setForm({ ...form, payment_deadline: e.target.value })} /></Field>
            <Field label="Visibilidad">
              <Select disabled={locked} value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v as "private" | "public" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="private">Privada</SelectItem><SelectItem value="public">Pública (resultados en vivo)</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Distancia (km)" error={errors["distance_km"]}><Input disabled={locked} inputMode="decimal" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} /></Field>
            <Field label="Obstáculos"><Input disabled={locked} inputMode="numeric" value={form.obstacles} onChange={(e) => setForm({ ...form, obstacles: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Cupos"><Input disabled={locked} inputMode="numeric" value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: e.target.value.replace(/\D/g, "") })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-3"><Switch disabled={locked} checked={form.includes_shirt} onCheckedChange={(v) => setForm({ ...form, includes_shirt: v })} />La carrera incluye camiseta (el formulario pedirá nombre y talla)</label>
            <div className="flex gap-2 sm:col-span-3">
              {!locked ? <Button onClick={save} disabled={busy}>Guardar cambios</Button> : null}
              {event.status === "draft" ? <Button variant="secondary" onClick={submit} disabled={busy}><Send className="mr-1 size-4" />Enviar a aprobación</Button> : null}
            </div>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="categorias" className="mt-4"><Categorias eventId={event.id} locked={contentLocked} /></TabsContent>
        <TabsContent value="inscritos" className="mt-4"><Inscritos tenantId={tenantId} eventId={event.id} eventDate={event.date} paymentDeadline={event.payment_deadline} extendedAt={event.payment_deadline_extended_at ?? null} locked={contentLocked} /></TabsContent>
        <TabsContent value="oleadas" className="mt-4"><Oleadas tenantId={tenantId} eventId={event.id} eventDate={event.date} locked={contentLocked} /></TabsContent>
        <TabsContent value="checkpoints" className="mt-4"><Checkpoints tenantId={tenantId} eventId={event.id} locked={contentLocked} /></TabsContent>
        <TabsContent value="jueces" className="mt-4"><Jueces tenantId={tenantId} locked={contentLocked} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------- Maestro de categorías por carrera ------------------
function Categorias({ eventId, locked }: { eventId: string; locked: boolean }) {
  const [rows, setRows] = useState<api.EventCategory[]>([]);
  const [form, setForm] = useState({ name: "", gender: "", min_age: "", max_age: "", price: "", slots_available: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const load = useCallback(async () => setRows(await api.listEventCategories(eventId)), [eventId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const { ok, errors } = validateForm(form, { name: [required("El nombre")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    try {
      await api.createEventCategory(eventId, {
        name: form.name, gender: form.gender || null,
        min_age: form.min_age ? Number(form.min_age) : null, max_age: form.max_age ? Number(form.max_age) : null,
        price: form.price ? Number(form.price) : 0, slots_available: form.slots_available ? Number(form.slots_available) : 0,
      });
      toast.success("Categoría agregada"); setForm({ name: "", gender: "", min_age: "", max_age: "", price: "", slots_available: "" }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function seed() { try { await api.seedStandardCategories(eventId); toast.success("Categorías estándar agregadas — recuerda ponerles precio y cupos"); load(); } catch (e) { toast.error((e as Error).message); } }
  async function setPrice(id: string, value: string) {
    const price = Number(value.replace(/\D/g, "")) || 0;
    try { await api.updateEventCategory(id, { price }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function setAge(id: string, field: "min_age" | "max_age", value: string) {
    const age = value.replace(/\D/g, "");
    try { await api.updateEventCategory(id, { [field]: age ? Number(age) : null }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function setSlots(id: string, value: string) {
    const slots_available = Number(value.replace(/\D/g, "")) || 0;
    try { await api.updateEventCategory(id, { slots_available }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }

  return (
    <div className="grid gap-4">
      {!locked ? (
        <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Field label="Nombre *" error={errors["name"]}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Elite Masculino" /></Field>
          <Field label="Género">
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent><SelectItem value="M">M</SelectItem><SelectItem value="F">F</SelectItem><SelectItem value="X">X</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Edad mín."><Input inputMode="numeric" value={form.min_age} onChange={(e) => setForm({ ...form, min_age: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Edad máx."><Input inputMode="numeric" value={form.max_age} onChange={(e) => setForm({ ...form, max_age: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Precio (COP)"><Input inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, "") })} placeholder="120000" /></Field>
          <Field label="Cupos"><Input inputMode="numeric" value={form.slots_available} onChange={(e) => setForm({ ...form, slots_available: e.target.value.replace(/\D/g, "") })} placeholder="100" /></Field>
          <div className="flex items-end gap-2"><Button onClick={add}><Plus className="mr-1 size-4" />Agregar</Button></div>
          <div className="sm:col-span-4"><Button variant="outline" size="sm" onClick={seed}><Layers className="mr-1 size-4" />Sembrar categorías estándar</Button></div>
        </CardContent></Card>
      ) : null}
      <SimpleTable head={["Categoría", "Género", "Edad", "Precio (COP)", "Cupos", ""]}>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">
              {c.name}
              {c.price <= 0 ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Sin precio: no aparece en el formulario hasta que le pongas uno</span> : null}
            </TableCell>
            <TableCell>{c.gender ?? "Todos"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Input className="h-8 w-16" inputMode="numeric" placeholder="mín" disabled={locked} defaultValue={c.min_age ?? ""} key={`min-${c.min_age}`}
                  onBlur={(e) => { if ((e.target.value || null) !== (c.min_age == null ? null : String(c.min_age))) setAge(c.id, "min_age", e.target.value); }} />
                <span className="text-muted-foreground">–</span>
                <Input className="h-8 w-16" inputMode="numeric" placeholder="máx" disabled={locked} defaultValue={c.max_age ?? ""} key={`max-${c.max_age}`}
                  onBlur={(e) => { if ((e.target.value || null) !== (c.max_age == null ? null : String(c.max_age))) setAge(c.id, "max_age", e.target.value); }} />
              </div>
            </TableCell>
            <TableCell>
              <Input className="h-8 w-28" inputMode="numeric" disabled={locked} defaultValue={c.price} key={c.price}
                onBlur={(e) => { if (Number(e.target.value) !== c.price) setPrice(c.id, e.target.value); }} />
            </TableCell>
            <TableCell>
              <Input className="h-8 w-20" inputMode="numeric" disabled={locked} defaultValue={c.slots_available} key={c.slots_available}
                onBlur={(e) => { if (Number(e.target.value) !== c.slots_available) setSlots(c.id, e.target.value); }} />
            </TableCell>
            <TableCell className="text-right">{!locked ? <Button size="sm" variant="ghost" onClick={async () => { try { await api.deleteEventCategory(c.id); load(); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="size-4" /></Button> : null}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sin categorías. Usa “Sembrar categorías estándar”.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ------------------------------ Inscritos ----------------------------
function Inscritos({ tenantId, eventId, eventDate, paymentDeadline, extendedAt, locked }: {
  tenantId: string; eventId: string; eventDate: string; paymentDeadline: string | null; extendedAt: string | null; locked: boolean;
}) {
  const [rows, setRows] = useState<api.Registration[]>([]);
  const [deadline, setDeadline] = useState(paymentDeadline ?? "");
  const [savedDeadline, setSavedDeadline] = useState<string | null>(paymentDeadline);
  const [lastExtendedAt, setLastExtendedAt] = useState<string | null>(extendedAt);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [waves, setWaves] = useState<api.Wave[]>([]);
  const [cats, setCats] = useState<api.EventCategory[]>([]);

  const load = useCallback(async () => {
    const [r, w, c] = await Promise.all([api.listRegistrations(eventId), api.listWaves(eventId), api.listEventCategories(eventId)]);
    setRows(r); setWaves(w); setCats(c);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  /** Guardar el plazo. Posponerlo o quitarlo cuando ya estaba fijado es "extenderlo": la base deja registrado quién y cuándo. */
  async function saveDeadline(value: string, msg: string) {
    if (value && value > eventDate) { toast.error("La fecha límite de pago no puede ser posterior a la fecha de la carrera"); return; }
    setSavingDeadline(true);
    try {
      await api.updateEvent(eventId, { payment_deadline: value || null });
      const extended = Boolean(savedDeadline) && (!value || value > (savedDeadline as string));
      setSavedDeadline(value || null);
      setDeadline(value);
      if (extended) setLastExtendedAt(new Date().toISOString());
      toast.success(msg);
    } catch (e) { toast.error((e as Error).message); } finally { setSavingDeadline(false); }
  }
  /** Cerrar el plazo ya: la fecha límite pasa a ayer (el último día es inclusive). */
  function closeNow() {
    const d = new Date(`${bogotaToday()}T12:00:00-05:00`);
    d.setDate(d.getDate() - 1);
    saveDeadline(d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" }), "Plazo de pago cerrado");
  }
  const window = paymentWindow(savedDeadline);
  const wantsToExtend = Boolean(savedDeadline) && (!deadline || deadline > (savedDeadline as string));

  async function reassignWave(regId: string, waveId: string) {
    try { await api.updateRegistration(regId, { wave_id: waveId || null }); load(); } catch (e) { toast.error((e as Error).message); }
  }
  async function changeBib(regId: string, value: string) {
    const bib = value.trim() === "" ? null : Number(value);
    if (bib != null && (!Number.isInteger(bib) || bib <= 0)) { toast.error("El dorsal debe ser un entero mayor que 0"); load(); return; }
    try { await api.updateRegistration(regId, { bib_number: bib }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function autoAssign() {
    try { const n = await api.bulkAssignBibs(eventId); toast.success(n > 0 ? `${n} dorsal(es) asignado(s)` : "Todos los inscritos ya tienen dorsal"); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const waveName = (id: string | null) => waves.find((w) => w.id === id)?.name ?? "";

  function exportRoster(kind: "excel" | "pdf") {
    const cols: Column[] = [
      { header: "Dorsal", key: "bib" }, { header: "Atleta", key: "name" }, { header: "Documento", key: "doc" },
      { header: "Categoría", key: "cat" }, { header: "Oleada", key: "wave" }, { header: "Estado", key: "status" },
    ];
    const data = rows.map((r) => ({
      bib: r.bib_number ?? "", name: r.athlete_name, doc: r.athlete_document,
      cat: catName(r.category_id), wave: waveName(r.wave_id), status: r.status,
    }));
    if (kind === "excel") exportExcel("inscritos", [{ name: "Inscritos", columns: cols, rows: data }]);
    else exportPDF("inscritos", "Inscritos por carrera", cols, data);
  }

  return (
    <div className="grid gap-4">
      {!locked ? (
        <Card><CardContent className="flex flex-wrap items-end gap-3 p-6">
          <div className="grid gap-1.5">
            <Label htmlFor="payment-deadline">Fecha límite de pago</Label>
            <Input id="payment-deadline" type="date" className="w-48" max={eventDate} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <Button size="sm" disabled={savingDeadline || deadline === (savedDeadline ?? "")}
            onClick={() => saveDeadline(deadline, wantsToExtend ? "Plazo de pago extendido" : "Fecha límite de pago guardada")}>
            {wantsToExtend ? "Extender plazo" : "Guardar fecha"}
          </Button>
          {window === "open" ? (
            <Button size="sm" variant="outline" onClick={closeNow} disabled={savingDeadline}>Cerrar el plazo ahora</Button>
          ) : null}
          {savedDeadline ? (
            <Button size="sm" variant="outline" onClick={() => saveDeadline("", "Fecha límite de pago quitada")} disabled={savingDeadline}>Quitar fecha</Button>
          ) : null}
          <div className="basis-full text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              {!savedDeadline ? "Sin fecha límite: no hay tope para pagar."
                : window === "open" ? `Plazo abierto: se puede pagar hasta el ${savedDeadline} (inclusive).`
                : `Plazo vencido el ${savedDeadline}: los atletas pendientes ya no pueden pagar ni inscribirse por su cuenta.`}
              {lastExtendedAt ? ` Extendido el ${new Date(lastExtendedAt).toLocaleDateString("es-CO")}.` : ""}
            </p>
            <p className="mt-1">
              La fecha aplica a toda la carrera. Si el plazo venció, el director o el encargado de la liga lo extiende para toda la carrera: el
              atleta se inscribe y paga por el formulario de siempre y, cuando ya lo hizo, se vuelve a cerrar con "Cerrar el plazo ahora".
            </p>
          </div>
        </CardContent></Card>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Los atletas se inscriben y pagan por el formulario público. El dorsal se asigna automáticamente; las oleadas, al generarlas o manualmente en la tabla.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{rows.length} inscrito(s)</span>
        <div className="flex gap-2">
          {!locked ? <Button size="sm" variant="outline" onClick={autoAssign}><Hash className="mr-1 size-4" />Autoasignar dorsales</Button> : null}
          <Button size="sm" variant="outline" onClick={() => exportRoster("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportRoster("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
      </div>

      <SimpleTable head={["Dorsal", "Atleta", "Doc", "Categoría", "Pago", "Oleada"]}>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Input className="h-8 w-20 font-mono" inputMode="numeric" disabled={locked} defaultValue={r.bib_number ?? ""} key={r.bib_number ?? "empty"}
                onBlur={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  if (parseInt(digits || "0", 10) !== parseInt(r.bib_number ?? "0", 10)) changeBib(r.id, digits);
                }} />
            </TableCell>
            <TableCell className="font-medium">{r.athlete_name}</TableCell>
            <TableCell className="text-muted-foreground">{r.athlete_document}</TableCell>
            <TableCell>{catName(r.category_id)}</TableCell>
            <TableCell>
              {r.status === "paid" ? <Badge>Pagada</Badge>
                : r.status === "cancelled" ? <Badge variant="outline">Cancelada</Badge>
                : window === "closed" ? <Badge variant="destructive">Plazo vencido</Badge>
                : <Badge variant="outline">Pendiente</Badge>}
            </TableCell>
            <TableCell className="text-right">
              <Select value={r.wave_id ?? ""} onValueChange={(v) => reassignWave(r.id, v)} disabled={locked}>
                <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Sin oleada" /></SelectTrigger>
                <SelectContent>{waves.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sin inscritos aún.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ----------------------------- Sin pagar -----------------------------
/** Celular colombiano -> número para wa.me (código de país 57 si falta). */
function whatsappNumber(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  return digits.length >= 10 ? digits : null;
}

/**
 * Atletas que se inscribieron pero no pagaron: contacto para mercadeo y seguimiento (entender por qué no
 * pagaron, ayudarles a completar el pago). Solo la ve quien puede leer las inscripciones: admin de la liga y federación.
 */
function SinPagar({ eventId, eventTitle, paymentDeadline }: { eventId: string; eventTitle: string; paymentDeadline: string | null }) {
  const [rows, setRows] = useState<api.UnpaidRegistration[] | null>(null);
  const [cats, setCats] = useState<api.EventCategory[]>([]);
  const [paidCount, setPaidCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [unpaid, categories, all] = await Promise.all([api.listUnpaidRegistrations(eventId), api.listEventCategories(eventId), api.listRegistrations(eventId)]);
      setRows(unpaid); setCats(categories); setPaidCount(all.filter((r) => r.status === "paid").length);
    } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  if (rows === null) return <Note>Cargando…</Note>;

  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? "—";
  const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  const pendingTotal = rows.reduce((sum, r) => sum + r.amount, 0);
  const overdue = paymentWindow(paymentDeadline) === "closed";
  const share = rows.length + paidCount > 0 ? Math.round((rows.length / (rows.length + paidCount)) * 100) : 0;
  const message = (name: string | null) =>
    `Hola ${(name ?? "").split(" ")[0] || ""}, te escribimos de la liga: vimos que te inscribiste en ${eventTitle} pero tu pago quedó pendiente. ¿Pasó algo o podemos ayudarte a completarlo?`;

  function exportUnpaid(kind: "excel" | "pdf") {
    const cols: Column[] = [
      { header: "Atleta", key: "name" }, { header: "Documento", key: "doc" }, { header: "Correo", key: "email" }, { header: "Celular", key: "phone" },
      { header: "Categoría", key: "cat" }, { header: "Valor (COP)", key: "amount" }, { header: "Inscrito el", key: "date" }, { header: "Días sin pagar", key: "days" },
    ];
    const data = rows!.map((r) => ({
      name: r.athlete_name ?? "", doc: r.athlete_document ?? "", email: r.athlete_email ?? "", phone: r.athlete_phone ?? "",
      cat: catName(r.category_id), amount: r.amount, date: new Date(r.created_at).toLocaleDateString("es-CO"), days: daysSince(r.created_at),
    }));
    if (kind === "excel") exportExcel("atletas-sin-pagar", [{ name: "Sin pagar", columns: cols, rows: data }]);
    else exportPDF("atletas-sin-pagar", `Atletas sin pagar — ${eventTitle}`, cols, data);
  }

  return (
    <div className="grid gap-4">
      <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div>
          <p className="font-display text-3xl">{rows.length} sin pagar</p>
          <p className="text-sm text-muted-foreground">
            {rows.length > 0
              ? `${formatCOP(pendingTotal)} en inscripciones pendientes (${share}% de las inscripciones). ${overdue ? "El plazo de pago ya venció." : ""}`
              : "Todos los atletas inscritos ya pagaron."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="mr-1 size-4" />Actualizar</Button>
          <Button size="sm" variant="outline" onClick={() => exportUnpaid("excel")} disabled={rows.length === 0}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportUnpaid("pdf")} disabled={rows.length === 0}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
        <p className="basis-full text-xs text-muted-foreground">
          Atletas que llenaron el formulario pero no completaron el pago. Úsalo para contactarlos, saber por qué no pagaron o ayudarles a terminar.
          Son datos personales: úsalos solo para la gestión de esta carrera.
        </p>
      </CardContent></Card>

      <SimpleTable head={["Atleta", "Contacto", "Categoría", "Valor", "Hace"]}>
        {rows.map((r) => {
          const wa = whatsappNumber(r.athlete_phone);
          const days = daysSince(r.created_at);
          return (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.athlete_name ?? "—"}<div className="text-xs font-normal text-muted-foreground">{r.athlete_document ?? ""}</div></TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1 text-sm">
                  {r.athlete_phone ? <span>{r.athlete_phone}</span> : <span className="text-muted-foreground">Sin celular</span>}
                  {r.athlete_email ? <span className="text-muted-foreground">{r.athlete_email}</span> : null}
                  <div className="flex gap-2">
                    {wa ? (
                      <a className="text-xs text-primary underline" target="_blank" rel="noopener noreferrer"
                        href={`https://wa.me/${wa}?text=${encodeURIComponent(message(r.athlete_name))}`}>WhatsApp</a>
                    ) : null}
                    {r.athlete_email ? (
                      <a className="text-xs text-primary underline"
                        href={`mailto:${r.athlete_email}?subject=${encodeURIComponent(`Tu inscripción a ${eventTitle}`)}&body=${encodeURIComponent(message(r.athlete_name))}`}>Correo</a>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell>{catName(r.category_id)}</TableCell>
              <TableCell>{formatCOP(r.amount)}</TableCell>
              <TableCell className="text-right">
                <Badge variant={days >= 3 ? "destructive" : "outline"}>{days === 0 ? "Hoy" : days === 1 ? "1 día" : `${days} días`}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
        {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No hay atletas pendientes de pago.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ------------------------------ Oleadas ------------------------------
function Oleadas({ tenantId, eventId, eventDate, locked }: { tenantId: string; eventId: string; eventDate: string; locked: boolean }) {
  const [rows, setRows] = useState<api.Wave[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [waveSize, setWaveSize] = useState("20");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ wave_number: "1", name: "", scheduled_time: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Intervalo entre salidas: "cada cuántos minutos sale la siguiente oleada".
  // Solo se captura la HORA — la fecha ya es la de la carrera (eventDate),
  // no tiene sentido volver a pedirla oleada por oleada. No se persiste en
  // BD: es un ayudante de captura para la sesión actual.
  const [firstWaveTime, setFirstWaveTime] = useState(""); // "HH:MM"
  const [intervalMinutes, setIntervalMinutes] = useState("10");

  const load = useCallback(async () => {
    const [w, regs] = await Promise.all([api.listWaves(eventId), api.listRegistrations(eventId)]);
    setRows(w);
    const c: Record<string, number> = {};
    regs.forEach((r) => { if (r.wave_id) c[r.wave_id] = (c[r.wave_id] ?? 0) + 1; });
    setCounts(c);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  /** ISO completo = fecha de la carrera + una hora "HH:MM" (hora local del navegador). */
  function combineWithEventDate(time: string): string | null {
    if (!time) return null;
    const d = new Date(`${eventDate}T${time}:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  /** "HH:MM" a partir de un timestamp guardado, para mostrar/editar. */
  function toTimeInput(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Sugiere la hora de la próxima oleada manual = hora de la ÚLTIMA oleada
  // existente + intervalo (no depende de "Hora primera oleada", que es solo
  // el ancla para generar en bloque y se resetea al recargar la página).
  // Solo rellena si el campo sigue vacío, para no pisar una hora ya editada.
  useEffect(() => {
    if (!intervalMinutes || form.scheduled_time || rows.length === 0) return;
    const last = [...rows].sort((a, b) => (a.wave_number ?? 0) - (b.wave_number ?? 0)).at(-1);
    if (!last?.scheduled_time) return;
    const next = new Date(new Date(last.scheduled_time).getTime() + Number(intervalMinutes) * 60000);
    setForm((f) => (f.scheduled_time ? f : { ...f, scheduled_time: toTimeInput(next.toISOString()) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMinutes, rows]);

  async function generate() {
    const n = Number(waveSize);
    if (!n || n < 1) { toast.error("El tamaño de oleada debe ser mayor que 0"); return; }
    if (!confirm("Esto reemplaza las oleadas actuales y reasigna a los inscritos por categoría. ¿Continuar?")) return;
    setBusy(true);
    const startTime = combineWithEventDate(firstWaveTime);
    const schedule = startTime && intervalMinutes ? { startTime, intervalMinutes: Number(intervalMinutes) } : null;
    try { const created = await api.generateWaves(tenantId, eventId, n, schedule); toast.success(`${created} oleadas generadas`); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function addManual() {
    const { ok, errors } = validateForm(form, { wave_number: [positiveInt("El número")], name: [required("El nombre")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    try { await api.createWave(tenantId, eventId, { wave_number: Number(form.wave_number), name: form.name, scheduled_time: combineWithEventDate(form.scheduled_time) }); toast.success("Oleada agregada"); setForm({ wave_number: String(Number(form.wave_number) + 1), name: "", scheduled_time: "" }); setErrors({}); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function renameWave(id: string, name: string) {
    try { await api.updateWave(id, { name }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function rescheduleWave(id: string, time: string) {
    try { await api.updateWave(id, { scheduled_time: combineWithEventDate(time) }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }

  return (
    <div className="grid gap-4">
      {!locked ? (<>
        <Card><CardContent className="flex flex-wrap items-end gap-4 p-6">
          <Field label="Hora primera oleada"><Input className="w-32" type="time" value={firstWaveTime} onChange={(e) => setFirstWaveTime(e.target.value)} /></Field>
          <Field label="Intervalo (min)"><Input className="w-28" inputMode="numeric" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Atletas por oleada"><Input className="w-32" inputMode="numeric" value={waveSize} onChange={(e) => setWaveSize(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button onClick={generate} disabled={busy}><Wand2 className="mr-1 size-4" />Generar oleadas automáticamente</Button>
          <p className="w-full text-xs text-muted-foreground">
            Crea oleadas separadas por categoría, con máximo N atletas cada una, y reasigna a los inscritos, todas
            el {eventDate} (la fecha de la carrera). Si configuras hora e intervalo, cada oleada sale esa cantidad
            de minutos después de la anterior — el mismo intervalo sugiere automáticamente la hora al agregar una
            oleada manual abajo. Puedes ajustarlas manualmente después.
          </p>
        </CardContent></Card>

        <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Field label="N° *" error={errors["wave_number"]}><Input inputMode="numeric" value={form.wave_number} onChange={(e) => setForm({ ...form, wave_number: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Nombre *" error={errors["name"]}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Oleada manual" /></Field>
          <Field label="Hora prevista"><Input type="time" value={form.scheduled_time} onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })} /></Field>
          <div className="flex items-end"><Button variant="outline" onClick={addManual}><Plus className="mr-1 size-4" />Agregar manual</Button></div>
        </CardContent></Card>
      </>) : null}

      <SimpleTable head={["N°", "Nombre", "Hora prevista", "Atletas", "Estado / salida real", ""]}>
        {rows.map((w) => (
          <TableRow key={w.id}>
            <TableCell>{w.wave_number}</TableCell>
            <TableCell>
              <Input className="h-8 w-40 font-medium" disabled={locked} defaultValue={w.name} key={w.name}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== w.name) renameWave(w.id, e.target.value.trim()); }} />
            </TableCell>
            <TableCell>
              <Input className="h-8 w-28" type="time" disabled={locked} defaultValue={toTimeInput(w.scheduled_time)} key={w.scheduled_time ?? "none"}
                onBlur={(e) => rescheduleWave(w.id, e.target.value)} />
            </TableCell>
            <TableCell>{counts[w.id] ?? 0}</TableCell>
            <TableCell>
              <div>{(w.status ?? "pending").toUpperCase()}</div>
              {w.started_at ? <div className="text-xs text-muted-foreground">Salió: {new Date(w.started_at).toLocaleTimeString("es-CO")}</div> : null}
            </TableCell>
            <TableCell className="text-right">{!locked ? <Button size="sm" variant="ghost" onClick={async () => { try { await api.deleteWave(w.id); load(); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="size-4" /></Button> : null}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sin oleadas. Usa “Generar oleadas automáticamente”.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ---------------------------- Checkpoints ----------------------------
function Checkpoints({ tenantId, eventId, locked }: { tenantId: string; eventId: string; locked: boolean }) {
  const [rows, setRows] = useState<api.Checkpoint[]>([]);
  const [judges, setJudges] = useState<api.Judge[]>([]);
  const [checkpointJudge, setCheckpointJudge] = useState<Record<string, string>>({}); // checkpoint_id -> judge_id
  const [form, setForm] = useState({ name: "", judge_id: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cps, js, byJudge] = await Promise.all([api.listCheckpoints(eventId), api.listJudges(tenantId), api.listCheckpointJudges(eventId)]);
    setRows(cps); setJudges(js);
    // listCheckpointJudges viene indexado por juez; se invierte a por-checkpoint
    // porque en esta UI cada checkpoint tiene como máximo un juez asignado.
    const byCheckpoint: Record<string, string> = {};
    Object.entries(byJudge).forEach(([judgeId, checkpointIds]) => {
      checkpointIds.forEach((cpId) => { byCheckpoint[cpId] = judgeId; });
    });
    setCheckpointJudge(byCheckpoint);
  }, [eventId, tenantId]);
  useEffect(() => { load(); }, [load]);

  /** Salida = primero de la lista, Meta = último; lo demás es intermedio. */
  const typeOf = (index: number) => (index === 0 ? "Salida" : index === rows.length - 1 ? "Meta" : "Intermedio");

  /** Un juez puede tener máximo 2 checkpoints por carrera: avisa antes del segundo y bloquea el tercero. */
  function confirmJudgeLimit(judgeId: string, exceptCheckpointId?: string): boolean {
    const judge = judges.find((j) => j.id === judgeId);
    const name = judge?.full_name ?? "Este juez";
    const current = Object.entries(checkpointJudge).filter(([cpId, jId]) => jId === judgeId && cpId !== exceptCheckpointId).length;
    if (current >= 2) {
      toast.error(`${name} ya tiene 2 checkpoints en esta carrera. El máximo por juez es 2.`);
      return false;
    }
    if (current === 1) {
      return confirm(`${name} ya tiene un checkpoint en esta carrera. ¿Seguro que quieres asignarle un segundo? (Máximo 2 por juez)`);
    }
    return true;
  }

  async function add() {
    const { ok, errors } = validateForm(form, { name: [required("El nombre")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    if (form.judge_id && !confirmJudgeLimit(form.judge_id)) return;
    try {
      const id = await api.createCheckpoint(tenantId, eventId, { name: form.name });
      if (form.judge_id) await api.assignJudgeToCheckpoint(tenantId, id, form.judge_id);
      toast.success("Checkpoint agregado al final de la lista");
      setForm({ name: "", judge_id: "" }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function setJudgeFor(checkpointId: string, newJudgeId: string) {
    const prev = checkpointJudge[checkpointId];
    if (newJudgeId && newJudgeId !== prev && !confirmJudgeLimit(newJudgeId, checkpointId)) return;
    try {
      if (prev && prev !== newJudgeId) await api.unassignJudgeFromCheckpoint(checkpointId, prev);
      if (newJudgeId) await api.assignJudgeToCheckpoint(tenantId, checkpointId, newJudgeId);
      load();
    } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function move(fromId: string, toIndex: number) {
    const from = rows.findIndex((r) => r.id === fromId);
    if (from < 0 || from === toIndex || toIndex < 0 || toIndex >= rows.length) return;
    const next = [...rows];
    const item = next.splice(from, 1)[0]!;
    next.splice(toIndex, 0, item);
    setRows(next.map((r, i) => ({ ...r, ord: i + 1, is_start: i === 0, is_finish: i === next.length - 1 && next.length > 1 })));
    try { await api.reorderCheckpoints(eventId, next.map((r) => r.id)); } catch (e) { toast.error((e as Error).message); }
    load();
  }
  async function remove(id: string) {
    try { await api.deleteCheckpoint(id, eventId); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }

  return (
    <div className="grid gap-4">
      {!locked ? (
        <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Field label="Nombre *" error={errors["name"]}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Obstáculo 1" /></Field>
          <Field label="Juez">
            <Select value={form.judge_id} onValueChange={(v) => setForm({ ...form, judge_id: v })}>
              <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>{judges.map((j) => <SelectItem key={j.id} value={j.id}>{j.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="flex items-end"><Button onClick={add}><Plus className="mr-1 size-4" />Agregar</Button></div>
          <p className="text-xs text-muted-foreground sm:col-span-4">
            El primer checkpoint de la lista es la <strong>Salida</strong> y el último es la <strong>Meta</strong>; el resto son intermedios.
            Arrastra las filas (o usa las flechas) para cambiar el orden. Un juez puede atender máximo 2 checkpoints por carrera.
          </p>
        </CardContent></Card>
      ) : null}
      <SimpleTable head={["", "Orden", "Nombre", "Tipo", "Juez", ""]}>
        {rows.map((c, i) => (
          <TableRow
            key={c.id}
            draggable={!locked}
            onDragStart={() => setDragId(c.id)}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(c.id); } }}
            onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, i); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={[dragId === c.id ? "opacity-40" : "", overId === c.id && dragId !== c.id ? "bg-primary/10" : ""].join(" ")}
          >
            <TableCell className="w-10">{!locked ? <GripVertical className="size-4 cursor-grab text-muted-foreground" /> : null}</TableCell>
            <TableCell>{c.ord}</TableCell><TableCell className="font-medium">{c.name}</TableCell>
            <TableCell>{typeOf(i)}</TableCell>
            <TableCell>
              <Select value={checkpointJudge[c.id] ?? ""} onValueChange={(v) => setJudgeFor(c.id, v)} disabled={locked}>
                <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>{judges.map((j) => <SelectItem key={j.id} value={j.id}>{j.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </TableCell>
            <TableCell className="text-right">{!locked ? (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(c.id, i - 1)} aria-label="Subir"><ArrowUp className="size-4" /></Button>
                <Button size="sm" variant="ghost" disabled={i === rows.length - 1} onClick={() => move(c.id, i + 1)} aria-label="Bajar"><ArrowDown className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="size-4" /></Button>
              </div>
            ) : null}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Aún no hay checkpoints. El primero que agregues será la Salida.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ------------------------------- Jueces -------------------------------
// Solo crea/lista jueces — asignarlos a un checkpoint se hace desde la
// pestaña Checkpoints (un combo por checkpoint), no aquí.
function Jueces({ tenantId, locked }: { tenantId: string; locked: boolean }) {
  const [judges, setJudges] = useState<api.Judge[]>([]);
  const [form, setForm] = useState({ full_name: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => setJudges(await api.listJudges(tenantId)), [tenantId]);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    const { ok, errors } = validateForm(form, { full_name: [required("El nombre")], email: [required("El correo")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    setInviting(true);
    try {
      await api.inviteJudge(form);
      toast.success("Invitación enviada — el juez recibirá un correo para crear su contraseña");
      setForm({ full_name: "", email: "" }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); } finally { setInviting(false); }
  }

  async function resend(j: api.Judge) {
    if (!j.email || !j.full_name) return;
    setResendingId(j.id);
    try {
      await api.inviteJudge({ full_name: j.full_name, email: j.email });
      toast.success(`Invitación reenviada a ${j.email}`);
    } catch (e) { toast.error((e as Error).message); } finally { setResendingId(null); }
  }

  async function remove(j: api.Judge) {
    const isAdmin = j.role === "admin" || j.role === "superadmin";
    const isForeignJudge = j.role === "judge" && j.tenant_id !== tenantId;
    const isExtra = isAdmin || isForeignJudge;
    const msg = isAdmin
      ? `¿Quitar a ${j.full_name ?? j.email} de la lista de jueces? Sigue siendo administrador y conserva su cuenta, solo deja de aparecer para asignarlo a un checkpoint.`
      : isForeignJudge
        ? `¿Quitar a ${j.full_name ?? j.email} de la lista de jueces de esta liga? Sigue siendo juez de su liga de origen, solo deja de estar disponible aquí.`
        : j.password_set_at
          ? `¿Eliminar a ${j.full_name ?? j.email} como juez? Pierde acceso a FedOCR Timer y sus checkpoints asignados.`
          : `¿Cancelar la invitación a ${j.full_name ?? j.email}?`;
    if (!confirm(msg)) return;
    setRemovingId(j.id);
    try {
      await api.removeJudge(j.id);
      toast.success(isExtra ? "Quitado de la lista de jueces" : j.password_set_at ? "Juez eliminado" : "Invitación cancelada");
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setRemovingId(null); }
  }

  return (
    <div className="grid gap-4">
      {!locked ? (
        <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Field label="Nombre *" error={errors["full_name"]}><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Correo *" error={errors["email"]}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <div className="flex items-end sm:col-span-2"><Button onClick={invite} disabled={inviting}><Mail className="mr-1 size-4" />Invitar juez</Button></div>
          <p className="sm:col-span-4 text-xs text-muted-foreground">
            El juez recibe un correo para crear su contraseña; con ella inicia sesión en FedOCR Timer. Asigna el
            checkpoint de cada juez desde la pestaña Checkpoints. Si el correo ya tiene cuenta (atleta, admin,
            o juez de otra liga), se agrega sin pedirle contraseña nueva ni quitarle su rol o liga de origen.
          </p>
        </CardContent></Card>
      ) : null}
      <SimpleTable head={["Nombre", "Correo", "Estado", "Acciones"]}>
        {judges.map((j) => (
          <TableRow key={j.id}>
            <TableCell className="font-medium">
              {j.full_name ?? "—"}
              {j.role === "admin" || j.role === "superadmin" ? <Badge variant="outline" className="ml-2">Admin</Badge> : null}
              {j.role === "judge" && j.tenant_id !== tenantId ? <Badge variant="outline" className="ml-2">Otra liga</Badge> : null}
            </TableCell>
            <TableCell className="text-muted-foreground">{j.email ?? "—"}</TableCell>
            <TableCell>
              {j.password_set_at || j.role === "admin" || j.role === "superadmin" || (j.role === "judge" && j.tenant_id !== tenantId) ? (
                <Badge variant="default"><CheckCircle2 className="mr-1 size-3" />Cuenta creada</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={locked || resendingId === j.id} onClick={() => resend(j)}>
                  <Mail className="mr-1 size-4" />{resendingId === j.id ? "Enviando..." : "Reenviar invitación"}
                </Button>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={locked || removingId === j.id} onClick={() => remove(j)}>
                <Trash2 className="mr-1 size-4" />
                {removingId === j.id ? "Eliminando..." : (j.role === "admin" || j.role === "superadmin" || (j.role === "judge" && j.tenant_id !== tenantId)) ? "Quitar" : j.password_set_at ? "Eliminar" : "Cancelar invitación"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {judges.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sin jueces aún. Invita al primero arriba.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

function Gestores({ tenantId, eventId, locked }: { tenantId: string; eventId: string; locked: boolean }) {
  const [managers, setManagers] = useState<api.RaceManager[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ full_name: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, ids] = await Promise.all([api.listRaceManagers(tenantId), api.listEventManagerIds(eventId)]);
    setManagers(list); setAssigned(new Set(ids));
  }, [tenantId, eventId]);
  useEffect(() => { load(); }, [load]);

  async function toggleAssigned(m: api.RaceManager, on: boolean) {
    try {
      if (on) await api.assignEventManager(eventId, m.id); else await api.unassignEventManager(eventId, m.id);
      toast.success(on ? `${m.full_name ?? m.email} ahora gestiona esta carrera` : `${m.full_name ?? m.email} ya no gestiona esta carrera`);
      load();
    } catch (e) { toast.error((e as Error).message); load(); }
  }

  async function invite() {
    const { ok, errors } = validateForm(form, { full_name: [required("El nombre")], email: [required("El correo")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    setInviting(true);
    try {
      await api.inviteRaceManager(form);
      toast.success("Invitación enviada — recibirá un correo para crear su contraseña");
      setForm({ full_name: "", email: "" }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); } finally { setInviting(false); }
  }

  async function resend(m: api.RaceManager) {
    if (!m.email || !m.full_name) return;
    setResendingId(m.id);
    try {
      await api.inviteRaceManager({ full_name: m.full_name, email: m.email });
      toast.success(`Invitación reenviada a ${m.email}`);
    } catch (e) { toast.error((e as Error).message); } finally { setResendingId(null); }
  }

  async function remove(m: api.RaceManager) {
    const msg = m.password_set_at
      ? `¿Eliminar a ${m.full_name ?? m.email} como gestor de carreras?`
      : `¿Cancelar la invitación a ${m.full_name ?? m.email}?`;
    if (!confirm(msg)) return;
    setRemovingId(m.id);
    try {
      await api.removeRaceManager(m.id);
      toast.success(m.password_set_at ? "Gestor eliminado" : "Invitación cancelada");
      load();
    } catch (e) { toast.error((e as Error).message); } finally { setRemovingId(null); }
  }

  return (
    <div className="grid gap-4">
      {!locked ? (
        <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Field label="Nombre *" error={errors["full_name"]}><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Correo *" error={errors["email"]}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <div className="flex items-end sm:col-span-2"><Button onClick={invite} disabled={inviting}><Mail className="mr-1 size-4" />Invitar gestor</Button></div>
          <p className="sm:col-span-4 text-xs text-muted-foreground">
            Un gestor de carreras solo ve y prepara las carreras que le asignes aquí (datos, categorías, oleadas, checkpoints) y las
            envía a aprobación; no crea carreras ni gestiona otros usuarios. Marca "Asignado" en los gestores que trabajarán esta carrera.
          </p>
        </CardContent></Card>
      ) : null}
      <SimpleTable head={["Asignado a esta carrera", "Nombre", "Correo", "Estado", "Acciones"]}>
        {managers.map((m) => (
          <TableRow key={m.id}>
            <TableCell>
              <Switch checked={assigned.has(m.id)} disabled={locked || !m.password_set_at} onCheckedChange={(v) => toggleAssigned(m, v)}
                title={!m.password_set_at ? "Podrás asignarlo cuando cree su contraseña" : undefined} />
            </TableCell>
            <TableCell className="font-medium">{m.full_name ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
            <TableCell>
              {m.password_set_at ? (
                <Badge variant="default"><CheckCircle2 className="mr-1 size-3" />Cuenta creada</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={locked || resendingId === m.id} onClick={() => resend(m)}>
                  <Mail className="mr-1 size-4" />{resendingId === m.id ? "Enviando..." : "Reenviar invitación"}
                </Button>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={locked || removingId === m.id} onClick={() => remove(m)}>
                <Trash2 className="mr-1 size-4" />
                {removingId === m.id ? "Eliminando..." : m.password_set_at ? "Eliminar" : "Cancelar invitación"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {managers.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin gestores de carreras aún. Invita al primero arriba.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// --------------------------- Resultados en vivo -----------------------
/** HH:MM:SS,mmm — formato largo para exportar (Excel/PDF), igual al de las planillas de liga. */
function formatDurationLong(ms: number | null) {
  if (ms == null) return "";
  const total = Math.max(0, Math.round(ms));
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msRest = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msRest, 3)}`;
}
/** HH:MM:SS,mmm de un timestamp ISO, en hora local — para "Hora de salida/llegada" en el export. */
function formatClockTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`;
}
type ResultScope = "general" | "wave" | "category";

function Resultados({ event }: { event: EventRow }) {
  const eventId = event.id;
  const [rows, setRows] = useState<api.EventResult[]>([]);
  const [waves, setWaves] = useState<api.Wave[]>([]);
  const [cats, setCats] = useState<api.EventCategory[]>([]);
  const [tenantName, setTenantName] = useState("");
  const [scope, setScope] = useState<ResultScope>("general");
  const [waveId, setWaveId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, w, c] = await Promise.all([api.listResults(eventId), api.listWaves(eventId), api.listEventCategories(eventId)]);
      setRows(r); setWaves(w); setCats(c);
    } catch (e) { toast.error((e as Error).message); }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.listTenants().then((ts) => setTenantName(ts.find((t) => t.id === event.tenant_id)?.name ?? "")).catch(() => {});
  }, [event.tenant_id]);

  // Realtime: refresca la tabla cuando el Timer inserta/actualiza un resultado.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`results-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "results", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [eventId, load]);

  // Preselecciona la primera oleada/categoría al cambiar de vista.
  useEffect(() => {
    if (scope === "wave" && !waveId && waves[0]) setWaveId(waves[0].id);
    if (scope === "category" && !categoryId && cats[0]) setCategoryId(cats[0].id);
  }, [scope, waves, cats, waveId, categoryId]);

  async function recalc() {
    setBusy(true);
    try { await api.recalculatePositions(eventId); toast.success("Posiciones recalculadas"); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";

  const filtered = scope === "wave" && waveId ? rows.filter((r) => r.wave_id === waveId)
    : scope === "category" && categoryId ? rows.filter((r) => r.category_id === categoryId)
    : rows;
  const ranked = rankResults(filtered);

  // Título de la planilla, según el filtro activo — ej. "LIGA X — CARRERA — POR CATEGORÍA: ELITE MASCULINO"
  const scopeLabel = scope === "wave" ? `Por oleada: ${waves.find((w) => w.id === waveId)?.name ?? ""}`
    : scope === "category" ? `Por categoría: ${cats.find((c) => c.id === categoryId)?.name ?? ""}`
    : "Clasificación general";
  const sheetTitle = [tenantName, event.title, scopeLabel].filter(Boolean).join(" — ").toUpperCase();

  function exportResults(kind: "excel" | "pdf") {
    const cols: Column[] = [
      { header: "Posición", key: "pos" }, { header: "Dorsal", key: "bib" }, { header: "Atleta", key: "name" },
      { header: "Documento", key: "doc" }, { header: "Categoría", key: "cat" }, { header: "Oleada", key: "wave" },
      { header: "Hora de Salida", key: "start" }, { header: "Hora de Llegada", key: "finish" },
      { header: "Tiempo Bruto", key: "gross" }, { header: "Penalización", key: "penalty" },
      { header: "Tiempo Neto", key: "net" }, { header: "Estado", key: "status" },
    ];
    const data = ranked.map((r) => ({
      pos: r.rank ?? "", bib: r.bib_number ?? "", name: r.athlete_name ?? "", doc: r.athlete_document ?? "",
      cat: catName(r.category_id), wave: r.wave_name ?? "",
      start: formatClockTime(r.start_time), finish: formatClockTime(r.finish_at),
      gross: r.duration_ms != null ? formatDurationLong(r.duration_ms - r.penalty_seconds * 1000) : "",
      penalty: r.penalty_seconds ? `${r.penalty_seconds}s` : "",
      net: formatDurationLong(r.duration_ms),
      status: RESULT_STATUS_LABEL[r.status].label,
    }));
    if (kind === "excel") exportExcel(`resultados-${scope}`, [{ name: "Resultados", columns: cols, rows: data }]);
    else exportPDF(`resultados-${scope}`, sheetTitle, cols, data);
  }

  return (
    <div className="grid gap-4">
      <Card><CardContent className="flex flex-wrap items-end gap-4 p-6">
        <Field label="Clasificación">
          <Select value={scope} onValueChange={(v) => setScope(v as ResultScope)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="wave">Por oleada</SelectItem>
              <SelectItem value="category">Por categoría</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {scope === "wave" ? (
          <Field label="Oleada">
            <Select value={waveId} onValueChange={setWaveId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Selecciona una oleada" /></SelectTrigger>
              <SelectContent>{waves.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        ) : null}
        {scope === "category" ? (
          <Field label="Categoría">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Selecciona una categoría" /></SelectTrigger>
              <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        ) : null}
      </CardContent></Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{ranked.length} resultado(s) · se actualiza en vivo</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportResults("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportResults("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
          <Button size="sm" onClick={recalc} disabled={busy}><RefreshCw className="mr-1 size-4" />Recalcular posiciones</Button>
        </div>
      </div>
      <SimpleTable head={["Pos.", "Dorsal", "Atleta", "Categoría", "Oleada", "Tiempo", "Estado"]}>
        {ranked.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono">{r.rank ?? "—"}</TableCell>
            <TableCell className="font-mono">{r.bib_number ?? "—"}</TableCell>
            <TableCell className="font-medium">{r.athlete_name ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{catName(r.category_id)}</TableCell>
            <TableCell className="text-muted-foreground">{r.wave_name ?? "—"}</TableCell>
            <TableCell className="font-mono">{formatDuration(r.duration_ms)}</TableCell>
            <TableCell><Badge variant={RESULT_STATUS_LABEL[r.status].variant}>{RESULT_STATUS_LABEL[r.status].label}</Badge></TableCell>
          </TableRow>
        ))}
        {ranked.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">
          {rows.length === 0 ? "Aún no hay resultados. Se llenan cuando el juez cronometra con FedOCR Timer." : "Sin resultados para este filtro."}
        </TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ----------------------------- helpers UI ----------------------------
function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}{error ? <span className="text-xs text-destructive">{error}</span> : null}</div>;
}
