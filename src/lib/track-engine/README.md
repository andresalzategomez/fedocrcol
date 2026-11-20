# Motor de reglas de Timer_track — guía de integración

**Versión del núcleo: 0.2.0** (`ENGINE_VERSION`).
Fuente en Timer_track: `src/lib/engine/core/`. Casos dorados: `docs/golden/`.

## 1. Qué es

El núcleo aplica las reglas de las carreras track a una lista de eventos y devuelve el estado de la carrera: oleadas, salidas, tiempos, retiros, clasificación, cierre de instancias, desempates y protocolo de lluvia.

- **TypeScript puro**, sin dependencias externas: no usa Zod, React ni librerías.
- **Sin APIs del navegador**: no usa DOM, IndexedDB, localStorage ni `window`.
- **Determinista**: los mismos eventos producen siempre el mismo estado. Trabaja con milisegundos enteros.
- **Requisito de entorno**: `structuredClone` (Node 17+, navegadores modernos, Cloudflare Workers).
- El azar solo existe en `randomPairing`, que usa la app para proponer parejas. Las parejas viajan ya armadas en los eventos, así que el servidor nunca necesita azar.
- Las oleadas que crea el propio motor al abrir una instancia o al subir un atleta tienen identificadores deterministas: `<stage_id>-r1-h<n>`.

## 2. Archivos

| Archivo | Contenido |
|---|---|
| `core/types.ts` | Tipos de configuración y estado |
| `core/events.ts` | Tipos de los eventos y `SUPPORTED_EVENT_TYPES` |
| `core/reducer.ts` | `createInitialState`, `applyEvent`, `replay`, `EngineError` y los códigos de rechazo |
| `core/selectors.ts` | Consultas: salida actual, resultados, clasificación, empate en el corte, orden final y avance |
| `core/ranking.ts` | Orden de clasificación y desempate por tiempos |
| `core/pairing.ts` | Parejas: aleatoria, igual que la anterior, primero contra último e intercambio |
| `core/time.ts` | Centésimas truncadas y formato de tiempos |
| `core/golden.ts` | `summarizeOutcome` y `runGoldenCase` para los casos dorados |
| `core/index.ts` | Exporta todo y `ENGINE_VERSION` |

## 3. Uso en el servidor

```ts
import { replay, applyEvent, EngineError, stageRanking, type RaceConfig, type TrackEvent } from './core';

// 1. Configuración de la carrera, armada desde las tablas de fedocrcol.
const config: RaceConfig = buildConfigFromTables(raceId);

// 2. Estado actual: todos los eventos aceptados de la carrera, en orden.
const { state } = replay(config, acceptedEvents);

// 3. Validar y aplicar un evento nuevo.
try {
  const next = applyEvent(state, incoming); // lanza EngineError si viola una regla
  // guardar incoming como aceptado
} catch (e) {
  if (e instanceof EngineError) rejectWith(e.code, e.message);
  else throw e;
}

// 4. Clasificación de una instancia (posición provisional mientras esté abierta).
const ranking = stageRanking(state, stageId);
// Instancia cerrada: orden y clasificados oficiales.
const { finalOrder, qualified } = state.stages[stageId];
```

## 4. Configuración desde las tablas

| `RaceConfig` | Origen en fedocrcol |
|---|---|
| `raceId` | `events.id` |
| `categories[].id`, `name` | `event_categories` |
| `categories[].athletes[]` | `registrations` con pago confirmado y dorsal: `registrationId` = `id`, `bib`, `name` |
| `categories[].stages[]` | `track_stages`: `id`, `stageNumber`, `name`, `runsPerAthlete`, `qualifiersCount` |
| `initialHeats[]` | Oleadas de instancia 1, salida 1 (`track_heats` + `track_heat_lanes` con `pairing_source = 'fedocr'`) |

Las instancias 2 en adelante no necesitan oleadas iniciales: el motor las arma al cerrar la anterior.

## 5. Eventos: de la API al núcleo

El sobre del evento usa camelCase en el núcleo y snake_case en la API. Los payloads son iguales.

| API (`/sync`) | Núcleo |
|---|---|
| `client_event_id` | `clientEventId` |
| `device_seq` | `deviceSeq` |
| `occurred_at` | `occurredAt` |
| `type`, `payload` | `type`, `payload` |

- **Validación:** el núcleo supone que el evento ya fue validado. El servidor debe validar el JSON con sus propios esquemas (por ejemplo, Zod 3) antes de llamar a `applyEvent`.
- **Payloads completos:** los eventos llegan desde la app con todos sus campos.
- **Eventos soportados:** `SUPPORTED_EVENT_TYPES` lista todos los tipos de esta versión. El `supported_event_types` del servidor es esa lista o un subconjunto.

### Eventos nuevos en 0.2.0

| Tipo | Payload | Efecto |
|---|---|---|
| `STAGE_CLOSED` | `{ stage_id }` | Fija `finalOrder` y `qualified`. Abre la siguiente instancia con los clasificados y arma su salida 1 con primero contra último. En la final, `qualified = []` |
| `TIEBREAK_STARTED` | `{ tiebreak_id, stage_id, registration_ids, note, heats[] }` | Crea oleadas de desempate (`kind = 'tiebreak'`, `runNumber = 0`). Sus tiempos no cuentan para la clasificación |
| `TIEBREAK_DECIDED` | `{ stage_id, tiebreak_id \| null, resolution: 'direct' \| 'runoff', registration_ids, order, note }` | Fija el orden de los empatados en el corte. `runoff` exige todas las oleadas del desempate confirmadas |
| `RUN_RESTARTED` | `{ stage_id, run_number, note, heats[] }` | Protocolo de lluvia: anula las oleadas de la salida actual (`status = 'voided'`) y crea las nuevas |
| `RUN_VOIDED` | `{ stage_id, run_number, note }` | Protocolo de lluvia: anula la salida actual; la salida queda resuelta y se pasa a la siguiente |
| `RACE_FINISHED` | `{}` | Exige todas las instancias cerradas. Después se rechaza cualquier evento de reglas |
| `DEVICE_TAKEOVER`, `BACKUP_IMPORTED` | `{}` | No cambian las reglas; se aceptan para mantener el historial |

`ATHLETE_WITHDRAWN` también cambia: si el atleta está en una instancia que **no ha empezado** (instancia 2 en adelante), sube el siguiente mejor tiempo de la instancia anterior y la salida 1 se vuelve a armar.

## 6. Códigos de rechazo (35)

`RACE_NOT_STARTED`, `RACE_ALREADY_STARTED`, `RACE_ALREADY_FINISHED`, `STAGE_NOT_FOUND`, `STAGE_NOT_OPEN`, `STAGES_OPEN`, `HEAT_NOT_FOUND`, `INVALID_HEAT_STATE`, `SECOND_ACTIVE_HEAT`, `HEAT_IN_PROGRESS`, `RUN_NOT_OPEN`, `RUN_CLOSED`, `RUN_NOT_CURRENT`, `RUNS_NOT_FINISHED`, `NO_RUNNERS`, `HEAT_HAS_RUNNERS`, `LANE_EMPTY`, `LANE_NOT_PENDING`, `ATHLETE_NOT_IN_HEAT`, `ATHLETE_NOT_IN_STAGE`, `ATHLETE_WITHDRAWN`, `INVALID_TIME`, `ARRIVAL_ORDER_MISMATCH`, `NOTE_REQUIRED`, `NOTHING_TO_SWAP`, `INVALID_PAIRING`, `TIE_UNRESOLVED`, `TIEBREAK_PENDING`, `TIEBREAK_NOT_FOUND`, `TIEBREAK_GROUP_MISMATCH`, `INVALID_TIEBREAK_ORDER`, `NO_QUALIFIERS`, `RAIN_NOT_ALLOWED`, `NO_VALID_TIMES_LEFT`, `NOT_SUPPORTED_YET`.

`NOT_SUPPORTED_YET` queda reservado para tipos futuros. Del lado del servidor se agregan `UNSUPPORTED_EVENT_TYPE`, `SEQUENCE_GAP` y `DEVICE_NOT_ACTIVE`, que no son reglas de competencia.

## 7. Reglas clave

- Tiempos en milisegundos; comparación en centésimas truncadas (32.489 s = 32.48).
- Un tiempo cuenta solo cuando su oleada está confirmada. `HEAT_REOPENED` lo deja de contar hasta confirmarse de nuevo.
- Clasificación: mejor tiempo; si empatan, los siguientes tiempos de mejor a peor; a quien le falte el tiempo comparado, queda después; si persiste, `tiedWithPrevious = true`.
- **Empate en el corte** (`cutTie`): un empate total que atraviesa el número de clasificados. La instancia no cierra hasta que el juez lo decide, de forma directa o corriendo. Los empates que no afectan el corte comparten posición.
- Retirados y atletas sin tiempo van al final, sin posición.
- Una sola oleada activa por carrera, incluidas las de desempate. La siguiente salida se habilita al terminar toda la salida actual.
- **Protocolo de lluvia:** solo sobre la salida actual de una instancia abierta con más de 1 salida, con observación. Anular la última salida exige que quede algún tiempo válido. Los tiempos anulados se conservan (`RunResult.kind = 'voided'`, con su `ms`) y no cuentan.
- Una salida anulada se considera resuelta: la salida actual pasa a la siguiente.

## 8. Casos dorados

Cada archivo de `docs/golden/` tiene `config`, `events` y `expected`. Ambos sistemas deben producir exactamente `expected`.

```bash
npx tsx run-golden.ts golden
```

| Caso | Qué valida |
|---|---|
| `clasificacion-40-atletas` | 40 atletas, 3 salidas, 60 oleadas y clasificación de 40 |
| `no-corre-una-salida` | Conserva el tiempo anterior; la pareja sale sola |
| `sale-y-no-llega` | Sin tiempo en esa salida; la oleada se confirma |
| `revision-y-reapertura` | Intercambio de llegadas y reapertura con observación |
| `retiro-durante-la-instancia` | Retirado sin posición, al final, y sin oleadas nuevas |
| `reglas-de-pista-y-rechazos` | Los rechazos principales, en orden |
| `empates-por-tiempos` | Centésimas truncadas, segundo tiempo, empate total y tiempo faltante |
| `cierre-final-y-fin` | Cierre, clasificados, final con primero contra último y fin de la competencia |
| `empate-en-corte-decision-directa` | Empate en el corte decidido directamente por el juez |
| `empate-en-corte-desempate-corriendo` | Desempate corriendo; sus tiempos no cambian la clasificación |
| `retiro-de-clasificado` | Sube el siguiente antes de empezar; después, la pareja corre sola |
| `lluvia-reiniciar-salida` | Salida reiniciada con la oleada en pista anulada |
| `lluvia-anular-salida-2-de-3` | Ejemplo de la federación: salida 2 anulada y clasificación con las salidas 1 y 3 |
| `lluvia-reglas-y-rechazos` | Sin observación, sin tiempos válidos y final de 1 salida |

## 9. Versiones

| Versión | Contenido |
|---|---|
| 0.1.0 | Oleadas, salidas, parejas, llegadas, revisión, reapertura, no corre, no terminó, retiro y clasificación provisional |
| 0.2.0 | Cierre de instancia, clasificados, siembra de la siguiente instancia, desempates del juez, retiro de clasificados, protocolo de lluvia y fin de la competencia |

Cada entrega lleva etiqueta Git `engine-vX.Y.Z`. Al actualizar, se copia el núcleo completo y se corren los casos dorados nuevos. Los casos de 0.1.0 cambian de formato en 0.2.0 (el resumen incluye más campos); se reemplazan todos.
