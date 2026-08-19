import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEMO_EVENTS, DEMO_LEAGUES, formatCOP, formatDate, leagueById } from "@/data/demo";
import { dynamicPrice } from "@/lib/ocr-data";

export const Route = createFileRoute("/eventos/")({
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
  const [tenant, setTenant] = useState("all");
  const events = DEMO_EVENTS.filter((e) => tenant === "all" || e.tenant_id === tenant);

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
          <div className="w-64">
            <Select value={tenant} onValueChange={setTenant}>
              <SelectTrigger aria-label="Filtrar por liga"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las ligas</SelectItem>
                {DEMO_LEAGUES.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.department}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-14 sm:px-6">
        {events.map((event) => {
          const league = leagueById(event.tenant_id);
          const cheapest = Math.min(...event.categories.map((c) => dynamicPrice(c.price, event.date).price));
          const fill = Math.round((event.registered / event.max_capacity) * 100);
          return (
            <Card key={event.id} className="border-border/70">
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
                    <span className="font-medium">{event.registered}/{event.max_capacity}</span>
                  </p>
                  <Progress value={fill} className="mt-2" />
                  <p className="mt-2 text-xs text-muted-foreground">{event.categories.length} categorías disponibles</p>
                </div>
                <div className="lg:text-right">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Desde</p>
                  <p className="font-display text-3xl text-primary">{formatCOP(cheapest)}</p>
                  <Button asChild className="mt-3 w-full lg:w-auto">
                    <Link to="/eventos/$eventId" params={{ eventId: event.id }}>Inscribirme</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <SiteFooter />
    </div>
  );
}
