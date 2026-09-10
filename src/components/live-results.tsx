import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { listResults, listEventCategories, type EventResult, type EventCategory } from "@/lib/admin-api";
import { RESULT_STATUS_LABEL, formatDuration, rankResults } from "@/lib/results";

/**
 * Resultados en vivo para una carrera pública (events.visibility='public').
 * Solo lectura: misma fuente (tabla `results`, pública para select) y el
 * mismo patrón de Realtime que el panel admin, sin nada editable.
 */
export function LiveResults({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<EventResult[]>([]);
  const [cats, setCats] = useState<EventCategory[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([listResults(eventId), listEventCategories(eventId)]);
      setRows(r);
      setCats(c);
    } catch {
      // Página pública: si falla, simplemente no se muestra la sección.
    } finally {
      setLoaded(true);
    }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`public-results-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "results", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [eventId, load]);

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const ranked = rankResults(rows);

  if (loaded && ranked.length === 0) return null;

  return (
    <Card className="border-border/70">
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Trophy className="size-5 text-primary" />
          <h2 className="font-display text-3xl">Resultados en vivo</h2>
          <span className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-success" />En vivo
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pos.</TableHead>
                <TableHead>Dorsal</TableHead>
                <TableHead>Atleta</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Tiempo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.rank ?? "—"}</TableCell>
                  <TableCell>{r.bib_number ?? "—"}</TableCell>
                  <TableCell>{r.athlete_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{catName(r.category_id)}</TableCell>
                  <TableCell>{formatDuration(r.duration_ms)}</TableCell>
                  <TableCell><Badge variant={RESULT_STATUS_LABEL[r.status].variant}>{RESULT_STATUS_LABEL[r.status].label}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
