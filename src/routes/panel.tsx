import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  CreditCard,
  LayoutDashboard,
  Palette,
  Users,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEMO_EVENTS, DEMO_LEAGUES, DEMO_RANKING, formatCOP, formatDate, leagueById } from "@/data/demo";
import { applyTenantTheme } from "@/lib/tenant-theme";
import { dynamicPrice, qrUrl } from "@/lib/ocr-data";

type Role = "superadmin" | "admin" | "athlete";

export const Route = createFileRoute("/panel")({
  head: () => ({
    meta: [
      { title: "Panel de administración — FEDOCR Colombia" },
      { name: "description", content: "Panel multi-tenant para la administración nacional, los administradores de liga y los atletas de OCR." },
      { property: "og:title", content: "Panel de administración — FEDOCR Colombia" },
      { property: "og:description", content: "Gestiona ligas, carreras, inscripciones y pagos de la Federación de OCR." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PanelPage,
});

const ROLES: { id: Role; label: string; icon: typeof Users }[] = [
  { id: "superadmin", label: "Super Admin", icon: LayoutDashboard },
  { id: "admin", label: "Admin de Liga", icon: Building2 },
  { id: "athlete", label: "Atleta", icon: Users },
];

function PanelPage() {
  const [role, setRole] = useState<Role>("superadmin");

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit rounded-lg border border-border bg-sidebar p-4">
          <p className="px-2 text-xs uppercase tracking-widest text-muted-foreground">Vista de rol</p>
          <nav className="mt-3 grid gap-1">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                className={`flex items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                  role === r.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                <r.icon className="size-4" /> {r.label}
              </button>
            ))}
          </nav>
          <p className="mt-4 px-2 text-xs text-muted-foreground">
            En producción el rol se lee de <code>profiles.role</code> y las políticas RLS limitan cada consulta al
            <code> tenant_id</code>.
          </p>
        </aside>

        <main>
          {role === "superadmin" ? <SuperAdmin /> : null}
          {role === "admin" ? <LeagueAdmin /> : null}
          {role === "athlete" ? <AthletePanel /> : null}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-4xl text-primary">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function SuperAdmin() {
  const [commission, setCommission] = useState(8);
  const gross = DEMO_EVENTS.reduce(
    (sum, e) => sum + e.registered * dynamicPrice(e.categories[0]!.price, e.date).price,
    0,
  );

  return (
    <div className="grid gap-6">
      <h1 className="font-display text-4xl">Administración nacional</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ligas activas" value={String(DEMO_LEAGUES.filter((l) => l.status === "active").length)} hint={`${DEMO_LEAGUES.length} registradas`} />
        <Stat label="Ingresos brutos" value={formatCOP(gross)} hint="Temporada 2026" />
        <Stat label="Comisión federación" value={formatCOP(Math.round(gross * (commission / 100)))} hint={`${commission}% configurado`} />
      </div>

      <Card className="border-border/70">
        <CardContent className="p-6">
          <h2 className="font-display text-2xl">Comisión por inscripción</h2>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div className="grid gap-2">
              <Label htmlFor="commission">Porcentaje (%)</Label>
              <Input
                id="commission"
                type="number"
                min={0}
                max={30}
                value={commission}
                onChange={(e) => setCommission(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <Button onClick={() => toast.success("Comisión actualizada")}>Guardar</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardContent className="p-0">
          <div className="p-6 pb-0">
            <h2 className="font-display text-2xl">Ligas (tenants)</h2>
          </div>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Liga</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead className="text-right">Atletas</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_LEAGUES.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-muted-foreground">{l.city}</TableCell>
                  <TableCell className="text-right">{l.athletes}</TableCell>
                  <TableCell>
                    <Badge variant={l.status === "active" ? "default" : "destructive"}>
                      {l.status === "active" ? "Habilitada" : "Suspendida"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      defaultChecked={l.status === "active"}
                      aria-label={`Habilitar ${l.name}`}
                      onCheckedChange={(v) => toast.success(`${l.name}: ${v ? "habilitada" : "suspendida"}`)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function LeagueAdmin() {
  const league = DEMO_LEAGUES[0]!;
  const [primary, setPrimary] = useState(league.primary_color);
  const [secondary, setSecondary] = useState(league.secondary_color);
  const events = DEMO_EVENTS.filter((e) => e.tenant_id === league.id);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-4xl">{league.name}</h1>
        <p className="text-sm text-muted-foreground">Solo ves datos de tu liga: RLS filtra por tenant_id.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Carreras" value={String(events.length)} />
        <Stat label="Inscritos" value={String(events.reduce((s, e) => s + e.registered, 0))} />
        <Stat label="Atletas" value={String(league.athletes)} />
      </div>

      <Card className="border-border/70">
        <CardContent className="p-6">
          <h2 className="flex items-center gap-2 font-display text-2xl"><Palette className="size-5 text-primary" /> Identidad visual (white-label)</h2>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div className="grid gap-2">
              <Label htmlFor="p">Color primario</Label>
              <Input id="p" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-10 w-24 p-1" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="s">Color secundario</Label>
              <Input id="s" type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-10 w-24 p-1" />
            </div>
            <Button
              onClick={() => {
                applyTenantTheme({ primary_color: primary, secondary_color: secondary });
                toast.success("Tema aplicado a la liga");
              }}
            >
              Aplicar tema
            </Button>
            <Button variant="outline" onClick={() => applyTenantTheme(null)}>Restablecer</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardContent className="p-0">
          <div className="p-6 pb-0">
            <h2 className="flex items-center gap-2 font-display text-2xl"><CreditCard className="size-5 text-primary" /> Inscripciones y pagos</h2>
          </div>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Carrera</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Cupos</TableHead>
                <TableHead className="text-right">Recaudo estimado</TableHead>
                <TableHead className="text-right">Validar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(e.date)}</TableCell>
                  <TableCell className="text-right">{e.registered}/{e.max_capacity}</TableCell>
                  <TableCell className="text-right text-primary">
                    {formatCOP(e.registered * dynamicPrice(e.categories[0]!.price, e.date).price)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => toast.success("Pagos conciliados")}>
                      <BadgeCheck className="mr-1 size-4" /> Conciliar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AthletePanel() {
  const me = DEMO_RANKING[0]!;
  const league = leagueById(me.tenant_id);
  const next = DEMO_EVENTS.find((e) => e.tenant_id === me.tenant_id);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-4xl">{me.athlete}</h1>
        <p className="text-sm text-muted-foreground">{league?.name} · {me.category}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Puntos" value={String(me.points)} hint={`${me.races} carreras`} />
        <Stat label="Posición nacional" value={`#${me.position}`} />
        <Stat label="Estado mundial" value={me.qualified ? "Clasificado" : "En camino"} />
      </div>

      {next ? (
        <Card className="border-border/70">
          <CardContent className="grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Próxima inscripción confirmada</p>
              <p className="mt-1 font-display text-3xl">{next.title}</p>
              <p className="text-sm text-muted-foreground">{formatDate(next.date)} · {next.location}</p>
              <Badge className="mt-3 bg-success text-success-foreground">Pagado</Badge>
            </div>
            <img
              src={qrUrl(`OCR-${next.id}-TICKET-${me.athlete}`)}
              alt="Código QR del ticket de la carrera"
              width={160}
              height={160}
              loading="lazy"
              className="rounded bg-white p-2"
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
