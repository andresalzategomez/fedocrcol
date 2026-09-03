# Documentación — FedOCR Colombia

Backend y plataforma de la Federación de OCR (Obstacle Course Racing) de Colombia.
SaaS **multi-tenant**: una federación nacional que agrupa **ligas departamentales**,
con gestión de atletas, clubes, afiliaciones, eventos, inscripciones pagas,
cronometraje y ranking nacional.

## Índice

| Documento | Contenido |
|-----------|-----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Visión de arquitectura, stack, multi-tenant, roles y flujos. |
| [DATABASE.md](./DATABASE.md) | Modelo de datos, diagrama ER, tablas, RLS y estrategia de migraciones. |
| [TIMER_INTEGRATION.md](./TIMER_INTEGRATION.md) | Contrato de integración con **FedOCR Timer** (cómo lee y escribe tiempos). |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Variables de entorno, despliegue en Supabase + Lovable y checklist. |

## Stack

- **Frontend / SSR:** TanStack Start (React 19) + Vite + Tailwind CSS v4 + shadcn/ui.
- **Backend:** Supabase **externo** (PostgreSQL + Auth + RLS + Storage + Edge/Server routes).
- **Hosting / sync:** Lovable (sincroniza commits de `main` con el editor).
- **Pagos:** pasarelas de Colombia (Bold / PayU / Wompi / PSE) vía webhook server-side.

## Repositorio (mapa rápido)

```
src/
  routes/            Rutas TanStack (index, auth, eventos, ligas, panel, ranking)
    api/public/      Endpoints server-side (webhook de pagos)
  lib/               supabase.ts, registrations.ts, tenant-theme.ts, datos demo
  components/        UI (shadcn/ui) + header/footer
supabase/
  schema.sql         Esquema maestro consolidado (fuente de verdad)
  migrations/        Migraciones incrementales idempotentes (0001..N)
docs/                Esta documentación
```

> **Importante:** el repo está conectado a Lovable. Mantén `main` en estado
> funcional y **no reescribas** historia ya publicada (nada de force-push /
> rebase de commits ya subidos).
