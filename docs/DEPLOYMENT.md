# Despliegue y configuración — FedOCR Colombia

## 1. Variables de entorno

Copia `.env.example` a `.env` (local) y configura en Lovable/hosting las de
producción. **Nunca** subas `.env` al repo.

| Variable | Ámbito | Descripción |
|----------|--------|-------------|
| `VITE_SUPABASE_URL` | Cliente | URL del proyecto Supabase externo. |
| `VITE_SUPABASE_ANON_KEY` | Cliente | Anon key (pública, protegida por RLS). |
| `SUPABASE_URL` | Servidor | URL del proyecto (para el webhook). |
| `SUPABASE_SERVICE_ROLE_KEY` | Servidor | Service role (omite RLS). **Solo servidor.** |
| `PAYMENT_WEBHOOK_SECRET` | Servidor | Secreto HMAC de la pasarela (Bold/PayU). |

> Si `VITE_SUPABASE_URL`/`ANON_KEY` no están, la app corre en **modo demo** con
> datos de ejemplo (ver `src/lib/supabase.ts`).

## 2. Configurar el Supabase externo

1. Crea el proyecto en Supabase (región cercana a Colombia).
2. En **SQL Editor**, ejecuta `supabase/schema.sql` (crea todo el esquema, RLS,
   funciones, vista de ranking y trigger de auth). Es idempotente.
3. Verifica que **RLS está habilitado** en todas las tablas (lo hace el script).
4. En **Authentication → Providers**, habilita Email (y los que quieras).
5. Copia la URL y las keys a tus variables de entorno.

Para aplicar **solo los cambios nuevos** sobre una base existente, ejecuta en
orden `supabase/migrations/0002_timing.sql` y
`supabase/migrations/0003_clubs_affiliations_categories.sql`.

## 3. Desarrollo local

```sh
# requiere Node 20+ (o Bun, el repo trae bun.lock)
npm install        # o: bun install
cp .env.example .env   # y completa los valores
npm run dev        # Vite dev server
```

## 4. Pagos (webhook)

- Endpoint: `POST https://<tu-dominio>/api/public/pagos/webhook`
- Configúralo en el panel de la pasarela (Bold/PayU) con el mismo
  `PAYMENT_WEBHOOK_SECRET`.
- El webhook valida la firma HMAC-SHA256 y actualiza `registrations` a `paid` y
  crea el `payment`. Ver `src/routes/api/public/pagos.webhook.ts`.

## 5. Sincronización con Lovable

- Los commits a `main` se sincronizan con el editor de Lovable.
- Mantén `main` compilando. **No** reescribas historia ya publicada (sin
  force-push / rebase de commits ya subidos): rompería el historial en Lovable.

## 6. Checklist de producción
- [ ] Esquema aplicado y RLS verificado en Supabase.
- [ ] Variables de entorno de servidor configuradas (service role fuera del cliente).
- [ ] Webhook de pagos probado con el secreto correcto.
- [ ] Backups automáticos de la base activados en Supabase.
- [ ] Dominio y CORS configurados.
- [ ] Credenciales del FedOCR Timer emitidas (ver TIMER_INTEGRATION.md).
