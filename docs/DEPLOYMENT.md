# Despliegue y configuración — FedOCR Colombia

## 1. Variables de entorno

Copia `.env.example` a `.env` (local) y configura en Lovable/hosting las de
producción. **Nunca** subas `.env` al repo.

| Variable | Ámbito | Descripción |
|----------|--------|-------------|
| `VITE_SUPABASE_URL` | Cliente | URL del proyecto Supabase externo. |
| `VITE_SUPABASE_ANON_KEY` | Cliente | Anon key (pública, protegida por RLS). |
| `EXT_SUPABASE_URL` | Servidor | URL del proyecto (para el webhook y la API /api/v1). |
| `EXT_SUPABASE_ANON_KEY` | Servidor | Anon key (cliente por-usuario con RLS en la API /api/v1). |
| `EXT_SUPABASE_SERVICE_ROLE_KEY` | Servidor | Service role (omite RLS). **Solo servidor.** |
| `BOLD_IDENTITY_KEY` | Servidor | Llave de identidad de Bold (crea links de pago y consulta su estado). |
| `BOLD_SECRET_KEY` | Servidor | Llave secreta de Bold (firma de los webhooks). **Solo servidor.** |
| `BOLD_TEST_MODE` | Servidor | `true` solo con llaves de pruebas (Bold firma con llave vacía). En producción, no definirla. |
| `RESEND_API_KEY` | Servidor | API key de Resend para correos transaccionales. |
| `RESEND_FROM_EMAIL` | Servidor | Remitente verificado en Resend. |

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

## 4. Pagos con Bold (webhook y afiliación de ligas)

- Endpoint: `POST https://<tu-dominio>/api/public/pagos/webhook`
- Regístralo en Bold (Integraciones -> Webhooks). Bold firma cada notificación
  en `x-bold-signature`: HMAC-SHA256, en hexadecimal, del cuerpo en Base64 con
  `BOLD_SECRET_KEY` (llave vacía en el ambiente de pruebas). Debe responderse
  200 en menos de 2 s; si no, Bold reintenta hasta 5 veces en 24 h.
- El mismo endpoint atiende dos cobros, según `data.metadata.reference`:
  - `liga-<uuid>-...`: cuota de afiliación de una liga. Se consulta a Bold el
    estado real del link y, si está `PAID`, la liga pasa de `awaiting_payment`
    a `active` (tabla `league_affiliation_payments`, migración 0030).
  - cualquier otra: el `qr_code` de una inscripción, que pasa a `paid` y crea
    el `payment`.
- Flujo de afiliación: la liga solicita (`pending`) -> la federación la aprueba
  en Panel > Aprobaciones definiendo el monto (`POST /api/admin/league-approve`
  crea el link en Bold y lo envía por correo) -> se paga -> `active`. Si el
  webhook se pierde, "Verificar pago" (`/api/admin/league-check-payment`)
  consulta a Bold y activa la liga.
- Ver `src/routes/api/public/pagos.webhook.ts` y `src/lib/server/bold.ts`.

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
