# Integración con Timer_track — API `/api/track/v1`

**Timer_track** (https://timertrack.fedocrcolombia.com) cronometra las carreras **tipo TRACK** (pista de 2 carriles,
eliminatorias por instancias). Es offline-first: calcula todo en el dispositivo y sincroniza con fedocr cuando hay
conexión. Este documento es **el contrato** de la API. Cualquier cambio se avisa antes de publicarse y, si rompe la
compatibilidad, va en una versión nueva (`/api/track/v2`).

Las carreras track **no** existen para FedOCR Timer (`/api/v1`): no las lista ni las puede operar.

- **Versión de la API:** `1.0.0` (`api_version` en las respuestas)
- **Versión del motor de reglas:** `0.2.0` (`engine_version`). El servidor usa **el mismo motor** que la app
  (`src/lib/track-engine`, copia sin modificar de `engine-v0.2.0`) para validar y aplicar cada evento.
- **Base URL (por ahora):** `https://fedocrcol.lovable.app/api/track/v1`

## 1. Convenciones

- JSON, `Content-Type: application/json`, tiempos en **milisegundos** enteros (se comparan en **centésimas truncadas**:
  32.489 s = 32.48).
- Todas las respuestas traen `server_time` (ISO) y `api_version`. Úsalo para detectar un reloj desfasado; **los tiempos de
  carrera no dependen del reloj del dispositivo** (`elapsed_ms` lo calcula la app con reloj monotónico).
- Errores: `{ "error": { "code": "...", "message": "..." }, "server_time": "...", "api_version": "1.0.0" }`.
- **CORS:** solo `https://timertrack.fedocrcolombia.com`, `http://localhost:5180` y `http://localhost:5181`. Cualquier otro origen
  se avisa antes. La API no usa cookies (el token va en el encabezado), por eso no hay credenciales.
- Todo lo que no sea `/health` y `/auth/*` exige `Authorization: Bearer <token>`.

## 2. Autenticación

### `POST /auth/login`
```json
{ "email": "juez@liga.co", "password": "..." }
```
`200`:
```json
{
  "token": "<jwt>", "refresh_token": "<token>", "expires_at": 1795068152, "expires_in": 3600,
  "user": { "id": "uuid", "name": "Juez de Prueba", "role": "judge", "league_id": "uuid", "league_name": "Liga X" },
  "league": { "id": "uuid", "name": "Liga X" },   // null si el usuario no tiene liga (superadmin)
  "server_time": "2026-11-20T15:00:00.000Z", "api_version": "1.0.0"
}
```
Errores: `401 INVALID_CREDENTIALS`, `403 FORBIDDEN_ROLE` (solo `judge`, `admin` y `superadmin` operan carreras track).

### `POST /auth/refresh`
```json
{ "refresh_token": "<token>" }
```
`200`: misma forma que el login (incluye `user` y `league`). **Cada refresh entrega un `refresh_token` nuevo: guarda siempre el último.**
Medido en el proyecto de producción: los `refresh_token` anteriores **siguen aceptándose** (no se invalidan al rotar), así que si
se perdió la respuesta de un refresh puedes **reintentar con el mismo token** sin perder la sesión. No dependas de que el anterior
quede inservible. Un token inventado o ajeno responde `401 INVALID_REFRESH_TOKEN`. El token de acceso dura **1 hora**;
refresca antes de que venza mientras haya red. Sin red, sigue operando y encolando eventos; al volver, refresca y sincroniza.
Si el refresh también venció, inicia sesión de nuevo **sin perder la cola local**.

### `GET /health` (sin autenticación)
`200 → { "status": "ok", "time": "<iso>", "api_version": "1.0.0" }`.

## 3. Quién puede operar una carrera

El **juez asignado** a la carrera (uno solo por carrera), el **administrador de la liga dueña** y la **federación**. Cualquier otro
usuario recibe `404 NOT_FOUND` (no se revela que la carrera existe); un atleta o club recibe `403 FORBIDDEN_ROLE`.
Los atletas no leen datos operativos ni escriben tiempos.

## 4. Carreras y paquete

### `GET /races`
Carreras track **aprobadas o en curso** que el usuario puede operar.
```json
{ "races": [ { "id": "uuid", "name": "Carrera X", "date": "2026-11-21", "location": "Pista", "status": "approved", "league_id": "uuid" } ] }
```

### `GET /races/:raceId/package`
Todo lo necesario para operar sin conexión. **Solo entran inscritos con pago confirmado y dorsal**; de cada atleta solo
`registration_id`, `bib` y `name` (nunca documento ni datos médicos).
```jsonc
{
  "api_version": "1.0.0", "engine_version": "0.2.0",
  "supported_event_types": ["RACE_STARTED", "PAIRING_SET", "..."],
  "race": { "id": "uuid", "name": "...", "date": "2026-11-21", "location": "...", "status": "approved" },
  "categories": [
    {
      "id": "uuid", "name": "Elite Masculino",
      "athletes": [ { "registration_id": "uuid", "bib": "0001", "name": "Julián Ospina" } ],
      "stages": [ { "id": "uuid", "stage_number": 1, "name": "Clasificación", "runs_per_athlete": 3, "qualifiers_count": 8 } ]
    }
  ],
  "initial_heats": [ { "id": "uuid", "stage_id": "uuid", "run_number": 1, "heat_number": 1, "left": "registration_id", "right": "registration_id | null" } ],
  "state": { "...": "ver /state" },
  "active_device": { "device_id": "tablet-A", "activated_at": "...", "last_synced_at": "..." }
}
```
`initial_heats` son las parejas de la **instancia 1, salida 1** (máximo 2 atletas por oleada; si el total es impar, uno sale solo;
cada atleta una sola vez). `qualifiers_count` es `null` en la final. `supported_event_types` es la lista de **nombres de tipo** de
evento que el servidor acepta hoy: **no envíes un tipo que no esté ahí**.

### `GET /races/:raceId/state`
Estado consolidado que calcula el servidor reprocesando los eventos aceptados con el motor, para reconciliarse.
```jsonc
{
  "race": { "id": "uuid", "name": "...", "status": "in_progress" },
  "accepted_events": 13,
  "state": {
    "started": true, "finished": false, "active_heat_id": "uuid | null", "warnings": [],
    "stages": [ { "id": "uuid", "category_id": "uuid", "stage_number": 1, "name": "...", "runs_per_athlete": 3, "qualifiers_count": 8, "status": "open",
                  "ranking": [ { "registration_id": "uuid", "bib": "0001", "name": "...", "position": 1, "best_time_ms": 32489,
                                 "withdrawn": false, "tied_with_previous": false, "runs": [ { "kind": "time", "ms": 32489 } ] } ] } ],
    "heats": [ { "id": "uuid", "stage_id": "uuid", "run_number": 1, "heat_number": 1, "status": "confirmed", "pairing_source": "fedocr", "started_at_ms": 1795068152000,
                 "left":  { "registration_id": "uuid", "bib": "0001", "name": "...", "outcome": "time", "elapsed_ms": 32489, "arrival_order": 1 },
                 "right": { "...": "..." }, "notes": [ { "kind": "review", "text": "...", "at": "..." } ] } ],
    "withdrawals": [ { "registration_id": "uuid", "stage_id": "uuid", "heat_id": null, "reason": "injury", "note": "...", "at": "..." } ]
  },
  "active_device": { "device_id": "tablet-A", "activated_at": "...", "last_synced_at": "..." },
  "last_device_seq": { "tablet-A": 13 }
}
```
Estados de oleada: `pending`, `started`, `awaiting_confirmation`, `confirmed`. Estados de instancia: `pending`, `open`, `closed`.
Resultado de un atleta en una salida: `time`, `did_not_run`, `did_not_finish`, `withdrawn`, `pending`.

## 5. Dispositivo activo

Solo hay **un dispositivo activo por carrera**. Hay que activarlo antes de sincronizar.

### `POST /races/:raceId/device/activate`
```json
{ "device_id": "tablet-A", "takeover_note": "opcional: obligatoria si reemplaza a otro" }
```
- Sin dispositivo activo, o el mismo → `200 { "ok": true, "device_id", "activated_at", "last_device_seq", "replaced_device_id": null }` (idempotente).
- Hay otro activo y no hay observación → `409 DEVICE_ALREADY_ACTIVE` (con `active_device` en el cuerpo).
- Con `takeover_note` (mínimo 3 caracteres) → lo reemplaza: `replaced_device_id` trae el anterior.

Los eventos del dispositivo reemplazado se rechazan con `DEVICE_NOT_ACTIVE`; solo se recuperan con un respaldo importado
(`BACKUP_IMPORTED`, que trae los `client_event_id` originales para no duplicar).

## 6. Sincronización

### `POST /races/:raceId/sync`
```jsonc
{
  "device_id": "tablet-A",
  "events": [
    { "client_event_id": "uuid", "device_seq": 1, "occurred_at": "2026-11-21T09:00:00.000Z", "type": "RACE_STARTED", "payload": {} }
  ]
}
```
**Máximo 200 eventos por lote.** Respuesta `200`:
```json
{
  "accepted": ["client_event_id", "..."],
  "duplicates": ["client_event_id"],
  "rejected": [ { "client_event_id": "uuid", "code": "SECOND_ACTIVE_HEAT", "message": "Ya hay una oleada en la pista. Confírmala primero." } ],
  "next_expected_seq": 14,
  "engine_version": "0.2.0", "supported_event_types": ["..."], "server_time": "...", "api_version": "1.0.0"
}
```
Reglas:
- **Idempotente:** un `client_event_id` ya recibido vuelve en `duplicates`; reintentar un lote no duplica nada.
- **Ordenado por `device_seq`** (empieza en 1 por dispositivo y carrera). Un hueco rechaza el resto del lote con `SEQUENCE_GAP`;
  reenvía desde `next_expected_seq`.
- Cada evento lo **valida** el servidor (formato) y lo **aplica el motor**. Si viola una regla queda **rechazado** con el mismo
  código que usa la app, **se guarda en el historial** (inalterable) y **consume su `device_seq`**: el siguiente evento debe
  traer el número que sigue. Un evento aceptado nunca se modifica ni se borra.
- El primer `RACE_STARTED` aceptado pasa la carrera de `approved` a `in_progress`.
- El servidor refleja el estado en sus tablas (oleadas, carriles, clasificación y retiros) para el panel y la vista pública.
  **No escribe** en `results`, `waves`, `checkpoints`, `timing_reads` ni en el ranking nacional.
- `RACE_FINISHED` aceptado pasa la carrera a `finished`. Después el servidor sigue recibiendo eventos de dispositivo/respaldo, pero cualquier
  evento de reglas se rechaza con `RACE_ALREADY_FINISHED`.
- Fuera de estado (`approved`/`in_progress`, o `finished` por `RACE_FINISHED`) → `409 RACE_NOT_OPEN`.
- **Identificadores de oleada y de desempate (`heat_id`, `tiebreak_id`):** texto libre de hasta 120 caracteres, **únicos en toda la plataforma**
  (usa UUID, o derívalos de un `stage_id`, como hace el motor: `<stage_id>-r1-h<n>`). Los `stage_id`, `registration_id` y `client_event_id` sí son UUID.

### Eventos soportados en `engine-v0.2.0` (19)

| Tipo | Payload |
|---|---|
| `RACE_STARTED` | `{}` |
| `PAIRING_SET` | `{ stage_id, run_number, source: "fedocr\|same_as_previous\|random\|manual\|seeded", heats: [{ heat_id, heat_number, left, right\|null }] }` — reemplaza todas las oleadas **pendientes** de esa salida (se pueden reutilizar los mismos `heat_id`), conserva las que ya corrieron y debe cubrir **exactamente una vez** a cada atleta habilitado. Las oleadas de la salida 2 en adelante las crea la app con `heat_id` único. |
| `LANES_SWAPPED` | `{ heat_id }` |
| `RUN_SKIPPED` | `{ heat_id, registration_id, skipped: true\|false }` — `false` deshace el "no corre" antes de la salida |
| `HEAT_STARTED` | `{ heat_id, started_at_ms }` — hora real de la salida (epoch ms) |
| `ARRIVAL_MARKED` | `{ heat_id, lane: "left\|right", elapsed_ms, arrival_order }` — `arrival_order` debe ser el **siguiente libre**; si no, `ARRIVAL_ORDER_MISMATCH` |
| `RUN_NOT_FINISHED` | `{ heat_id, registration_id, note }` — la observación es opcional (puede ir vacía) |
| `HEAT_REVIEWED` | `{ heat_id, note, swap_arrivals }` — observación obligatoria |
| `HEAT_REOPENED` | `{ heat_id, note }` — observación obligatoria |
| `HEAT_CONFIRMED` | `{ heat_id }` — también para una oleada pendiente donde nadie corre (todos "no corre" o retirados) |
| `ATHLETE_WITHDRAWN` | `{ registration_id, stage_id, heat_id\|null, reason: "rule_violation\|voluntary\|injury\|other", note }` — observación obligatoria. Conserva los tiempos ya registrados; los carriles pendientes pasan a `withdrawn` y la pareja corre sola. |

Eventos agregados en `engine-v0.2.0`:

| Tipo | Payload |
|---|---|
| `STAGE_CLOSED` | `{ stage_id }` — exige la instancia con todas las salidas resueltas y sin empate pendiente en el corte. Fija `final_order` y `qualified`, abre la siguiente instancia y arma su salida 1 **primero contra último**, con oleadas de `heat_id = <stage_id>-r1-h<n>` (la app **no** las crea). En la final, `qualified = []`. |
| `TIEBREAK_STARTED` | `{ tiebreak_id, stage_id, registration_ids, note, heats: [{ heat_id, heat_number, left, right\|null }] }` — oleadas de desempate (`kind: "tiebreak"`, `run_number: 0`); sus tiempos **no cuentan** para la clasificación. |
| `TIEBREAK_DECIDED` | `{ stage_id, tiebreak_id\|null, resolution: "direct\|runoff", registration_ids, order, note }` — fija el orden de los empatados en el corte. `runoff` exige todas las oleadas del desempate confirmadas; `direct` va con `tiebreak_id: null`. |
| `RUN_RESTARTED` | `{ stage_id, run_number, note, heats: [...] }` — protocolo de lluvia: anula las oleadas de la salida actual (`status: "voided"`) y crea las nuevas (`pairing_source: "restart"`). Observación obligatoria. |
| `RUN_VOIDED` | `{ stage_id, run_number, note }` — protocolo de lluvia: anula la salida actual; queda resuelta y se pasa a la siguiente. Observación obligatoria. |
| `RACE_FINISHED` | `{}` — exige todas las instancias cerradas (`STAGES_OPEN`). |
| `DEVICE_TAKEOVER`, `BACKUP_IMPORTED` | `{}` — no cambian las reglas; quedan en el historial. |

`ATHLETE_WITHDRAWN` de un **clasificado** antes de que empiece la instancia siguiente se envía con el `stage_id` de **esa instancia** y
`heat_id: null`: sube el siguiente mejor tiempo de la instancia anterior y la salida 1 se arma de nuevo.

### Qué ven el panel y la vista pública (`GET /state`)

- Clasificados oficiales: `stages[].qualified` y `stages[].final_order`, **solo con la instancia cerrada**. Abierta, la posición del `ranking` es provisional y
  `cut_tie` lista a los empatados en el corte que el juez aún debe decidir.
- Oleada anulada por lluvia: `status: "voided"` y, en cada carril, `outcome: "voided"` **conservando** `elapsed_ms` (el tiempo original se muestra como anulado
  y no cuenta). `stages[].voided_runs` y `rain_actions` dicen qué salidas se anularon y por qué.
- Desempates: `tiebreaks[]` y `stages[].tie_decisions` (con su observación).

## 7. Reglas de competencia que aplica el servidor (las del motor)

- Una sola oleada en pista por carrera, incluso entre categorías (hay una pista). La siguiente salida se habilita cuando terminan
  todas las oleadas de la actual.
- Un tiempo **cuenta solo cuando su oleada está confirmada**. `HEAT_REOPENED` lo deja de contar hasta que se confirme de nuevo.
- Clasificación de una instancia: mejor tiempo (en centésimas truncadas); si empatan, los siguientes tiempos de mejor a peor; a quien
  le falte el tiempo comparado queda después; si persiste el empate, `tied_with_previous = true` (lo decide el juez con `TIEBREAK_*`).
- Los retirados y los atletas sin tiempo van al final, **sin posición**. Un atleta puede no correr una salida y conservar sus tiempos.
- Si un atleta sale y no llega queda `did_not_finish`, sin tiempo en esa salida.
- **Empate en el corte:** un empate total que cruza el número de clasificados impide cerrar la instancia (`TIE_UNRESOLVED`) hasta que el juez lo decida,
  directamente o haciendo correr a los empatados. Los empates que no afectan el corte comparten posición.
- **Lluvia:** solo sobre la salida actual de una instancia abierta con más de 1 salida y con observación. Anular la última salida exige que quede algún tiempo válido.
  Los tiempos anulados se conservan, no cuentan y nunca se borran.
- **Correcciones después de cerrar una instancia:** las hace solo un administrador (ver preguntas abiertas con Timer_track).

## 8. Códigos de rechazo

**Del motor (los mismos que la app, 35):** `RACE_NOT_STARTED`, `RACE_ALREADY_STARTED`, `RACE_ALREADY_FINISHED`, `STAGE_NOT_FOUND`, `STAGE_NOT_OPEN`, `STAGES_OPEN`,
`HEAT_NOT_FOUND`, `INVALID_HEAT_STATE`, `SECOND_ACTIVE_HEAT`, `HEAT_IN_PROGRESS`, `RUN_NOT_OPEN`, `RUN_CLOSED`, `RUN_NOT_CURRENT`, `RUNS_NOT_FINISHED`,
`NO_RUNNERS`, `HEAT_HAS_RUNNERS`, `LANE_EMPTY`, `LANE_NOT_PENDING`, `ATHLETE_NOT_IN_HEAT`, `ATHLETE_NOT_IN_STAGE`, `ATHLETE_WITHDRAWN`, `INVALID_TIME`,
`ARRIVAL_ORDER_MISMATCH`, `NOTE_REQUIRED`, `NOTHING_TO_SWAP`, `INVALID_PAIRING`, `TIE_UNRESOLVED`, `TIEBREAK_PENDING`, `TIEBREAK_NOT_FOUND`,
`TIEBREAK_GROUP_MISMATCH`, `INVALID_TIEBREAK_ORDER`, `NO_QUALIFIERS`, `RAIN_NOT_ALLOWED`, `NO_VALID_TIMES_LEFT`, `NOT_SUPPORTED_YET`.

**Del servidor (no son reglas de competencia):**

| Código | Dónde | Significado |
|---|---|---|
| `UNSUPPORTED_EVENT_TYPE` | evento en `sync` | El tipo no está en `supported_event_types` |
| `INVALID_PAYLOAD` | evento en `sync` | El JSON del evento no cumple el formato |
| `SEQUENCE_GAP` | evento en `sync` | Falta un `device_seq` anterior; reenviar desde `next_expected_seq` |
| `DEVICE_NOT_ACTIVE` | evento en `sync` | El dispositivo no es el activo de la carrera |
| `DEVICE_ALREADY_ACTIVE` | HTTP 409 en `device/activate` | Hay otro dispositivo activo; falta la observación |
| `RACE_NOT_OPEN` | HTTP 409 en `sync` | La carrera no está `approved` ni `in_progress` (ni `finished` por `RACE_FINISHED`) |
| `CONCURRENT_SYNC` / `CONCURRENT_ACTIVATION` | HTTP 409 | Otra operación simultánea; reintentar |
| `UNAUTHORIZED` (401), `FORBIDDEN_ROLE` (403), `NOT_FOUND` (404), `BAD_REQUEST` (400), `INVALID_CREDENTIALS` (401), `INVALID_REFRESH_TOKEN` (401) | HTTP | |

## 9. Carrera de prueba
La carrera de prueba (2 categorías, juez de prueba y parejas iniciales) se entrega con sus credenciales por separado. Es una carrera
**no real**, en una liga de pruebas, que no aparece en el sitio público.
