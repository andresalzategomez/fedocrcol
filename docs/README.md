# Documentación — FedOCR Colombia

Backend y plataforma de la Federación de OCR (Obstacle Course Racing) de Colombia.
SaaS **multi-tenant**: federación nacional + **ligas departamentales**, con gestión
de atletas, clubes, afiliaciones, eventos con aprobación, inscripción paga,
categorías, oleadas, cronometraje y ranking nacional.

## Índice

| Documento | Contenido |
|-----------|-----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Arquitectura, stack, multi-tenant, roles y flujos. |
| [DATABASE.md](./DATABASE.md) | Modelo de datos, diagrama ER, tablas, RLS y migraciones. |
| [TIMER_INTEGRATION.md](./TIMER_INTEGRATION.md) | Contrato de la API `/api/v1` con **FedOCR Timer**. |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Variables de entorno, despliegue y checklist. |

## Capacidades (resumen)

- Multi-tenant white-label con aislamiento por RLS.
- Afiliaciones, clubes y catálogo de categorías.
- Eventos con **flujo de aprobación** (liga → federación).
- **Maestro de categorías por carrera** + **dorsal automático** + **generación de oleadas** por categoría.
- Inscripción y pagos (Wompi · PSE · Bold · PayU) con webhook firmado.
- API `/api/v1` para el cronometraje offline **FedOCR Timer**.
- Resultados en vivo y ranking nacional.
- Exportación de **Excel** y **PDF**; panel con **paginación** y **validaciones**.

## Stack

TanStack Start (React 19) + Vite + Tailwind v4 + shadcn/ui, con **Supabase externo**
(PostgreSQL + Auth + RLS). API del Timer como server routes; reportes con SheetJS y
jsPDF. Hosting/sync en Lovable.

> El repo está conectado a Lovable: `main` siempre funcional; no reescribir historia publicada.
