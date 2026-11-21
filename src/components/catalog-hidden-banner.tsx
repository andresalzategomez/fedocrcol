import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Aviso que reemplaza el listado de ligas y carreras cuando el superadmin lo tiene oculto
 * (interruptor del panel). Invita a sumar la liga propia; debajo se sigue mostrando solo la muestra.
 */
export function CatalogHiddenBanner() {
  return (
    <Card className="overflow-hidden border-primary/40 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
      <CardContent className="flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-primary">
            <Building2 className="size-5" /><Flag className="size-5" />
          </div>
          <h2 className="mt-3 font-display text-3xl leading-tight sm:text-4xl">Aquí puede estar tu liga y tus carreras</h2>
          <p className="mt-3 text-muted-foreground">
            FEDOCR Colombia reúne a las ligas departamentales de carreras de obstáculos: inscripciones, resultados en vivo y ranking nacional en una
            sola plataforma. Estamos sumando ligas para la temporada 2027. Registra la tuya, publica tus carreras y deja que tus atletas se inscriban
            aquí. Mientras tanto, te mostramos un ejemplo de cómo se ve una liga y una carrera.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link to="/auth" search={{ tab: "signup" }}>Registrar mi liga <ArrowRight className="ml-2 size-4" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}
