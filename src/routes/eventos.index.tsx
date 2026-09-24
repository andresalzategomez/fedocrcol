import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, MapPin, Search, Users } from "lucide-react";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCOP, formatDate } from "@/data/demo";
import { dynamicPrice, fetchEvents, fetchLeagues, fetchPublicRegistrations } from "@/lib/ocr-data";

/** Normaliza para comparar "por semejanza": minúsculas y sin tildes. */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export const Route = createFileRoute("/eventos/")({
  loader: async () => {
    const [events, leagues] = await Promise.all([fetchEvents(), fetchLeagues()]);
    const registrations = await fetchPublicRegistrations(events.map((e) => e.id));
    const countByEvent = new Map<string, number>();
    for (const r of registrations) countByEvent.set(r.event_id, (countByEvent.get(r.event_id) ?? 0) + 1);
    const eventsWithCounts = events.map((e) => ({ ...e, registered: countByEvent.get(e.id) ?? 0 }));
    return { events: eventsWithCounts, leagues };
  },
  head: () => ({
    meta: [
      { title: "Calendario de carreras OCR 2026 — FEDOCR Colombia" },
      {
        name: "description",
        content: "Todas las carreras de obstáculos avaladas por la Federación: fechas, cupos, categorías y tarifas de preventa.",
      },
      { property: "og:title", content: "Calendario de carreras OCR 2026 — FEDOCR Colombia" },
      { property: "og:description", content: "Inscríbete a las carreras de obstáculos oficiales en Colombia." },
    ],
  }),
  component: EventsPage,
});

function EventsPage() {
  const { events: allEvents, leagues } = Route.useLoaderData();
  const [tenant, setTenant] = useState("all");
  const [search, setSearch] = useState("");
  const leagueById = (id: string) => leagues.find((l) => l.id === id);
  const query = normalize(search.trim());
  const events = allEvents.filter((e) => {
    if (tenant !== "all" && e.tenant_id !== tenant) return false;
    if (!query) return true;
    const haystack = normalize(`${e.title} ${e.location} ${leagueById(e.tenant_id)?.department ?? ""}`);
    return haystack.includes(query);
  });

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="surface-grit border-b border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-6 px-4 py-16 sm:px-6">
          <div>
            <h1 className="font-display text-5xl sm:text-6xl">Calendario 2026</h1>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Cupos en tiempo real y tarifa dinámica según la etapa de preventa.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar carrera, ciudad o liga..."
                className="pl-9"
                aria-label="Buscar carreras"
              />
            </div>
            <div className="w-64">
              <Select value={tenant} onValueChange={setTenant}>
                <SelectTrigger aria-label="Filtrar por liga"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las ligas</SelectItem>
                  {leagues.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.department}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-14 sm:px-6">
        {events.length === 0 ? (
          <p className="text-muted-foreground">No encontramos carreras que coincidan con tu búsqueda.</p>
        ) : null}
        {events.map((event) => {
          const league = leagueById(event.tenant_id);
          const cheapest = Math.min(...event.categories.map((c) => dynamicPrice(c.price, event.date).price));
          const totalSlots = event.categories.reduce((sum, c) => sum + c.slots_available, 0);
          const fill = totalSlots > 0 ? Math.round((event.registered / totalSlots) * 100) : 0;
          return (
            <Link key={event.id} to="/eventos/$eventId" params={{ eventId: event.id }} className="block">
              <Card className="border-border/70 transition-colors hover:border-primary">
                <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr_auto] lg:items-center">
                  <div>
                    <Badge variant="outline" className="mb-2">{league?.department}</Badge>
                    <p className="font-display text-3xl leading-tight">{event.title}</p>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5"><CalendarDays className="size-4" />{formatDate(event.date)}</span>
                      <span className="flex items-center gap-1.5"><MapPin className="size-4" />{event.location}</span>
                      <span>{event.distance_km} km · {event.obstacles} obstáculos</span>
                    </div>
                  </div>
                  <div>
                    <p className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-4" /> Cupos</span>
                      <span className="font-medium">{event.registered}/{totalSlots}</span>
                    </p>
                    <Progress value={fill} className="mt-2" />
                    <p className="mt-2 text-xs text-muted-foreground">{event.categories.length} categorías disponibles</p>
                  </div>
                  <div className="lg:text-right">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">Desde</p>
                    <p className="font-display text-3xl text-primary">{formatCOP(cheapest)}</p>
                    <Button className="mt-3 w-full lg:w-auto">Ver</Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      <SiteFooter />
    </div>
  );
}
