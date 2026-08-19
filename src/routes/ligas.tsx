import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, Users } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DEMO_LEAGUES } from "@/data/demo";

export const Route = createFileRoute("/ligas")({
  head: () => ({
    meta: [
      { title: "Ligas departamentales de OCR — FEDOCR Colombia" },
      {
        name: "description",
        content: "Directorio de las ligas departamentales afiliadas: sedes, atletas registrados y estado de habilitación.",
      },
      { property: "og:title", content: "Ligas departamentales de OCR — FEDOCR Colombia" },
      { property: "og:description", content: "Encuentra tu liga departamental de carreras de obstáculos en Colombia." },
    ],
  }),
  component: LeaguesPage,
});

function LeaguesPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="surface-grit border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h1 className="font-display text-5xl sm:text-6xl">Ligas departamentales</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Cada liga administra sus propias carreras, precios e identidad visual, con datos aislados por
            tenant y validados por la Federación.
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {DEMO_LEAGUES.map((league) => (
          <Link key={league.id} to="/ligas/$slug" params={{ slug: league.slug }}>
            <Card className="h-full overflow-hidden border-border/70 transition-colors hover:border-primary">
              <div
                className="h-24"
                style={{ background: `linear-gradient(120deg, ${league.primary_color}, ${league.secondary_color})` }}
              />
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-2xl leading-tight">{league.name}</p>
                  <Badge variant={league.status === "active" ? "default" : "destructive"}>
                    {league.status === "active" ? "Habilitada" : "Suspendida"}
                  </Badge>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="size-3.5" /> {league.city}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">{league.description}</p>
                <p className="mt-4 flex items-center gap-1.5 text-sm font-medium">
                  <Users className="size-4 text-primary" /> {league.athletes} atletas
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <SiteFooter />
    </div>
  );
}
