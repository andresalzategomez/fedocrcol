import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-3xl">
            FED<span className="text-primary">OCR</span> COLOMBIA
          </p>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            Plataforma oficial de las ligas departamentales de Obstacle Course Racing: inscripciones,
            resultados, ranking nacional y clasificación al Mundial.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Plataforma</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/ligas" className="hover:text-primary">Ligas departamentales</Link></li>
            <li><Link to="/eventos" className="hover:text-primary">Calendario de carreras</Link></li>
            <li><Link to="/ranking" className="hover:text-primary">Ranking nacional</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Acceso</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/auth" className="hover:text-primary">Ingresar / Registrarse</Link></li>
            <li><Link to="/panel" className="hover:text-primary">Panel administrativo</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Federación Colombiana de OCR. Todos los derechos reservados.
      </div>
    </footer>
  );
}
