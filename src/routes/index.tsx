import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Flame, MapPin, ShieldCheck, Trophy, Users } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DEMO_EVENTS, DEMO_LEAGUES, formatDate, leagueById } from "@/data/demo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FEDOCR Colombia — Federación de Carreras de Obstáculos" },
      {
        name: "description",
        content:
          "Plataforma oficial de las ligas departamentales de OCR en Colombia: inscripciones a carreras, ranking nacional y clasificación al Mundial.",
      },
      { property: "og:title", content: "FEDOCR Colombia — Federación de Carreras de Obstáculos" },
      {
        property: "og:description",
        content: "Ligas departamentales, inscripciones pagas, ranking nacional y camino al Mundial de OCR.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const upcoming = DEMO_EVENTS.slice(0, 3);
  const active = DEMO_LEAGUES.filter((l) => l.status === "active");

  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* Banner promocional — OCR LATAM Colombia 2027 */}
      <section className="border-b border-border" style={{ background: "linear-gradient(120deg,#0a1732 0%,#102a5c 55%,#0a1732 100%)" }}>
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 py-10 sm:px-6 md:flex-row md:py-12">
          <img
            src="/ocr-latam-colombia-2027.jpg"
            alt="OCR LATAM Colombia 2027 — Campeonato Sudamericano de Carreras de Obstáculos"
            width={240}
            height={240}
            loading="eager"
            className="w-40 shrink-0 rounded-2xl shadow-2xl ring-1 ring-white/10 sm:w-52"
          />
          <div className="text-center md:text-left">
            <span className="inline-block rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-300">
              Evento continental · 2027
            </span>
            <h2 className="mt-3 font-display text-4xl leading-tight text-white sm:text-5xl">
              OCR LATAM Colombia <span className="text-amber-400">2027</span>
            </h2>
            <p className="mt-3 max-w-xl text-base text-white/70">
              El Campeonato Sudamericano de Carreras de Obstáculos llega a Colombia.
              Sé parte del evento de OCR más grande de la región.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
              <Button asChild size="lg" className="bg-amber-400 text-slate-900 hover:bg-amber-300">
                <Link to="/eventos">Quiero participar <ArrowRight className="ml-2 size-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link to="/eventos">Más información</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-grit border-b border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-28">
          <div>
            <Badge className="mb-5 bg-secondary text-secondary-foreground">Temporada 2026 · Camino al Mundial</Badge>
            <h1 className="font-display text-6xl leading-[0.95] sm:text-7xl lg:text-8xl">
              UNA FEDERACIÓN.
              <br />
              <span className="text-gradient-brand">TODAS LAS LIGAS.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Inscríbete a carreras de obstáculos en cualquier departamento, acumula puntos en el ranking
              nacional y clasifica al Mundial de OCR. Cada liga con su identidad, todas bajo un mismo sistema.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/eventos">
                  Ver calendario <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/ligas">Explorar ligas</Link>
              </Button>
            </div>
            <div className="mt-10 grid max-w-lg grid-cols-3 gap-6">
              {[
                { value: "32", label: "Departamentos" },
                { value: "1.8K", label: "Atletas activos" },
                { value: "24", label: "Carreras al año" },
              ].map((s) => (
                <div key={s.label}>
                  <p className="font-display text-4xl text-primary">{s.value}</p>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 self-center">
            {[
              { icon: ShieldCheck, title: "Ligas verificadas", text: "Cada liga departamental opera como tenant independiente con datos aislados." },
              { icon: Flame, title: "Inscripción con pago", text: "Tarifas por preventa, cupos en tiempo real y comprobante QR al confirmar." },
              { icon: Trophy, title: "Ranking oficial", text: "Puntaje individual acumulado e escalafón interligas por departamento." },
            ].map((f) => (
              <Card key={f.title} className="border-border/70 bg-card/80">
                <CardContent className="flex gap-4 p-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded bg-primary/15 text-primary">
                    <f.icon className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">{f.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-4xl">Ligas departamentales</h2>
            <p className="mt-2 text-muted-foreground">Elige tu sede: cada liga tiene su marca, sus carreras y su comunidad.</p>
          </div>
          <Button asChild variant="ghost">
            <Link to="/ligas">Ver todas <ArrowRight className="ml-2 size-4" /></Link>
          </Button>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {active.slice(0, 6).map((league) => (
            <Link key={league.id} to="/ligas/$slug" params={{ slug: league.slug }}>
              <Card className="h-full overflow-hidden border-border/70 transition-colors hover:border-primary">
                <div className="h-2 w-full" style={{ background: `linear-gradient(90deg, ${league.primary_color}, ${league.secondary_color})` }} />
                <CardContent className="p-5">
                  <p className="font-display text-2xl">{league.department}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="size-3.5" /> {league.city}
                  </p>
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{league.description}</p>
                  <p className="mt-4 flex items-center gap-1.5 text-sm font-medium">
                    <Users className="size-4 text-primary" /> {league.athletes} atletas
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <h2 className="font-display text-4xl">Próximas carreras</h2>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {upcoming.map((event) => {
              const league = leagueById(event.tenant_id);
              return (
                <Card key={event.id} className="border-border/70">
                  <CardContent className="p-6">
                    <Badge variant="outline" className="mb-3">{league?.department}</Badge>
                    <p className="font-display text-3xl leading-tight">{event.title}</p>
                    <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="size-4" /> {formatDate(event.date)}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="size-4" /> {event.location}
                    </p>
                    <p className="mt-4 text-sm">
                      {event.distance_km} km · {event.obstacles} obstáculos
                    </p>
                    <Button asChild className="mt-5 w-full">
                      <Link to="/eventos/$eventId" params={{ eventId: event.id }}>Inscribirme</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
