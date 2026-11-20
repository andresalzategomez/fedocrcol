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

> **Jueces (rol `judge`):** si quien llama tiene `user_role: "judge"`, esta lista
> viene **ya filtrada** a solo los checkpoints que el admin de la liga le asignó
> (`checkpoint_judges`). Admin/superadmin siguen viendo todos. El Timer no
> necesita lógica extra para esto — el selector de punto de control del
> Dashboard ya solo tiene para elegir entre lo que llega acá. Si un juez no
> tiene ningún checkpoint asignado, la lista viene vacía (`[]`).

### `GET /races/:raceId/athletes`  *(auth)*
`[ { id, bib_number, full_name, document, gender, wave_id, category, registration_status } ]`.

> **`bib_number` cambió de número a string de 4 dígitos** (`"0001"`, `"0142"`) —
> se guarda así en fedocrcol porque de ahí se exporta la lista para fabricar los
> dorsales físicos. No requiere ningún cambio del lado del Timer: ya lo
> convertías a texto al guardarlo localmente (`String(a.bib_number)`), así que
> tanto `"0142"` como `142` caen bien ahí. Lo único que sí importa es el envío
> en `/time-records/batch` de abajo — sigue siendo numérico.

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
      "bib_number": 142,                             // numérico — el Timer lo sigue enviando así (coerceBib)
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
  (fedocrcol guarda el dorsal como texto con ceros ("0142") pero compara
  parseando ambos lados a entero, así que da igual si en algún momento se
  envía `142` o `"0142"`.)
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

### `POST /races/:raceId/start`  *(auth)*
El Timer llama esto cuando el juez **inicia la competencia** en pista
(típicamente al disparar la primera oleada). Pasa la carrera de `approved` a
`in_progress` en fedocrcol — a partir de ahí, el panel web congela su
contenido (checkpoints, oleadas, categorías, inscritos): nadie puede
modificarlos hasta finalizarla.

Sin body. Respuesta `200`:
```json
{ "status": "in_progress" }
```
Idempotente: si ya estaba `in_progress`, responde `{ "status": "in_progress", "already": true }`
sin error — seguro de reintentar si el Timer estaba offline.

Errores: `404 NOT_FOUND` (carrera no existe o no es de tu liga), `409 INVALID_STATE`
si la carrera no está `approved` (por ejemplo, sigue en borrador o ya finalizó).

### `POST /races/:raceId/finish`  *(auth)*
El Timer llama esto cuando el juez **cierra la competencia** (todas las
oleadas completadas). Pasa la carrera de `in_progress` a `finished`.

Sin body. Respuesta `200`:
```json
{ "status": "finished" }
```
Idempotente igual que `/start`. Error `409 INVALID_STATE` si la carrera no
está `in_progress`.

### `POST /waves/:waveId/start`  *(auth)*
El Timer llama esto al disparar una oleada (`startWave` local), para que
`waves.started_at` deje de quedar siempre vacío en fedocrcol — hasta ahora
nada lo sincronizaba, así que ni el panel web ni ningún reporte podían
mostrar la hora real de salida de una oleada.

Body:
```json
{ "started_at": 1746890722531 }
```
`started_at` es el epoch ms exacto capturado por el Timer al disparar (el
mismo valor que ya guarda localmente en `waves.start_time_ms`).

Respuesta `200`:
```json
{ "started_at": "2026-09-06T08:34:46.000Z" }
```
Idempotente: si la oleada ya tenía `started_at`, no lo sobrescribe — responde
`{ "started_at": "<el que ya tenía>", "already": true }` (protege la hora real
ante un reintento tardío del Timer).

Errores: `404 NOT_FOUND` (oleada no existe o no es de tu liga), `400 BAD_REQUEST`
si falta `started_at`.

> Nota: a diferencia de `/races/:id/start|finish`, esta escritura se hace con
> `service_role` en el servidor — la política RLS de `waves` congela su
> contenido mientras el evento está `in_progress`, pero una oleada arranca
> precisamente en ese momento, así que el endpoint valida el permiso con el
> JWT del juez y luego escribe saltándose esa regla (igual que ya hace
> `recalculate_event_positions`).

## 4. Variables de entorno del servidor
`EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY` (cliente por-usuario con RLS),
`EXT_SUPABASE_SERVICE_ROLE_KEY` (solo operaciones administrativas). Ver `.env.example`.
(El prefijo `SUPABASE_` está reservado por Lovable; se usa `EXT_SUPABASE_`.)

## 5. Requisitos previos por evento (para que el Timer tenga qué descargar)
- Evento (`events`) publicado en la liga.
- `checkpoints` con `is_start` / `is_finish` marcados.
- `waves` con `wave_number` (y `status`, `started_at` al dar la salida).
- Inscripciones con `bib_number` y `wave_id` asignados.
- Un usuario (juez) de la liga con credenciales de Supabase Auth.

## 6. Cambios de noviembre de 2026 (compatibles hacia atrás)

Ninguno de estos cambios modifica la forma de las peticiones ni de las respuestas existentes: solo
agrega validaciones y un campo informativo en la respuesta del envío de tiempos.

### Carreras tipo TRACK no existen para esta API
`events.race_format` distingue las carreras estándar (`standard`, las de FedOCR Timer) de las carreras
tipo TRACK (`track`, las de Timer_track, que usan `/api/track/v1`).
- `GET /races` **solo lista carreras estándar**.
- `waves`, `splits`, `athletes`, `start`, `finish`, `waves/:id/start` y `time-records/batch` responden
  `404 NOT_FOUND` ("Carrera no encontrada") si la carrera es track, igual que si no existiera.

### `POST /time-records/batch`
- **Roles:** solo `admin` y `superadmin` (de la liga del token) y `judge`. Cualquier otro rol → `403 FORBIDDEN`.
- **Jueces:** solo pueden enviar lecturas de los checkpoints que tienen asignados; la meta directa
  (`split_id = null`) solo si tienen asignado un checkpoint de meta. El resto de lecturas del lote fallan con
  `CHECKPOINT_NOT_ASSIGNED`. Además, un juez solo puede escribir mientras la carrera está `in_progress`.
- **`id` del registro:** debe ser un UUID (`client_record_id`). Si no → falla ese registro con `INVALID_RECORD_ID`.
- **Un registro solo cuenta como sincronizado si realmente quedó guardado.** Antes, un fallo al guardar el
  resultado se ignoraba y el id volvía en `synced_ids`; ahora vuelve en `failed_ids` con `RESULT_SAVE_FAILED`
  (o `RESULT_READ_FAILED`).
- **Idempotencia del resultado:** un registro **más viejo** (`exact_timestamp` anterior al `finish_at` ya guardado) o
  un resultado corregido a mano (`source = 'manual'`) **no se sobrescriben**: el id vuelve en `synced_ids` (no hay
  nada que reintentar) y además en `ignored_ids` con `OLDER_THAN_SAVED_RESULT` o `MANUAL_RESULT_KEPT`.
- Nuevos motivos en `failed_ids`: `INVALID_RECORD_ID`, `SPLIT_NOT_FOUND`, `CHECKPOINT_NOT_ASSIGNED`,
  `RESULT_SAVE_FAILED`, `RESULT_READ_FAILED` (más los de antes: `ATHLETE_NOT_FOUND` y códigos de base de datos).

Respuesta (el campo nuevo `ignored_ids` es informativo; un cliente que lo ignore sigue funcionando):
```json
{
  "synced_ids": ["..."],
  "failed_ids": [ { "id": "...", "reason": "CHECKPOINT_NOT_ASSIGNED" } ],
  "ignored_ids": [ { "id": "...", "reason": "OLDER_THAN_SAVED_RESULT" } ]
}
```

### Sesión
`POST /auth/login` devuelve `token` (JWT de 1 hora) y `refresh_token` (rota en cada uso). Para renovar la sesión
se usa el endpoint de refresh de Supabase Auth con ese `refresh_token`; no hay `/auth/refresh` en `/api/v1`
(la API de Timer_track, `/api/track/v1`, sí lo trae).
