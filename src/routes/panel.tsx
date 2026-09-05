import { createFileRoute, Link } from "@tanstack/react-router";
import { Children, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, CalendarPlus, Flag, Users, Timer, Plus, Trash2, Send, CheckCircle2, XCircle, ClipboardCheck, Wand2, Layers, FileSpreadsheet, FileText, Hash, RefreshCw, Trophy } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useSession } from "@/lib/use-session";
import * as api from "@/lib/admin-api";
import type { Tenant, EventRow, EventStatus } from "@/lib/admin-api";
import { validateForm, required, slug as slugRule, numeric, positiveInt, decimalNonNeg } from "@/lib/validate";
import { exportExcel, exportPDF, type Column } from "@/lib/export";

export const Route = createFileRoute("/panel")({
  head: () => ({ meta: [{ title: "Panel de administración — FEDOCR Colombia" }, { name: "robots", content: "noindex" }] }),
  component: PanelPage,
});

function PanelPage() {
  const { loading, email, profile, signOut } = useSession();
  if (!isSupabaseConfigured) return <Shell><Note>Configura las variables de Supabase para usar el panel real.</Note></Shell>;
  if (loading) return <Shell><Note>Cargando…</Note></Shell>;
  if (!profile) return <Shell><Note>Debes iniciar sesión para administrar. <Link className="text-primary underline" to="/auth">Ir a ingresar</Link>.</Note></Shell>;
  if (profile.role === "athlete") return <Shell><Note>Tu cuenta es de atleta. El panel de administración es para ligas y la federación.</Note></Shell>;

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Panel de administración</h1>
          <p className="text-sm text-muted-foreground">{email} · {profile.role === "superadmin" ? "Administración nacional" : "Administrador de liga"}</p>
        </div>
        <Button variant="outline" onClick={signOut}>Salir</Button>
      </div>
      <AdminConsole role={profile.role} fixedTenant={profile.tenant_id} />
    </Shell>
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
  pending_federation: { label: "Pend. federación", variant: "outline" },
  approved: { label: "Aprobado", variant: "default" },
  in_progress: { label: "En curso", variant: "default" },
  finished: { label: "Finalizado", variant: "secondary" },
  cancelled: { label: "Cancelado", variant: "destructive" },
};
function StatusBadge({ status }: { status: EventStatus }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.draft;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// =====================================================================
function AdminConsole({ role, fixedTenant }: { role: string; fixedTenant: string | null }) {
  const isSuper = role === "superadmin";
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenant, setActiveTenant] = useState<string | null>(fixedTenant);

  const loadTenants = useCallback(async () => {
    try {
      const t = await api.listTenants();
      setTenants(t);
      if (isSuper && !activeTenant && t[0]) setActiveTenant(t[0].id);
    } catch (e) { toast.error((e as Error).message); }
  }, [isSuper, activeTenant]);
  useEffect(() => { loadTenants(); }, [loadTenants]);

  return (
    <Tabs defaultValue={isSuper ? "ligas" : "carreras"}>
      <TabsList>
        {isSuper ? <TabsTrigger value="ligas"><Building2 className="mr-1 size-4" />Ligas</TabsTrigger> : null}
        <TabsTrigger value="carreras"><Flag className="mr-1 size-4" />Carreras</TabsTrigger>
        {isSuper ? <TabsTrigger value="aprobaciones"><ClipboardCheck className="mr-1 size-4" />Aprobaciones</TabsTrigger> : null}
      </TabsList>

      {isSuper ? <TabsContent value="ligas" className="mt-6"><LigasSection tenants={tenants} onChange={loadTenants} /></TabsContent> : null}

      <TabsContent value="carreras" className="mt-6">
        {isSuper ? (
          <div className="mb-4 grid max-w-sm gap-2">
            <Label>Liga activa</Label>
            <Select value={activeTenant ?? ""} onValueChange={setActiveTenant}>
              <SelectTrigger><SelectValue placeholder="Selecciona una liga" /></SelectTrigger>
              <SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {activeTenant ? <CarrerasSection tenantId={activeTenant} isSuper={isSuper} /> : <Note>Selecciona o crea una liga primero.</Note>}
      </TabsContent>

      {isSuper ? <TabsContent value="aprobaciones" className="mt-6"><Aprobaciones tenants={tenants} /></TabsContent> : null}
    </Tabs>
  );
}

// ------------------------------- Ligas -------------------------------
function LigasSection({ tenants, onChange }: { tenants: Tenant[]; onChange: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", department: "", city: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function create() {
    const { ok, errors } = validateForm(form, { name: [required("El nombre")], slug: [slugRule()], department: [required("El departamento")] });
    setErrors(errors as Record<string, string>);
    if (!ok) return;
    setBusy(true);
    try { await api.createTenant(form); toast.success("Liga creada"); setForm({ name: "", slug: "", department: "", city: "" }); setErrors({}); onChange(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="Nombre *" error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Liga Valle OCR" /></Field>
        <Field label="Slug *" error={errors.slug}><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="valle" /></Field>
        <Field label="Departamento *" error={errors.department}><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Valle del Cauca" /></Field>
        <Field label="Ciudad"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Cali" /></Field>
        <div className="sm:col-span-4"><Button onClick={create} disabled={busy}><Plus className="mr-1 size-4" />Crear liga</Button></div>
      </CardContent></Card>
      <SimpleTable head={["Liga", "Depto", "Estado", "Habilitada"]}>
        {tenants.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-medium">{t.name}</TableCell>
            <TableCell className="text-muted-foreground">{t.department}</TableCell>
            <TableCell><Badge variant={t.status === "active" ? "default" : "destructive"}>{t.status === "active" ? "Activa" : "Suspendida"}</Badge></TableCell>
            <TableCell className="text-right"><Switch defaultChecked={t.status === "active"} onCheckedChange={async (v) => {
              try { await api.setTenantStatus(t.id, v ? "active" : "suspended"); toast.success("Actualizada"); onChange(); } catch (e) { toast.error((e as Error).message); }
            }} /></TableCell>
          </TableRow>
        ))}
        {tenants.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aún no hay ligas.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ---------------------------- Aprobaciones ---------------------------
function Aprobaciones({ tenants }: { tenants: Tenant[] }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const load = useCallback(async () => { try { setRows(await api.listPendingFederation()); } catch (e) { toast.error((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);
  const ligaName = (id: string) => tenants.find((t) => t.id === id)?.name ?? "—";
  async function act(id: string, fn: (id: string) => Promise<void>, msg: string) {
    try { await fn(id); toast.success(msg); load(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <SimpleTable head={["Carrera", "Liga", "Fecha", "Acciones"]}>
      {rows.map((e) => (
        <TableRow key={e.id}>
          <TableCell className="font-medium">{e.title}</TableCell>
          <TableCell className="text-muted-foreground">{ligaName(e.tenant_id)}</TableCell>
          <TableCell className="text-muted-foreground">{e.date}</TableCell>
          <TableCell className="text-right"><div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => act(e.id, api.approveEvent, "Evento aprobado")}><CheckCircle2 className="mr-1 size-4" />Aprobar</Button>
            <Button size="sm" variant="outline" onClick={() => act(e.id, api.rejectEvent, "Devuelto a borrador")}><XCircle className="mr-1 size-4" />Rechazar</Button>
          </div></TableCell>
        </TableRow>
      ))}
      {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No hay carreras pendientes de aprobación.</TableCell></TableRow> : null}
    </SimpleTable>
  );
}

// ------------------------------ Carreras -----------------------------
function CarrerasSection({ tenantId, isSuper }: { tenantId: string; isSuper: boolean }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [form, setForm] = useState({ title: "", date: "", location: "", distance_km: "", obstacles: "", max_capacity: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setEvents(await api.listEvents(tenantId)); } catch (e) { toast.error((e as Error).message); } }, [tenantId]);
  useEffect(() => { setSelected(null); load(); }, [load]);

  async function create() {
    const { ok, errors } = validateForm(form, {
      title: [required("El nombre")], date: [required("La fecha")], location: [required("El lugar")], distance_km: [decimalNonNeg("La distancia")],
    });
    setErrors(errors as Record<string, string>);
    if (!ok) return;
    setBusy(true);
    try {
      await api.createEvent({
        tenant_id: tenantId, title: form.title, date: form.date, location: form.location,
        distance_km: form.distance_km ? Number(form.distance_km) : undefined,
        obstacles: form.obstacles ? Number(form.obstacles) : undefined,
        max_capacity: form.max_capacity ? Number(form.max_capacity) : undefined,
      });
      toast.success("Carrera creada (en borrador)");
      setForm({ title: "", date: "", location: "", distance_km: "", obstacles: "", max_capacity: "" }); setErrors({}); load();
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

  if (selected) return <EventoDetalle tenantId={tenantId} event={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-3">
        <Field label="Nombre *" error={errors.title}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Reto OCR Cali 2026" /></Field>
        <Field label="Fecha *" error={errors.date}><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Lugar *" error={errors.location}><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Parque del Río" /></Field>
        <Field label="Distancia (km)" error={errors.distance_km}><Input inputMode="decimal" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} placeholder="5" /></Field>
        <Field label="Obstáculos"><Input inputMode="numeric" value={form.obstacles} onChange={(e) => setForm({ ...form, obstacles: e.target.value.replace(/\D/g, "") })} placeholder="20" /></Field>
        <Field label="Cupos"><Input inputMode="numeric" value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: e.target.value.replace(/\D/g, "") })} placeholder="300" /></Field>
        <div className="sm:col-span-3"><Button onClick={create} disabled={busy}><CalendarPlus className="mr-1 size-4" />Crear carrera</Button></div>
      </CardContent></Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{events.length} carrera(s)</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportRaces("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportRaces("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
      </div>

      <SimpleTable head={["Carrera", "Fecha", "Estado", "Acciones"]}>
        {events.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="font-medium">{e.title}</TableCell>
            <TableCell className="text-muted-foreground">{e.date}</TableCell>
            <TableCell><StatusBadge status={e.status} /></TableCell>
            <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
              {e.status === "draft" ? <Button size="sm" variant="secondary" onClick={() => act(e.id, api.submitEvent, "Enviado a aprobación")}><Send className="mr-1 size-4" />Enviar a aprobación</Button> : null}
              {e.status === "pending_federation" && isSuper ? (<>
                <Button size="sm" onClick={() => act(e.id, api.approveEvent, "Aprobado")}><CheckCircle2 className="mr-1 size-4" />Aprobar</Button>
                <Button size="sm" variant="outline" onClick={() => act(e.id, api.rejectEvent, "Rechazado")}><XCircle className="mr-1 size-4" />Rechazar</Button>
              </>) : null}
              <Button size="sm" variant="outline" onClick={() => setSelected(e)}><Timer className="mr-1 size-4" />Abrir</Button>
            </div></TableCell>
          </TableRow>
        ))}
        {events.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aún no hay carreras en esta liga.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// --------------------------- Detalle evento --------------------------
function EventoDetalle({ tenantId, event, onBack }: { tenantId: string; event: EventRow; onBack: () => void }) {
  return (
    <div className="grid gap-4">
      <button onClick={onBack} className="text-left text-sm text-primary">← Volver a carreras</button>
      <div className="flex items-center gap-3"><h2 className="font-display text-3xl">{event.title}</h2><StatusBadge status={event.status} /></div>
      <p className="text-sm text-muted-foreground">{event.date} · {event.location}</p>
      <Tabs defaultValue="categorias" className="mt-2">
        <TabsList>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
          <TabsTrigger value="inscritos">Inscritos</TabsTrigger>
          <TabsTrigger value="oleadas">Oleadas</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          <TabsTrigger value="resultados"><Trophy className="mr-1 size-4" />Resultados</TabsTrigger>
        </TabsList>
        <TabsContent value="categorias" className="mt-4"><Categorias eventId={event.id} /></TabsContent>
        <TabsContent value="inscritos" className="mt-4"><Inscritos tenantId={tenantId} eventId={event.id} /></TabsContent>
        <TabsContent value="oleadas" className="mt-4"><Oleadas tenantId={tenantId} eventId={event.id} /></TabsContent>
        <TabsContent value="checkpoints" className="mt-4"><Checkpoints tenantId={tenantId} eventId={event.id} /></TabsContent>
        <TabsContent value="resultados" className="mt-4"><Resultados eventId={event.id} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------- Maestro de categorías por carrera ------------------
function Categorias({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<api.EventCategory[]>([]);
  const [form, setForm] = useState({ name: "", gender: "", min_age: "", max_age: "" });
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
      });
      toast.success("Categoría agregada"); setForm({ name: "", gender: "", min_age: "", max_age: "" }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function seed() { try { await api.seedStandardCategories(eventId); toast.success("Categorías estándar agregadas"); load(); } catch (e) { toast.error((e as Error).message); } }

  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-5">
        <Field label="Nombre *" error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Elite Masculino" /></Field>
        <Field label="Género">
          <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="M">M</SelectItem><SelectItem value="F">F</SelectItem><SelectItem value="X">X</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Edad mín."><Input inputMode="numeric" value={form.min_age} onChange={(e) => setForm({ ...form, min_age: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Edad máx."><Input inputMode="numeric" value={form.max_age} onChange={(e) => setForm({ ...form, max_age: e.target.value.replace(/\D/g, "") })} /></Field>
        <div className="flex items-end gap-2"><Button onClick={add}><Plus className="mr-1 size-4" />Agregar</Button></div>
        <div className="sm:col-span-5"><Button variant="outline" size="sm" onClick={seed}><Layers className="mr-1 size-4" />Sembrar categorías estándar</Button></div>
      </CardContent></Card>
      <SimpleTable head={["Categoría", "Género", "Edad", ""]}>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell>{c.gender ?? "Todos"}</TableCell>
            <TableCell>{c.min_age ?? "—"}{c.max_age ? `–${c.max_age}` : c.min_age ? "+" : ""}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={async () => { try { await api.deleteEventCategory(c.id); load(); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="size-4" /></Button></TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sin categorías. Usa “Sembrar categorías estándar”.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ------------------------------ Inscritos ----------------------------
function Inscritos({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [rows, setRows] = useState<api.Registration[]>([]);
  const [waves, setWaves] = useState<api.Wave[]>([]);
  const [cats, setCats] = useState<api.EventCategory[]>([]);
  const [form, setForm] = useState({ athlete_name: "", athlete_document: "", athlete_gender: "M", category_id: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [r, w, c] = await Promise.all([api.listRegistrations(eventId), api.listWaves(eventId), api.listEventCategories(eventId)]);
    setRows(r); setWaves(w); setCats(c);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const { ok, errors } = validateForm(form, {
      athlete_name: [required("El nombre")], athlete_document: [numeric("El documento", 5)], category_id: [required("La categoría")],
    });
    setErrors(errors as Record<string, string>); if (!ok) return;
    try {
      await api.createRegistration({
        tenant_id: tenantId, event_id: eventId, category_id: form.category_id,
        athlete_name: form.athlete_name, athlete_document: form.athlete_document,
        athlete_gender: form.athlete_gender as "F" | "M" | "X",
        // bib_number omitido → se asigna automáticamente
      });
      toast.success("Atleta inscrito (dorsal automático)");
      setForm({ athlete_name: "", athlete_document: "", athlete_gender: "M", category_id: "" }); setErrors({}); load();
    } catch (e) { toast.error((e as Error).message); }
  }

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
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-5">
        <Field label="Nombre *" error={errors.athlete_name}><Input value={form.athlete_name} onChange={(e) => setForm({ ...form, athlete_name: e.target.value })} /></Field>
        <Field label="Documento *" error={errors.athlete_document}><Input inputMode="numeric" value={form.athlete_document} onChange={(e) => setForm({ ...form, athlete_document: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Sexo">
          <Select value={form.athlete_gender} onValueChange={(v) => setForm({ ...form, athlete_gender: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="M">M</SelectItem><SelectItem value="F">F</SelectItem><SelectItem value="X">X</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Categoría *" error={errors.category_id}>
          <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex items-end"><Button onClick={add}><Users className="mr-1 size-4" />Inscribir</Button></div>
        <p className="sm:col-span-5 text-xs text-muted-foreground">El dorsal se asigna automáticamente. Las oleadas se asignan al generarlas o manualmente en la tabla.</p>
      </CardContent></Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{rows.length} inscrito(s)</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={autoAssign}><Hash className="mr-1 size-4" />Autoasignar dorsales</Button>
          <Button size="sm" variant="outline" onClick={() => exportRoster("excel")}><FileSpreadsheet className="mr-1 size-4" />Excel</Button>
          <Button size="sm" variant="outline" onClick={() => exportRoster("pdf")}><FileText className="mr-1 size-4" />PDF</Button>
        </div>
      </div>

      <SimpleTable head={["Dorsal", "Atleta", "Doc", "Categoría", "Oleada"]}>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Input className="h-8 w-20 font-mono" inputMode="numeric" defaultValue={r.bib_number ?? ""} key={r.bib_number ?? "empty"}
                onBlur={(e) => { if (e.target.value !== String(r.bib_number ?? "")) changeBib(r.id, e.target.value.replace(/\D/g, "")); }} />
            </TableCell>
            <TableCell className="font-medium">{r.athlete_name}</TableCell>
            <TableCell className="text-muted-foreground">{r.athlete_document}</TableCell>
            <TableCell>{catName(r.category_id)}</TableCell>
            <TableCell className="text-right">
              <Select value={r.wave_id ?? ""} onValueChange={(v) => reassignWave(r.id, v)}>
                <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Sin oleada" /></SelectTrigger>
                <SelectContent>{waves.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin inscritos aún.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ------------------------------ Oleadas ------------------------------
function Oleadas({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [rows, setRows] = useState<api.Wave[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [waveSize, setWaveSize] = useState("20");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ wave_number: "1", name: "", scheduled_time: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [w, regs] = await Promise.all([api.listWaves(eventId), api.listRegistrations(eventId)]);
    setRows(w);
    const c: Record<string, number> = {};
    regs.forEach((r) => { if (r.wave_id) c[r.wave_id] = (c[r.wave_id] ?? 0) + 1; });
    setCounts(c);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    const n = Number(waveSize);
    if (!n || n < 1) { toast.error("El tamaño de oleada debe ser mayor que 0"); return; }
    if (!confirm("Esto reemplaza las oleadas actuales y reasigna a los inscritos por categoría. ¿Continuar?")) return;
    setBusy(true);
    try { const created = await api.generateWaves(tenantId, eventId, n); toast.success(`${created} oleadas generadas`); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function addManual() {
    const { ok, errors } = validateForm(form, { wave_number: [positiveInt("El número")], name: [required("El nombre")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    try { await api.createWave(tenantId, eventId, { wave_number: Number(form.wave_number), name: form.name, scheduled_time: form.scheduled_time || null }); toast.success("Oleada agregada"); setForm({ wave_number: String(Number(form.wave_number) + 1), name: "", scheduled_time: "" }); setErrors({}); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function renameWave(id: string, name: string) {
    try { await api.updateWave(id, { name }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }
  async function rescheduleWave(id: string, scheduled_time: string) {
    try { await api.updateWave(id, { scheduled_time: scheduled_time || null }); load(); } catch (e) { toast.error((e as Error).message); load(); }
  }
  function toLocalInput(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return (
    <div className="grid gap-4">
      <Card><CardContent className="flex flex-wrap items-end gap-4 p-6">
        <Field label="Atletas por oleada"><Input className="w-32" inputMode="numeric" value={waveSize} onChange={(e) => setWaveSize(e.target.value.replace(/\D/g, ""))} /></Field>
        <Button onClick={generate} disabled={busy}><Wand2 className="mr-1 size-4" />Generar oleadas automáticamente</Button>
        <p className="w-full text-xs text-muted-foreground">Crea oleadas separadas por categoría, con máximo N atletas cada una, y reasigna a los inscritos. Puedes ajustarlas manualmente abajo.</p>
      </CardContent></Card>

      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="N° *" error={errors.wave_number}><Input inputMode="numeric" value={form.wave_number} onChange={(e) => setForm({ ...form, wave_number: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Nombre *" error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Oleada manual" /></Field>
        <Field label="Hora prevista"><Input type="datetime-local" value={form.scheduled_time} onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })} /></Field>
        <div className="flex items-end"><Button variant="outline" onClick={addManual}><Plus className="mr-1 size-4" />Agregar manual</Button></div>
      </CardContent></Card>

      <SimpleTable head={["N°", "Nombre", "Hora prevista", "Atletas", "Estado / salida real", ""]}>
        {rows.map((w) => (
          <TableRow key={w.id}>
            <TableCell>{w.wave_number}</TableCell>
            <TableCell>
              <Input className="h-8 w-40 font-medium" defaultValue={w.name} key={w.name}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== w.name) renameWave(w.id, e.target.value.trim()); }} />
            </TableCell>
            <TableCell>
              <Input className="h-8 w-48" type="datetime-local" defaultValue={toLocalInput(w.scheduled_time)} key={w.scheduled_time ?? "none"}
                onBlur={(e) => rescheduleWave(w.id, e.target.value)} />
            </TableCell>
            <TableCell>{counts[w.id] ?? 0}</TableCell>
            <TableCell>
              <div>{(w.status ?? "pending").toUpperCase()}</div>
              {w.started_at ? <div className="text-xs text-muted-foreground">Salió: {new Date(w.started_at).toLocaleTimeString("es-CO")}</div> : null}
            </TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={async () => { try { await api.deleteWave(w.id); load(); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="size-4" /></Button></TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sin oleadas. Usa “Generar oleadas automáticamente”.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ---------------------------- Checkpoints ----------------------------
function Checkpoints({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [rows, setRows] = useState<api.Checkpoint[]>([]);
  const [form, setForm] = useState({ name: "", ord: "1", is_start: false, is_finish: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const load = useCallback(async () => setRows(await api.listCheckpoints(eventId)), [eventId]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    const { ok, errors } = validateForm(form, { name: [required("El nombre")], ord: [positiveInt("El orden")] });
    setErrors(errors as Record<string, string>); if (!ok) return;
    try { await api.createCheckpoint(tenantId, eventId, { name: form.name, ord: Number(form.ord), is_start: form.is_start, is_finish: form.is_finish }); toast.success("Checkpoint agregado"); setForm({ name: "", ord: String(Number(form.ord) + 1), is_start: false, is_finish: false }); setErrors({}); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-5">
        <Field label="Nombre *" error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meta" /></Field>
        <Field label="Orden *" error={errors.ord}><Input inputMode="numeric" value={form.ord} onChange={(e) => setForm({ ...form, ord: e.target.value.replace(/\D/g, "") })} /></Field>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_start} onCheckedChange={(v) => setForm({ ...form, is_start: v })} />Salida</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_finish} onCheckedChange={(v) => setForm({ ...form, is_finish: v })} />Meta</label>
        <div className="flex items-end"><Button onClick={add}><Plus className="mr-1 size-4" />Agregar</Button></div>
      </CardContent></Card>
      <SimpleTable head={["Orden", "Nombre", "Tipo", ""]}>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell>{c.ord}</TableCell><TableCell className="font-medium">{c.name}</TableCell>
            <TableCell>{c.is_start ? "Salida" : c.is_finish ? "Meta" : "Intermedio"}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={async () => { await api.deleteCheckpoint(c.id); load(); }}><Trash2 className="size-4" /></Button></TableCell>
          </TableRow>
        ))}
      </SimpleTable>
    </div>
  );
}

// --------------------------- Resultados en vivo -----------------------
const RESULT_STATUS_LABEL: Record<api.EventResult["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  finished: { label: "OK", variant: "default" },
  dnf: { label: "DNF", variant: "destructive" },
  dsq: { label: "DSQ", variant: "destructive" },
  dns: { label: "DNS", variant: "secondary" },
};
function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function Resultados({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<api.EventResult[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setRows(await api.listResults(eventId)); } catch (e) { toast.error((e as Error).message); } }, [eventId]);
  useEffect(() => { load(); }, [load]);

  // Realtime: refresca la tabla cuando el Timer inserta/actualiza un resultado.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`results-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "results", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [eventId, load]);

  async function recalc() {
    setBusy(true);
    try { await api.recalculatePositions(eventId); toast.success("Posiciones recalculadas"); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{rows.length} resultado(s) · se actualiza en vivo</span>
        <Button size="sm" onClick={recalc} disabled={busy}><RefreshCw className="mr-1 size-4" />Recalcular posiciones</Button>
      </div>
      <SimpleTable head={["Pos.", "Dorsal", "Atleta", "Oleada", "Tiempo", "Estado"]}>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono">{r.position ?? "—"}</TableCell>
            <TableCell className="font-mono">{r.bib_number ?? "—"}</TableCell>
            <TableCell className="font-medium">{r.athlete_name ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{r.wave_name ?? "—"}</TableCell>
            <TableCell className="font-mono">{formatDuration(r.duration_ms)}</TableCell>
            <TableCell><Badge variant={RESULT_STATUS_LABEL[r.status].variant}>{RESULT_STATUS_LABEL[r.status].label}</Badge></TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Aún no hay resultados. Se llenan cuando el juez cronometra con FedOCR Timer.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ----------------------------- helpers UI ----------------------------
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}{error ? <span className="text-xs text-destructive">{error}</span> : null}</div>;
}
const PAGE_SIZES = [10, 20, 50, 100];
function SimpleTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  const items = Children.toArray(children);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = items.slice(current * pageSize, current * pageSize + pageSize);
  useEffect(() => { setPage(0); }, [pageSize, total]);

  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{head.map((h, i) => <TableHead key={i} className={i === head.length - 1 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{slice}</TableBody>
      </Table>
      {total > PAGE_SIZES[0] ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Ver</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-muted-foreground">de {total} registros</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</Button>
            <span className="text-muted-foreground">Página {current + 1} de {pages}</span>
            <Button size="sm" variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Siguiente</Button>
          </div>
        </div>
      ) : null}
    </CardContent></Card>
  );
}
