import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { listTenants, listClubsForTenant, type Tenant, type PublicClub } from "@/lib/admin-api";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Ingresar o registrarte — FEDOCR Colombia" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const INDEPENDIENTE = "__independiente__";

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    listTenants().then(setTenants).catch(() => setTenants([]));
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) { toast.info("Configura Supabase para habilitar el login real."); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Bienvenido de vuelta");
    navigate({ to: "/panel" });
  }

  const activeTenants = tenants.filter((l) => l.status === "active");

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto grid max-w-md gap-6 px-4 py-16">
        <div>
          <h1 className="font-display text-4xl">Acceso a la plataforma</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Atletas, clubes, ligas y administración nacional usan la misma cuenta; los permisos se
            resuelven con RLS en Supabase.
          </p>
        </div>

        {!isSupabaseConfigured ? (
          <div className="flex gap-3 rounded border border-warning/40 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>Modo demo: aún no hay credenciales de Supabase.</p>
          </div>
        ) : null}

        <Card className="border-border/70">
          <CardContent className="p-6">
            <Tabs defaultValue="login">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">Ingresar</TabsTrigger>
                <TabsTrigger value="signup" className="flex-1">Registrarme</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-5">
                <form onSubmit={signIn} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Correo</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={loading}>{loading ? "Ingresando..." : "Ingresar"}</Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-5">
                <Tabs defaultValue="athlete">
                  <TabsList className="w-full">
                    <TabsTrigger value="athlete" className="flex-1">Atleta</TabsTrigger>
                    <TabsTrigger value="club" className="flex-1">Club</TabsTrigger>
                    <TabsTrigger value="league" className="flex-1">Liga</TabsTrigger>
                  </TabsList>
                  <TabsContent value="athlete" className="mt-5"><AthleteSignupForm tenants={activeTenants} /></TabsContent>
                  <TabsContent value="club" className="mt-5"><ClubSignupForm tenants={activeTenants} /></TabsContent>
                  <TabsContent value="league" className="mt-5"><LeagueSignupForm /></TabsContent>
                </Tabs>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}

function AthleteSignupForm({ tenants }: { tenants: Tenant[] }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tenant, setTenant] = useState("");
  const [club, setClub] = useState(INDEPENDIENTE);
  const [clubs, setClubs] = useState<PublicClub[]>([]);

  useEffect(() => {
    setClub(INDEPENDIENTE);
    if (!tenant) { setClubs([]); return; }
    listClubsForTenant(tenant).then(setClubs).catch(() => setClubs([]));
  }, [tenant]);

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) { toast.error("Selecciona tu liga"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/public/register-athlete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email, password, full_name: fullName, tenant_id: tenant,
          club_id: club === INDEPENDIENTE ? undefined : club,
        }),
      });
      const body = await res.json().catch(() => ({}) as { error?: { message?: string } });
      if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "No se pudo crear la cuenta");
      setDone(true);
    } catch (err) { toast.error((err as Error).message); } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>Cuenta creada. Ya puedes iniciar sesión.</p>
      </div>
    );
  }

  return (
    <form onSubmit={signUp} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="a-name">Nombre completo</Label>
        <Input id="a-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="a-email">Correo</Label>
        <Input id="a-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="a-pass">Contraseña</Label>
        <Input id="a-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>Liga departamental</Label>
        <Select value={tenant} onValueChange={setTenant}>
          <SelectTrigger><SelectValue placeholder="Selecciona tu liga" /></SelectTrigger>
          <SelectContent>{tenants.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {tenant ? (
        <div className="grid gap-2">
          <Label>Club (opcional)</Label>
          <Select value={club} onValueChange={setClub}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={INDEPENDIENTE}>Independiente</SelectItem>
              {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <Button type="submit" disabled={loading}>{loading ? "Creando..." : "Crear cuenta de atleta"}</Button>
    </form>
  );
}

function ClubSignupForm({ tenants }: { tenants: Tenant[] }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<"league" | "federation" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [clubName, setClubName] = useState("");
  const [tenant, setTenant] = useState(INDEPENDIENTE);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/public/register-club", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email, password, full_name: fullName, club_name: clubName,
          tenant_id: tenant === INDEPENDIENTE ? undefined : tenant,
        }),
      });
      const body = await res.json().catch(() => ({}) as { error?: { message?: string }; pending_approval_by?: "league" | "federation" });
      if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "No se pudo registrar el club");
      setDone((body as { pending_approval_by?: "league" | "federation" }).pending_approval_by ?? "federation");
    } catch (err) { toast.error((err as Error).message); } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          Tu club quedó registrado. Ya puedes iniciar sesión, pero está{" "}
          <strong>pendiente de aprobación</strong>{" "}
          {done === "league" ? "de la liga que elegiste" : "de la federación"} antes de poder operar.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="c-name">Nombre completo (contacto)</Label>
        <Input id="c-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="c-email">Correo</Label>
        <Input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="c-pass">Contraseña</Label>
        <Input id="c-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="c-club">Nombre del club</Label>
        <Input id="c-club" required value={clubName} onChange={(e) => setClubName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>Liga (opcional)</Label>
        <Select value={tenant} onValueChange={setTenant}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={INDEPENDIENTE}>Ninguna — club independiente</SelectItem>
            {tenants.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Si eliges una liga, ella debe aprobar tu club. Si no, la federación decide.
        </p>
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Registrando..." : "Registrar club"}</Button>
    </form>
  );
}

function LeagueSignupForm() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [department, setDepartment] = useState("");
  const [city, setCity] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/public/register-league", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName, league_name: leagueName, department, city: city || undefined }),
      });
      const body = await res.json().catch(() => ({}) as { error?: { message?: string } });
      if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "No se pudo registrar la liga");
      setDone(true);
    } catch (err) { toast.error((err as Error).message); } finally { setLoading(false); }
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>Tu liga quedó registrada. Ya puedes iniciar sesión, pero está <strong>pendiente de aprobación</strong> de la federación.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="l-name">Nombre completo (admin de la liga)</Label>
        <Input id="l-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-email">Correo</Label>
        <Input id="l-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-pass">Contraseña</Label>
        <Input id="l-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-league">Nombre de la liga</Label>
        <Input id="l-league" required value={leagueName} onChange={(e) => setLeagueName(e.target.value)} placeholder="Liga de Antioquia" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-dept">Departamento</Label>
        <Input id="l-dept" required value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Antioquia" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-city">Ciudad (opcional)</Label>
        <Input id="l-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Medellín" />
      </div>
      <Button type="submit" disabled={loading}>{loading ? "Registrando..." : "Registrar liga"}</Button>
    </form>
  );
}
