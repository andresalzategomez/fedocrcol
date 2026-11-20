import { useCallback, useEffect, useRef, useState } from "react";
import { Medal, Trophy } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatElapsed } from "@/lib/track-engine/core/time";
import type { PublicRunCell, PublicTrackEntry, PublicTrackHeat, PublicTrackLane, PublicTrackPayload } from "@/lib/server/track/public-track";

type Category = PublicTrackPayload["categories"][number];

const STAGE_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pending: { label: "Por iniciar", variant: "outline" },
  open: { label: "En curso", variant: "default" },
  closed: { label: "Cerrada", variant: "secondary" },
};
const HEAT_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Pendiente", variant: "outline" },
  started: { label: "En pista", variant: "default" },
  awaiting_confirmation: { label: "Por confirmar", variant: "default" },
  confirmed: { label: "Confirmada", variant: "secondary" },
  voided: { label: "Anulada por lluvia", variant: "destructive" },
};
const ENTRY_STATE: Record<PublicTrackEntry["state"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" } | null> = {
  active: null,
  qualified: { label: "Clasificó", variant: "default" },
  eliminated: { label: "Eliminado", variant: "outline" },
  withdrawn: { label: "Retirado", variant: "destructive" },
};
const STATUS_VARIANT: Record<PublicTrackPayload["event"]["status"], "default" | "secondary" | "outline"> = { upcoming: "outline", in_progress: "default", finished: "secondary" };

function RunCell({ run }: { run: PublicRunCell }) {
  switch (run.kind) {
    case "time": return <>{formatElapsed(run.ms)}</>;
    case "voided": return <span className="text-muted-foreground" title="Anulado por protocolo de lluvia"><s>{run.ms != null ? formatElapsed(run.ms) : "—"}</s> <span className="text-xs">anulado</span></span>;
    case "did_not_run": return <span className="text-muted-foreground">No corre</span>;
    case "did_not_finish": return <span className="text-muted-foreground">No terminó</span>;
    case "withdrawn": return <span className="text-muted-foreground">Retirado</span>;
    default: return <span className="text-muted-foreground">—</span>;
  }
}

function LaneText({ lane }: { lane: PublicTrackLane }) {
  const t = lane.outcome === "time" && lane.elapsed_ms != null ? formatElapsed(lane.elapsed_ms)
    : lane.outcome === "voided" ? (lane.elapsed_ms != null ? `anulado (${formatElapsed(lane.elapsed_ms)})` : "anulado")
    : lane.outcome === "did_not_run" ? "no corre"
    : lane.outcome === "did_not_finish" ? "no terminó"
    : lane.outcome === "withdrawn" ? "retirado" : null;
  return (
    <span>
      <span className="font-medium">{lane.bib ?? "—"}</span> {lane.name ?? ""}
      {t ? <span className="ml-1 text-muted-foreground">· {t}</span> : null}
    </span>
  );
}

function HeatRow({ heat }: { heat: PublicTrackHeat }) {
  const st = HEAT_LABEL[heat.status] ?? { label: heat.status, variant: "outline" as const };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">
          {heat.kind === "tiebreak" ? "Desempate" : `Salida ${heat.run_number}`} · Oleada {heat.heat_number}
        </div>
        <div className="flex flex-col sm:flex-row sm:gap-4">
          {heat.lanes.map((l, i) => <LaneText key={i} lane={l} />)}
        </div>
      </div>
      <Badge variant={st.variant}>{st.label}</Badge>
    </div>
  );
}

/** Campeón y subcampeón de una categoría: solo cuando su Final (la instancia que no clasifica a nadie) ya está cerrada. */
function championOf(cat: Category): { champion: PublicTrackEntry; runnerUp: PublicTrackEntry | null } | null {
  const fin = [...cat.stages].reverse().find((s) => s.qualifiers_count == null && s.status === "closed");
  if (!fin) return null;
  const ranked = fin.entries.filter((e) => e.position != null && e.state !== "withdrawn").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const champion = ranked.find((e) => e.position === 1);
  if (!champion) return null;
  return { champion, runnerUp: ranked.find((e) => e.position === 2) ?? null };
}

/** Confeti ligero en un canvas (sin dependencias). Dura unos segundos y se limpia solo. */
function Confetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    const colors = ["#fbbf24", "#f59e0b", "#fde68a", "#ffffff", "#f97316", "#a3e635"];
    const pieces = Array.from({ length: 170 }, () => ({
      x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.6,
      w: 6 + Math.random() * 7, h: 8 + Math.random() * 10, vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI, vr: -0.15 + Math.random() * 0.3, color: colors[Math.floor(Math.random() * colors.length)]!,
    }));
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - started;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = t > 4000 ? Math.max(0, 1 - (t - 4000) / 1200) : 1; // se desvanece al final
      for (const p of pieces) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t < 5200) raf = requestAnimationFrame(tick);
      else onDone();
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [onDone]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-50" />;
}

export function TrackLiveResults({ data }: { data: PublicTrackPayload }) {
  const { event } = data;
  const [catId, setCatId] = useState<string | null>(null);
  const category = data.categories.find((c) => c.id === catId) ?? data.categories[0];
  // Campeones (Final cerrada) y celebración: el confeti suena una sola vez por navegador y campeón; no si el visitante pidió menos animación.
  const champions = data.categories.flatMap((c) => { const r = championOf(c); return r ? [{ cat: c, ...r }] : []; });
  const championsKey = champions.map((c) => `${c.cat.id}:${c.champion.bib}`).join("|");
  const [celebrate, setCelebrate] = useState(false);
  const stopCelebrating = useCallback(() => setCelebrate(false), []);
  useEffect(() => {
    if (!championsKey) return undefined;
    try {
      let fresh = false;
      for (const k of championsKey.split("|")) {
        const key = `fedocr-campeon:${event.title}:${event.date}:${k}`;
        if (!window.localStorage.getItem(key)) { window.localStorage.setItem(key, "1"); fresh = true; }
      }
      if (fresh && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setCelebrate(true);
      }
    } catch { /* sin almacenamiento: no se repite la animación, no pasa nada */ }
    return undefined;
  }, [championsKey, event.title, event.date]);
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

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        {celebrate ? <Confetti onDone={stopCelebrating} /> : null}
        {champions.length > 0 ? (
          <div className={`grid gap-4 ${champions.length > 1 ? "md:grid-cols-2" : ""}`}>
            {champions.map(({ cat, champion, runnerUp }) => (
              <Card key={cat.id} className="overflow-hidden border-amber-400/60 bg-gradient-to-br from-amber-500/20 via-amber-400/5 to-transparent">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
                    <Trophy className="size-5 motion-safe:animate-pulse" />Campeón · {cat.name}
                  </div>
                  <div className="mt-3 font-display text-4xl leading-tight text-amber-300 sm:text-5xl">{champion.name ?? "—"}</div>
                  <div className="mt-1 text-lg text-foreground">
                    Dorsal {champion.bib ?? "—"}{champion.best_time_ms != null ? <span className="text-muted-foreground"> · {formatElapsed(champion.best_time_ms)}</span> : null}
                  </div>
                  {runnerUp ? (
                    <div className="mt-4 flex items-center gap-2 border-t border-amber-400/20 pt-3 text-sm text-muted-foreground">
                      <Medal className="size-4 text-slate-300" />Subcampeón: <span className="text-foreground">{runnerUp.bib} {runnerUp.name}</span>
                      {runnerUp.best_time_ms != null ? <span>· {formatElapsed(runnerUp.best_time_ms)}</span> : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {data.live ? (
          <Card className="border-primary">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
                <span className="size-2 animate-pulse rounded-full bg-primary" />En pista ahora
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {data.live.category} · {data.live.stage} · Salida {data.live.run_number} · Oleada {data.live.heat_number}
              </div>
              <div className="mt-2 flex flex-col gap-1 text-lg sm:flex-row sm:gap-8">
                {data.live.lanes.map((l, i) => <LaneText key={i} lane={l} />)}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {event.status === "upcoming" ? (
          <Card><CardContent className="p-6 text-center">
            <Trophy className="mx-auto size-7 text-primary" />
            <h2 className="mt-2 font-display text-2xl">La carrera aún no empieza</h2>
            <p className="mt-1 text-sm text-muted-foreground">Abajo están las oleadas de la primera salida. Esta página se actualiza sola cuando comience.</p>
          </CardContent></Card>
        ) : null}

        {data.categories.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {data.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCatId(c.id)}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition ${c.id === category?.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}

        {category?.stages.map((s) => {
          const st = STAGE_LABEL[s.status] ?? STAGE_LABEL["pending"]!;
          const isFinal = s.qualifiers_count == null;
          return (
            <details key={s.id} open={s.is_current} className="group rounded-lg border border-border">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <span className="font-display text-xl">{s.number}. {s.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.mode === "duel" ? "Muerte súbita · " : ""}{s.runs_per_athlete} salida{s.runs_per_athlete > 1 ? "s" : ""} por atleta{isFinal ? "" : ` · clasifican ${s.qualifiers_count}`}
                  </span>
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </summary>
              <div className="space-y-4 border-t border-border p-4">
                {s.entries.length > 0 ? (
                  <SimpleTable head={["Pos.", "Dorsal", "Atleta", ...Array.from({ length: s.runs_per_athlete }, (_, i) => `Salida ${i + 1}`), "Mejor", ""]}>
                    {s.entries.map((e, i) => {
                      const es = e.state === "eliminated" && s.mode === "duel" ? { label: "Eliminado en duelo", variant: "outline" as const } : ENTRY_STATE[e.state];
                      return (
                        <TableRow key={`${e.bib}-${i}`} className={isFinal && s.status === "closed" && e.position === 1 && e.state !== "withdrawn" ? "bg-amber-500/15 font-semibold" : undefined}>
                          <TableCell className="font-medium">{isFinal && s.status === "closed" && e.position === 1 && e.state !== "withdrawn" ? <span title="Campeón">🏆 1</span> : (e.position ?? "—")}</TableCell>
                          <TableCell>{e.bib ?? "—"}</TableCell>
                          <TableCell>{e.name ?? "—"}</TableCell>
                          {e.runs.map((r, k) => <TableCell key={k}><RunCell run={r} /></TableCell>)}
                          <TableCell className="font-medium">{formatElapsed(e.best_time_ms)}</TableCell>
                          <TableCell>{es ? <Badge variant={es.variant}>{es.label}</Badge> : null}</TableCell>
                        </TableRow>
                      );
                    })}
                  </SimpleTable>
                ) : (
                  <p className="text-sm text-muted-foreground">Esta instancia empieza cuando termine la anterior.</p>
                )}
                {s.heats.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Oleadas</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {s.heats.map((h) => <HeatRow key={h.id} heat={h} />)}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}

        <p className="text-xs text-muted-foreground">
          Información en tiempo real según lo que reporta el cronometraje. Los tiempos se muestran en centésimas (truncadas). Esta página se actualiza sola
          cada 10 segundos y estará disponible hasta el final del día de la carrera.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
