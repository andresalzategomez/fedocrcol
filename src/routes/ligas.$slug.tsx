import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { CalendarDays, MapPin, Trophy, Users } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEMO_EVENTS, DEMO_RANKING, formatDate, leagueBySlug } from "@/data/demo";
import { useTenantTheme } from "@/lib/tenant-theme";

export const Route = createFileRoute("/ligas/$slug")({
  loader: ({ params }) => {
    const league = leagueBySlug(params.slug);
    if (!league) throw notFound();
    return { league };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Liga no encontrada — FEDOCR" }, { name: "robots", content: "noindex" }] };
    }
    const { league } = loaderData;
    return {
      meta: [
        { title: `${league.name} — FEDOCR Colombia` },
        { name: "description", content: league.description },
        { property: "og:title", content: `${league.name} — FEDOCR Colombia` },
        { property: "og:description", content: league.description },
      ],
    };
  },
  errorComponent: () => <p className="p-10 text-center">No pudimos cargar esta liga.</p>,
  notFoundComponent: () => <p className="p-10 text-center">Liga no encontrada.</p>,
  component: LeaguePage,
});

function LeaguePage() {
  const { league } = Route.useLoaderData();
  useTenantTheme({ primary_color: league.primary_color, secondary_color: league.secondary_color });

  const events = DEMO_EVENTS.filter((e) => e.tenant_id === league.id);
  const ranking = DEMO_RANKING.filter((r) => r.tenant_id === league.id);

  return (
    <div className="min-h-screen">
      <SiteHeader activeLeagueSlug={league.slug} />

      <section
        className="border-b border-border"
        style={{
          backgroundImage: `linear-gradient(120deg, ${league.primary_color}33, ${league.secondary_color}22)`,
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <Badge variant={league.status === "active" ? "default" : "destructive"}>
            {league.status === "active" ? "Liga habilitada" : "Liga suspendida"}
          </Badge>
          <h1 className="mt-4 font-display text-5xl sm:text-6xl">{league.name}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{league.description}</p>
          <div className="mt-6 flex flex-wrap gap-6 text-sm">
            <span className="flex items-center gap-2"><MapPin className="size-4 text-primary" /> {league.city}</span>
            <span className="flex items-center gap-2"><Users className="size-4 text-primary" /> {league.athletes} atletas</span>
            <span className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" /> {events.length} carreras</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h2 className="font-display text-4xl">Carreras de la liga</h2>
        {events.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Esta liga aún no tiene carreras publicadas.</p>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Card key={event.id} className="border-border/70">
                <CardContent className="p-6">
                  <p className="font-display text-3xl leading-tight">{event.title}</p>
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="size-4" /> {formatDate(event.date)}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="size-4" /> {event.location}
                  </p>
                  <p className="mt-3 text-sm">{event.distance_km} km · {event.obstacles} obstáculos</p>
                  <Button asChild className="mt-5 w-full">
                    <Link to="/eventos/$eventId" params={{ eventId: event.id }}>Inscribirme</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="flex items-center gap-3 font-display text-4xl">
            <Trophy className="size-7 text-primary" /> Ranking de la liga
          </h2>
          <Card className="mt-6 border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Atleta</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Carreras</TableHead>
                  <TableHead className="text-right">Puntos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.map((row, i) => (
                  <TableRow key={row.athlete}>
                    <TableCell className="font-display text-xl">{i + 1}</TableCell>
                    <TableCell className="font-medium">
                      {row.athlete}
                      {row.qualified ? (
                        <Badge className="ml-2 bg-secondary text-secondary-foreground">Mundial</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.category}</TableCell>
                    <TableCell className="text-right">{row.races}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">{row.points}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
