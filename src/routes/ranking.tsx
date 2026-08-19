import { createFileRoute } from "@tanstack/react-router";
import { Medal, Trophy } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEMO_LEAGUES, DEMO_RANKING, leagueById } from "@/data/demo";
import { computeLeagueStandings } from "@/lib/ocr-data";

export const Route = createFileRoute("/ranking")({
  head: () => ({
    meta: [
      { title: "Ranking nacional OCR y clasificación al Mundial — FEDOCR" },
      {
        name: "description",
        content: "Ranking individual acumulado y escalafón interligas de la temporada, con badge de clasificados al Mundial de OCR.",
      },
      { property: "og:title", content: "Ranking nacional OCR y clasificación al Mundial — FEDOCR" },
      { property: "og:description", content: "Puntajes acumulados de atletas y departamentos en la temporada OCR." },
    ],
  }),
  component: RankingPage,
});

function RankingPage() {
  const standings = computeLeagueStandings(DEMO_RANKING, DEMO_LEAGUES);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="surface-grit border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h1 className="font-display text-5xl sm:text-6xl">Ranking oficial 2026</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Los cinco mejores puntajes de cada atleta suman al escalafón departamental. Los cinco primeros
            del ranking individual obtienen el badge de clasificado al Mundial de OCR.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <Tabs defaultValue="individual">
          <TabsList>
            <TabsTrigger value="individual">Individual</TabsTrigger>
            <TabsTrigger value="ligas">Interligas</TabsTrigger>
          </TabsList>

          <TabsContent value="individual" className="mt-6">
            <Card className="border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Atleta</TableHead>
                    <TableHead>Liga</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Carreras</TableHead>
                    <TableHead className="text-right">Puntos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DEMO_RANKING.map((row) => (
                    <TableRow key={row.athlete}>
                      <TableCell className="font-display text-xl">{row.position}</TableCell>
                      <TableCell className="font-medium">
                        {row.athlete}
                        {row.qualified ? (
                          <Badge className="ml-2 bg-secondary text-secondary-foreground">
                            <Medal className="mr-1 size-3" /> Mundial
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{leagueById(row.tenant_id)?.department}</TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className="text-right">{row.races}</TableCell>
                      <TableCell className="text-right font-semibold text-primary">{row.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="ligas" className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              {standings.map((row, i) => (
                <Card key={row.league.id} className="border-border/70">
                  <CardContent className="flex items-center gap-4 p-5">
                    <span className="flex size-12 items-center justify-center rounded font-display text-2xl"
                      style={{ backgroundColor: `${row.league.primary_color}22`, color: row.league.primary_color }}>
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <p className="font-display text-2xl leading-tight">{row.league.department}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.athletes} atletas puntuando · {row.qualified} clasificados
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-3xl text-primary">{row.points}</p>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground">pts</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Trophy className="size-4 text-primary" /> El campeón interligas obtiene dos cupos adicionales al Mundial.
            </p>
          </TabsContent>
        </Tabs>
      </div>
      <SiteFooter />
    </div>
  );
}
