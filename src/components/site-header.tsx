import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, Mountain } from "lucide-react";
import { useState } from "react";
import { DEMO_LEAGUES } from "@/data/demo";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NAV = [
  { to: "/", label: "Inicio" },
  { to: "/ligas", label: "Ligas" },
  { to: "/eventos", label: "Carreras" },
  { to: "/ranking", label: "Ranking" },
  { to: "/panel", label: "Panel" },
] as const;

export function SiteHeader({ activeLeagueSlug }: { activeLeagueSlug?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded bg-primary text-primary-foreground">
            <Mountain className="size-5" />
          </span>
          <span className="font-display text-2xl leading-none tracking-wide">
            FED<span className="text-primary">OCR</span>
            <span className="ml-1 align-middle text-[10px] font-sans tracking-[0.2em] text-muted-foreground">
              COLOMBIA
            </span>
          </span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "bg-accent text-foreground" }}
              className="rounded px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden w-56 md:block">
            <Select
              value={activeLeagueSlug ?? ""}
              onValueChange={(slug) => navigate({ to: "/ligas/$slug", params: { slug } })}
            >
              <SelectTrigger aria-label="Selector de liga departamental">
                <SelectValue placeholder="Elige tu liga departamental" />
              </SelectTrigger>
              <SelectContent>
                {DEMO_LEAGUES.map((league) => (
                  <SelectItem key={league.id} value={league.slug}>
                    {league.department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/auth">Ingresar</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Abrir menú"
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-5" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border bg-card px-4 py-3 lg:hidden">
          <div className="grid gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 md:hidden">
            <Select onValueChange={(slug) => navigate({ to: "/ligas/$slug", params: { slug } })}>
              <SelectTrigger aria-label="Selector de liga departamental">
                <SelectValue placeholder="Elige tu liga departamental" />
              </SelectTrigger>
              <SelectContent>
                {DEMO_LEAGUES.map((league) => (
                  <SelectItem key={league.id} value={league.slug}>
                    {league.department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </header>
  );
}
