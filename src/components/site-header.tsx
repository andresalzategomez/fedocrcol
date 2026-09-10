import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Menu, Mountain, User } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/use-session";

const NAV = [
  { to: "/", label: "Inicio" },
  { to: "/ligas", label: "Ligas" },
  { to: "/eventos", label: "Carreras" },
  { to: "/ranking", label: "Ranking" },
  { to: "/panel", label: "Panel" },
] as const;

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Administración nacional",
  admin: "Administrador de liga",
  club: "Club",
  race_manager: "Gestor de carreras",
  judge: "Juez",
  athlete: "Atleta",
};

export function SiteHeader({ activeLeagueSlug }: { activeLeagueSlug?: string | undefined }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { loading, email, profile, signOut } = useSession();

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/" });
  }

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
          {!loading && profile ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <User className="size-4" />
                  <span className="hidden max-w-[12rem] truncate sm:inline">{email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">
                  {email}
                  {profile.role ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {ROLE_LABEL[profile.role] ?? profile.role}
                    </span>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/panel" className="flex items-center gap-2">
                    <LayoutDashboard className="size-4" /> Panel
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="flex items-center gap-2 text-destructive focus:text-destructive">
                  <LogOut className="size-4" /> Cerrar sesión / Salir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
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
            </>
          )}
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
          {!loading && profile ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="truncate px-3 text-sm font-medium">{email}</p>
              {profile.role ? (
                <p className="px-3 text-xs text-muted-foreground">{ROLE_LABEL[profile.role] ?? profile.role}</p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void handleSignOut();
                }}
                className="mt-2 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
              >
                <LogOut className="size-4" /> Cerrar sesión / Salir
              </button>
            </div>
          ) : (
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
          )}
        </div>
      ) : null}
    </header>
  );
}
