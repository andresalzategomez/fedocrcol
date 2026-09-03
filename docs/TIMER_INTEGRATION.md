# Integración con FedOCR Timer

**FedOCR Timer** es una app de escritorio (Electron, offline-first, SQLite) para
cronometrar carreras OCR. Sincroniza con fedocrcol contra una **API REST
`/api/v1`** implementada en este proyecto como *server routes* de TanStack Start
(en `src/routes/api/v1/`), que actúa de **adaptador** sobre Supabase.

## 1. Base y autenticación

- **Base URL:** `https://fedocrcol.lovable.app/api/v1`
- **Auth:** `Authorization: Bearer {token}` — el token es el **JWT de Supabase
  Auth** que devuelve `/auth/login`.
- **Tenant:** header `X-League-Id: {league_id}` (opcional; si viene debe coincidir
  con la liga del token, si no → `409 LEAGUE_MISMATCH`).
- El aislamiento por liga lo garantiza **RLS**: cada petición usa un cliente
  Supabase con el JWT del usuario, así que solo ve datos de su `tenant_id`.

## 2. Mapeo de nombres Timer ↔ backend

| Timer (SQLite) | Backend (Supabase) |
|---|---|
| `league_id` | `tenant_id` |
| `races` | `events` |
| `waves` | `waves` |
| `splits` | `checkpoints` |
| `athletes` (dorsal) | `registrations` |
| `time_records` | `results` (+ `timing_reads` para auditoría) |

## 3. Endpoints

### `GET /health`
`200 → { "status": "ok", "time": "<iso>" }` — sin auth. Poll de estado.

### `POST /auth/login`
Body: `{ "email", "password" }` → Supabase Auth.
```json
{
  "token": "<jwt>", "refresh_token": "...", "expires_at": 0,
  "user_id": "...", "user_name": "...", "user_role": "admin",
  "league_id": "<tenant uuid>", "league_name": "Liga Antioquia"
}
```
Errores: `401 INVALID_CREDENTIALS`, `403 NO_LEAGUE`.

### `GET /races?league_id=X`  *(auth)*
`[ { id, name, date, location, status } ]` (status = `PUBLISHED`/`DRAFT`).

### `GET /races/:raceId/waves`  *(auth)*
`[ { id, wave_number, name, planned_time, start_time_ms, status } ]`
(status = `PENDING`/`STARTED`/`COMPLETED`).

### `GET /races/:raceId/splits`  *(auth)*
`[ { id, name, order, is_start, is_finish } ]`.

### `GET /races/:raceId/athletes`  *(auth)*
`[ { id, bib_number, full_name, document, gender, wave_id, category, registration_status } ]`.

### `POST /time-records/batch`  *(auth)*
El push del Timer. El `net_time_ms` calculado offline es **autoritativo**
(`results.source = 'timer'`; el recálculo automático no lo sobrescribe).

Body:
```jsonc
{
  "race_id": "<event uuid>",
  "records": [
    {
      "id": "<uuid del registro en el Timer>",   // idempotencia
      "bib_number": 142,
      "split_id": "<checkpoint uuid | null>",      // null = meta directa
      "exact_timestamp": 1746890722531,             // epoch ms de la lectura
      "penalty_seconds": 30,
      "net_time_ms": 3930000,
      "status": "OK",                               // OK | DNF | DSQ | DNS
      "wave_id": "<wave uuid | null>"
    }
  ]
}
```
Respuesta:
```json
{ "synced_ids": ["..."], "failed_ids": [ { "id": "...", "reason": "ATHLETE_NOT_FOUND" } ] }
```
Comportamiento por registro:
- Resuelve la inscripción por `race_id + bib_number` → si no existe: `ATHLETE_NOT_FOUND`.
- En la **meta** (`split_id` es un checkpoint con `is_finish`, o `split_id = null`)
  hace *upsert* del `result` con `duration_ms = net_time_ms`, `penalty_seconds`,
  `status` y `source = 'timer'`.
- Guarda además la lectura cruda en `timing_reads` (auditoría). Reenvío del mismo
  `id` (`client_record_id` único) → idempotente, cuenta como sincronizado
  (equivale a `DUPLICATE_RECORD`).

### Códigos de conflicto (para la estrategia de la Fase 4 del Timer)
`ATHLETE_NOT_FOUND`, `LEAGUE_MISMATCH`, `NO_LEAGUE`, `BAD_REQUEST`, `UNAUTHORIZED`.
Un `id` que vuelve en `synced_ids` tras un reintento indica `DUPLICATE_RECORD`
(ya estaba) — el Timer lo marca `is_synced = 1` sin reintentar.

## 4. Variables de entorno del servidor
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (cliente por-usuario con RLS),
`SUPABASE_SERVICE_ROLE_KEY` (solo operaciones administrativas). Ver `.env.example`.

## 5. Requisitos previos por evento (para que el Timer tenga qué descargar)
- Evento (`events`) publicado en la liga.
- `checkpoints` con `is_start` / `is_finish` marcados.
- `waves` con `wave_number` (y `status`, `started_at` al dar la salida).
- Inscripciones con `bib_number` y `wave_id` asignados.
- Un usuario (juez) de la liga con credenciales de Supabase Auth.
