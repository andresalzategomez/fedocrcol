import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { RESULT_STATUS_LABEL, formatDuration } from "@/lib/results";
import { TrackLiveResults } from "@/components/track-live-results";
import type { PublicTrackPayload } from "@/lib/server/track/public-track";

interface Entry {
  bib: string | null; name: string | null; gender: string | null; category_id: string | null; wave_id: string | null;
  duration_ms: number | null; status: string; rank_overall: number | null; rank_category: number | null; rank_wave: number | null;
}
interface Payload {
  format?: "standard";
  event: { title: string; date: string; location: string; league: string | null; status: "upcoming" | "in_progress" | "finished"; status_label: string };
  categories: { id: string; name: string }[];
  waves: { id: string; name: string }[];
  entries: Entry[];
}

export const Route = createFileRoute("/resultados/$token")({
  head: () => ({
    meta: [
      { title: "Resultados de la carrera — FEDOCR" },
      // Enlace para compartir con interesados: no se indexa en buscadores.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResultadosPage,
});

const STATUS_VARIANT: Record<Payload["event"]["status"], "default" | "secondary" | "outline"> = {
  upcoming: "outline", in_progress: "default", finished: "secondary",
};

function ResultadosPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<Payload | PublicTrackPayload | null>(null);
  const [category, setCategory] = useState("all");
  const [wave, setWave] = useState("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/results/${encodeURIComponent(token)}`, { cache: "no-store" });
      // Código inexistente, carrera privada, aún sin aprobar o día de la carrera ya pasado: al inicio de fedocr.
      if (res.status === 404) { window.location.replace("/"); return; }
      if (res.ok) setData((await res.json()) as Payload | PublicTrackPayload);
    } catch { /* sin red: se mantiene lo último que se vio */ }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  // En vivo: se vuelve a consultar cada 10 segundos mientras la página esté abierta.
  useEffect(() => {
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="mx-auto max-w-5xl px-4 py-16 text-center text-muted-foreground">Cargando resultados…</div>
      </div>
    );
  }

  // Carrera tipo TRACK: vista informativa por instancia y oleada.
  if (data.format === "track") return <TrackLiveResults data={data} />;

  const { event } = data;
  const catName = (id: string | null) => data.categories.find((c) => c.id === id)?.name ?? "—";
  const waveName = (id: string | null) => data.waves.find((w) => w.id === id)?.name ?? "—";
  const shown = data.entries.filter((e) => (category === "all" || e.category_id === category) && (wave === "all" || e.wave_id === wave));
  // La posición mostrada depende del filtro: por oleada, por categoría o general.
  const rankOf = (e: Entry) => (wave !== "all" ? e.rank_wave : category !== "all" ? e.rank_category : e.rank_overall);
  const ordered = [...shown].sort((a, b) =>
    (rankOf(a) ?? Number.MAX_SAFE_INTEGER) - (rankOf(b) ?? Number.MAX_SAFE_INTEGER) || (a.bib ?? "").localeCompare(b.bib ?? ""));
  const dateLabel = new Date(`${event.date}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="surface-grit border-b border-border">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={STATUS_VARIANT[event.status]}>{event.status_label}</Badge>
            {event.status === "in_progress" ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-success" />En vivo</span>
            ) : null}
          </div>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">{event.title}</h1>
          <p className="mt-2 text-muted-foreground">{dateLabel} · {event.location}{event.league ? ` · ${/^liga(?:\s|$)/i.test(event.league) ? event.league : `Liga ${event.league}`}` : ""}</p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {event.status === "upcoming" ? (
          <Card><CardContent className="p-8 text-center">
            <Trophy className="mx-auto size-8 text-primary" />
            <h2 className="mt-3 font-display text-2xl">La carrera aún no empieza</h2>
            <p className="mt-1 text-sm text-muted-foreground">Aquí aparecerán los resultados en vivo cuando comience. Esta página se actualiza sola.</p>
          </CardContent></Card>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Categoría" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {data.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={wave} onValueChange={setWave}>
                <SelectTrigger><SelectValue placeholder="Oleada" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las oleadas</SelectItem>
                  {data.waves.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <SimpleTable head={["Pos.", "Dorsal", "Atleta", "Categoría", "Oleada", "Tiempo", "Estado"]}>
              {ordered.map((e, i) => (
                <TableRow key={`${e.bib}-${i}`}>
                  <TableCell className="font-medium">{rankOf(e) ?? "—"}</TableCell>
                  <TableCell>{e.bib ?? "—"}</TableCell>
                  <TableCell>{e.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{catName(e.category_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{waveName(e.wave_id)}</TableCell>
                  <TableCell>{formatDuration(e.duration_ms)}</TableCell>
                  <TableCell>
                    {RESULT_STATUS_LABEL[e.status as keyof typeof RESULT_STATUS_LABEL]
                      ? <Badge variant={RESULT_STATUS_LABEL[e.status as keyof typeof RESULT_STATUS_LABEL].variant}>{RESULT_STATUS_LABEL[e.status as keyof typeof RESULT_STATUS_LABEL].label}</Badge>
                      : e.status}
                  </TableCell>
                </TableRow>
              ))}
              {ordered.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Aún no hay resultados para mostrar.</TableCell></TableRow> : null}
            </SimpleTable>
            <p className="mt-3 text-xs text-muted-foreground">Esta página se actualiza sola cada 10 segundos y estará disponible hasta el final del día de la carrera.</p>
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
