# FedOCR Colombia

Plataforma oficial de la **Federación Colombiana de OCR** (Obstacle Course Racing).
SaaS **multi-tenant** que reúne a la federación nacional, sus **ligas
departamentales** y los **atletas** en un solo sistema: afiliación, inscripción y
pago de carreras, categorías y oleadas, cronometraje en pista y ranking nacional
con clasificación al Mundial.

**App en producción:** https://fedocrcol.lovable.app

---

## Qué incluye

- **Multi-tenant white-label** — cada liga con su identidad visual y sus datos
  aislados por `tenant_id`, garantizado con Row Level Security (RLS) en Supabase.
- **Afiliaciones y clubes** — membresía por temporada, carnet y clubes por liga.
- **Eventos con flujo de aprobación** — la liga arma la carrera y la federación la
  aprueba antes de publicarla (`draft → pending_federation → approved → in_progress → finished`).
- **Maestro de categorías por carrera** — cada evento define sus categorías por
  edad y género (con el catálogo estándar OCR listo para sembrar).
- **Dorsales automáticos y oleadas** — el dorsal se asigna solo; las oleadas se
  generan por categoría (máx. N por oleada) y se ajustan a mano.
- **Inscripción y pagos** — pasarelas de Colombia (Wompi · PSE · Bold · PayU) con
  webhook firmado y comprobante QR.
- **Cronometraje offline (FedOCR Timer)** — app de escritorio que descarga la lista
  de largada, registra tiempos sin conexión y sincroniza vía la API `/api/v1`.
- **Resultados y ranking** — tiempos y posiciones en vivo, ranking nacional y
  clasificación al Mundial.
- **Reportes** — exportación de carreras e inscritos a **Excel** y **PDF**.
- **Panel de administración** — para la federación (superadmin) y los admins de liga,
  con paginación (10/20/50/100) y validaciones de formulario.

## Stack

- **Frontend / SSR:** TanStack Start (React 19) + Vite + Tailwind CSS v4 + shadcn/ui
- **Backend:** Supabase externo (PostgreSQL + Auth + RLS + Storage)
- **API del Timer:** server routes de TanStack Start en `src/routes/api/v1/`
- **Reportes:** SheetJS (`xlsx`) y jsPDF (`jspdf` + `jspdf-autotable`)
- **Hosting / sync:** Lovable (`fedocrcol.lovable.app`)

## Estructura

```
src/
  routes/            index · auth · eventos · ligas · panel · ranking
    api/
      public/pagos.webhook.ts     Webhook de pagos (HMAC)
      v1/                          API REST que consume FedOCR Timer
  lib/               supabase.ts · admin-api.ts · use-session.ts · validate.ts
                     export.ts · tenant-theme.ts · server/ (clientes server-side)
  components/        UI (shadcn/ui) + header/footer
supabase/
  schema.sql         Esquema consolidado (fuente de verdad)
  migrations/        Migraciones idempotentes 0001..N
docs/                Documentación técnica (arquitectura, BD, integración Timer, despliegue)
  brochure/          Brochure de presentación del producto (index.html)
```

## Puesta en marcha

```sh
bun install          # o: npm install
cp .env.example .env # completa las variables (ver docs/DEPLOYMENT.md)
bun run dev          # o: npm run dev
```

Para la base de datos, ejecuta `supabase/schema.sql` en el SQL Editor de tu
proyecto Supabase (o aplica las migraciones de `supabase/migrations/` en orden).
Detalle en [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Arquitectura, multi-tenant, roles y flujos. |
| [docs/DATABASE.md](./docs/DATABASE.md) | Modelo de datos, diagrama ER, RLS y migraciones. |
| [docs/TIMER_INTEGRATION.md](./docs/TIMER_INTEGRATION.md) | Contrato de la API `/api/v1` con FedOCR Timer. |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Variables de entorno y despliegue. |

## Sincronización con Lovable

Este repositorio está conectado a Lovable: los commits a `main` se sincronizan con
el editor. Mantén `main` en estado funcional y no reescribas historia ya publicada.

---

© Federación Colombiana de OCR.
