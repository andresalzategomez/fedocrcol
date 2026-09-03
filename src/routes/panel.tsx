import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, CalendarPlus, Flag, Users, Timer, Plus, Trash2 } from "lucide-react";
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
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSession } from "@/lib/use-session";
import * as api from "@/lib/admin-api";
import type { Tenant, EventRow, Category } from "@/lib/admin-api";

export const Route = createFileRoute("/panel")({
  head: () => ({
    meta: [
      { title: "Panel de administración — FEDOCR Colombia" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PanelPage,
});

function PanelPage() {
  const { loading, email, profile, signOut } = useSession();

  if (!isSupabaseConfigured) {
    return <Shell><Note>Configura las variables de Supabase para usar el panel real.</Note></Shell>;
  }
  if (loading) return <Shell><Note>Cargando…</Note></Shell>;
  if (!profile) {
    return (
      <Shell>
        <Note>
          Debes iniciar sesión para administrar. <Link className="text-primary underline" to="/auth">Ir a ingresar</Link>.
        </Note>
      </Shell>
    );
  }
  if (profile.role === "athlete") {
    return <Shell><Note>Tu cuenta es de atleta. El panel de administración es para ligas y la federación.</Note></Shell>;
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Panel de administración</h1>
          <p className="text-sm text-muted-foreground">
            {email} · {profile.role === "superadmin" ? "Administración nacional" : "Administrador de liga"}
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>Salir</Button>
      </div>
      <AdminConsole role={profile.role} fixedTenant={profile.tenant_id} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</div>
      <SiteFooter />
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{children}</div>;
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
      </TabsList>

      {isSuper ? (
        <TabsContent value="ligas" className="mt-6">
          <LigasSection tenants={tenants} onChange={loadTenants} />
        </TabsContent>
      ) : null}

      <TabsContent value="carreras" className="mt-6">
        {isSuper ? (
          <div className="mb-4 grid max-w-sm gap-2">
            <Label>Liga activa</Label>
            <Select value={activeTenant ?? ""} onValueChange={setActiveTenant}>
              <SelectTrigger><SelectValue placeholder="Selecciona una liga" /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {activeTenant ? <CarrerasSection tenantId={activeTenant} /> : <Note>Selecciona o crea una liga primero.</Note>}
      </TabsContent>
    </Tabs>
  );
}

// ------------------------------- Ligas -------------------------------
function LigasSection({ tenants, onChange }: { tenants: Tenant[]; onChange: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", department: "", city: "" });
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!form.name || !form.slug || !form.department) { toast.error("Nombre, slug y departamento son obligatorios"); return; }
    setBusy(true);
    try {
      await api.createTenant(form);
      toast.success("Liga creada");
      setForm({ name: "", slug: "", department: "", city: "" });
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="Nombre"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Liga Valle OCR" /></Field>
        <Field label="Slug"><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="valle" /></Field>
        <Field label="Departamento"><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Valle del Cauca" /></Field>
        <Field label="Ciudad"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Cali" /></Field>
        <div className="sm:col-span-4"><Button onClick={create} disabled={busy}><Plus className="mr-1 size-4" />Crear liga</Button></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Liga</TableHead><TableHead>Depto</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Habilitada</TableHead></TableRow></TableHeader>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-muted-foreground">{t.department}</TableCell>
                <TableCell><Badge variant={t.status === "active" ? "default" : "destructive"}>{t.status === "active" ? "Activa" : "Suspendida"}</Badge></TableCell>
                <TableCell className="text-right">
                  <Switch defaultChecked={t.status === "active"} onCheckedChange={async (v) => {
                    try { await api.setTenantStatus(t.id, v ? "active" : "suspended"); toast.success("Actualizada"); onChange(); }
                    catch (e) { toast.error((e as Error).message); }
                  }} />
                </TableCell>
              </TableRow>
            ))}
            {tenants.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aún no hay ligas.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ------------------------------ Carreras -----------------------------
function CarrerasSection({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [form, setForm] = useState({ title: "", date: "", location: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setEvents(await api.listEvents(tenantId)); } catch (e) { toast.error((e as Error).message); }
  }, [tenantId]);
  useEffect(() => { setSelected(null); load(); }, [load]);

  async function create() {
    if (!form.title || !form.date || !form.location) { toast.error("Nombre, fecha y lugar son obligatorios"); return; }
    setBusy(true);
    try { await api.createEvent({ tenant_id: tenantId, ...form }); toast.success("Carrera creada"); setForm({ title: "", date: "", location: "" }); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  if (selected) return <EventoDetalle tenantId={tenantId} event={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="grid gap-6">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="Nombre"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Reto OCR Cali 2026" /></Field>
        <Field label="Fecha"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Lugar"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Parque del Río" /></Field>
        <div className="flex items-end"><Button onClick={create} disabled={busy}><CalendarPlus className="mr-1 size-4" />Crear carrera</Button></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Carrera</TableHead><TableHead>Fecha</TableHead><TableHead>Lugar</TableHead><TableHead className="text-right">Gestionar</TableHead></TableRow></TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.title}</TableCell>
                <TableCell className="text-muted-foreground">{e.date}</TableCell>
                <TableCell className="text-muted-foreground">{e.location}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setSelected(e)}><Timer className="mr-1 size-4" />Abrir</Button></TableCell>
              </TableRow>
            ))}
            {events.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aún no hay carreras en esta liga.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// --------------------------- Detalle evento --------------------------
function EventoDetalle({ tenantId, event, onBack }: { tenantId: string; event: EventRow; onBack: () => void }) {
  return (
    <div className="grid gap-4">
      <button onClick={onBack} className="text-left text-sm text-primary">← Volver a carreras</button>
      <h2 className="font-display text-3xl">{event.title}</h2>
      <p className="text-sm text-muted-foreground">{event.date} · {event.location}</p>
      <Tabs defaultValue="inscritos" className="mt-2">
        <TabsList>
          <TabsTrigger value="inscritos">Inscritos</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          <TabsTrigger value="oleadas">Oleadas</TabsTrigger>
        </TabsList>
        <TabsContent value="inscritos" className="mt-4"><Inscritos tenantId={tenantId} eventId={event.id} /></TabsContent>
        <TabsContent value="checkpoints" className="mt-4"><Checkpoints tenantId={tenantId} eventId={event.id} /></TabsContent>
        <TabsContent value="oleadas" className="mt-4"><Oleadas tenantId={tenantId} eventId={event.id} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Checkpoints({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [rows, setRows] = useState<api.Checkpoint[]>([]);
  const [form, setForm] = useState({ name: "", ord: 1, is_start: false, is_finish: false });
  const load = useCallback(async () => setRows(await api.listCheckpoints(eventId)), [eventId]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    try { await api.createCheckpoint(tenantId, eventId, form); toast.success("Checkpoint agregado"); setForm({ name: "", ord: form.ord + 1, is_start: false, is_finish: false }); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-5">
        <Field label="Nombre"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meta" /></Field>
        <Field label="Orden"><Input type="number" value={form.ord} onChange={(e) => setForm({ ...form, ord: Number(e.target.value) })} /></Field>
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

function Oleadas({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [rows, setRows] = useState<api.Wave[]>([]);
  const [form, setForm] = useState({ wave_number: 1, name: "", scheduled_time: "" });
  const load = useCallback(async () => setRows(await api.listWaves(eventId)), [eventId]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    try { await api.createWave(tenantId, eventId, { wave_number: form.wave_number, name: form.name, scheduled_time: form.scheduled_time || null }); toast.success("Oleada agregada"); setForm({ wave_number: form.wave_number + 1, name: "", scheduled_time: "" }); load(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <Field label="N°"><Input type="number" value={form.wave_number} onChange={(e) => setForm({ ...form, wave_number: Number(e.target.value) })} /></Field>
        <Field label="Nombre"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Oleada 1 - Elite" /></Field>
        <Field label="Hora prevista"><Input type="datetime-local" value={form.scheduled_time} onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })} /></Field>
        <div className="flex items-end"><Button onClick={add}><Plus className="mr-1 size-4" />Agregar</Button></div>
      </CardContent></Card>
      <SimpleTable head={["N°", "Nombre", "Estado"]}>
        {rows.map((w) => (
          <TableRow key={w.id}><TableCell>{w.wave_number}</TableCell><TableCell className="font-medium">{w.name}</TableCell><TableCell>{(w.status ?? "pending").toUpperCase()}</TableCell></TableRow>
        ))}
      </SimpleTable>
    </div>
  );
}

function Inscritos({ tenantId, eventId }: { tenantId: string; eventId: string }) {
  const [rows, setRows] = useState<api.Registration[]>([]);
  const [waves, setWaves] = useState<api.Wave[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [modalidades, setModalidades] = useState<api.EventCategory[]>([]);
  const [form, setForm] = useState({ athlete_name: "", athlete_document: "", athlete_gender: "M", bib_number: "", wave_id: "", ranking_category_id: "" });

  const load = useCallback(async () => {
    const [r, w, c, m] = await Promise.all([
      api.listRegistrations(eventId), api.listWaves(eventId), api.listCategories(), api.listEventCategories(eventId),
    ]);
    setRows(r); setWaves(w); setCats(c); setModalidades(m);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.athlete_name || !form.athlete_document) { toast.error("Nombre y documento son obligatorios"); return; }
    const modalidad = modalidades[0];
    if (!modalidad) { toast.error("Crea una modalidad primero (se crea sola al crear la carrera)"); return; }
    try {
      await api.createRegistration({
        tenant_id: tenantId, event_id: eventId, category_id: modalidad.id,
        athlete_name: form.athlete_name, athlete_document: form.athlete_document,
        athlete_gender: form.athlete_gender as "F" | "M" | "X",
        bib_number: form.bib_number ? Number(form.bib_number) : null,
        wave_id: form.wave_id || null,
        ranking_category_id: form.ranking_category_id || null,
      });
      toast.success("Atleta inscrito");
      setForm({ athlete_name: "", athlete_document: "", athlete_gender: "M", bib_number: "", wave_id: "", ranking_category_id: "" });
      load();
    } catch (e) { toast.error((e as Error).message); }
  }

  const waveName = (id: string | null) => waves.find((w) => w.id === id)?.name ?? "—";
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-4 p-6 sm:grid-cols-6">
        <Field label="Nombre"><Input value={form.athlete_name} onChange={(e) => setForm({ ...form, athlete_name: e.target.value })} /></Field>
        <Field label="Documento"><Input value={form.athlete_document} onChange={(e) => setForm({ ...form, athlete_document: e.target.value })} /></Field>
        <Field label="Sexo">
          <Select value={form.athlete_gender} onValueChange={(v) => setForm({ ...form, athlete_gender: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="M">M</SelectItem><SelectItem value="F">F</SelectItem><SelectItem value="X">X</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Dorsal"><Input type="number" value={form.bib_number} onChange={(e) => setForm({ ...form, bib_number: e.target.value })} /></Field>
        <Field label="Oleada">
          <Select value={form.wave_id} onValueChange={(v) => setForm({ ...form, wave_id: v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{waves.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Categoría">
          <Select value={form.ranking_category_id} onValueChange={(v) => setForm({ ...form, ranking_category_id: v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-6"><Button onClick={add}><Users className="mr-1 size-4" />Inscribir atleta</Button></div>
      </CardContent></Card>

      <SimpleTable head={["Dorsal", "Atleta", "Doc", "Oleada", "Categoría", "Estado"]}>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono">{r.bib_number ?? "—"}</TableCell>
            <TableCell className="font-medium">{r.athlete_name}</TableCell>
            <TableCell className="text-muted-foreground">{r.athlete_document}</TableCell>
            <TableCell>{waveName(r.wave_id)}</TableCell>
            <TableCell>{catName(r.ranking_category_id)}</TableCell>
            <TableCell><Badge variant={r.status === "paid" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sin inscritos aún.</TableCell></TableRow> : null}
      </SimpleTable>
    </div>
  );
}

// ----------------------------- helpers UI ----------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}
function SimpleTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{head.map((h, i) => <TableHead key={i} className={i === head.length - 1 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </CardContent></Card>
  );
}
