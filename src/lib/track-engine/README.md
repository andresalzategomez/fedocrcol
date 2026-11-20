# Motor de reglas de Timer_track — guía de integración

**Versión del núcleo: 0.1.0** (`ENGINE_VERSION`).
Fuente en Timer_track: `src/lib/engine/core/`. Casos dorados: `docs/golden/`.

## 1. Qué es

El núcleo aplica las reglas de las carreras track a una lista de eventos y devuelve el estado de la carrera: oleadas, salidas, tiempos, retiros y clasificación.

- **TypeScript puro**, sin dependencias externas: no usa Zod, React ni librerías.
- **Sin APIs del navegador**: no usa DOM, IndexedDB, localStorage ni `window`.
- **Determinista**: los mismos eventos producen siempre el mismo estado. Trabaja con milisegundos enteros.
- **Requisito de entorno**: `structuredClone` (Node 17+, navegadores modernos, Cloudflare Workers).
- El azar solo existe en `randomPairing`, que usa la app para proponer parejas. Las parejas viajan ya armadas en `PAIRING_SET`, así que el servidor nunca necesita azar.

## 2. Archivos

| Archivo | Contenido |
|---|---|
| `core/types.ts` | Tipos de configuración y estado |
| `core/events.ts` | Tipos de los eventos y `SUPPORTED_EVENT_TYPES` |
| `core/reducer.ts` | `createInitialState`, `applyEvent`, `replay`, `EngineError` y los 22 códigos |
| `core/selectors.ts` | Consultas: salida actual, resultados, clasificación y avance |
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

// 4. Clasificación de una instancia.
const ranking = stageRanking(state, stageId);
```

## 4. Configuración desde las tablas

| `RaceConfig` | Origen en fedocrcol |
|---|---|
| `raceId` | `events.id` |
| `categories[].id`, `name` | `event_categories` |
| `categories[].athletes[]` | `registrations` con pago confirmado y dorsal: `registrationId` = `id`, `bib`, `name` |
| `categories[].stages[]` | `track_stages`: `id`, `stageNumber`, `name`, `runsPerAthlete`, `qualifiersCount` |
| `initialHeats[]` | Oleadas de instancia 1, salida 1 (`track_heats` + `track_heat_lanes` con `pairing_source = 'fedocr'`) |

## 5. Eventos: de la API al núcleo

El sobre del evento usa camelCase en el núcleo y snake_case en la API. Los payloads son iguales.

| API (`/sync`) | Núcleo |
|---|---|
| `client_event_id` | `clientEventId` |
| `device_seq` | `deviceSeq` |
| `occurred_at` | `occurredAt` |
| `type`, `payload` | `type`, `payload` |

- **Validación:** el núcleo supone que el evento ya fue validado. El servidor debe validar el JSON con sus propios esquemas (por ejemplo, Zod 3) antes de llamar a `applyEvent`.
- **Payloads completos:** los eventos llegan desde la app con todos sus campos. `RUN_SKIPPED.skipped` y `RUN_NOT_FINISHED.note` siempre vienen informados.
- **Eventos soportados:** `SUPPORTED_EVENT_TYPES` lista los tipos que aplica esta versión. Los demás se rechazan con `NOT_SUPPORTED_YET`. El `supported_event_types` del servidor no debe incluir tipos que esta versión no soporte.

## 6. Códigos de rechazo (22)

`RACE_NOT_STARTED`, `RACE_ALREADY_STARTED`, `STAGE_NOT_FOUND`, `STAGE_NOT_OPEN`, `HEAT_NOT_FOUND`, `INVALID_HEAT_STATE`, `SECOND_ACTIVE_HEAT`, `RUN_NOT_OPEN`, `RUN_CLOSED`, `NO_RUNNERS`, `HEAT_HAS_RUNNERS`, `LANE_EMPTY`, `LANE_NOT_PENDING`, `ATHLETE_NOT_IN_HEAT`, `ATHLETE_NOT_IN_STAGE`, `ATHLETE_WITHDRAWN`, `INVALID_TIME`, `ARRIVAL_ORDER_MISMATCH`, `NOTE_REQUIRED`, `NOTHING_TO_SWAP`, `INVALID_PAIRING`, `NOT_SUPPORTED_YET`.

Del lado del servidor se agregan `UNSUPPORTED_EVENT_TYPE`, `SEQUENCE_GAP` y `DEVICE_NOT_ACTIVE`, que no son reglas de competencia.

## 7. Reglas clave

- Tiempos en milisegundos; comparación en centésimas truncadas (32.489 s = 32.48).
- Un tiempo cuenta solo cuando su oleada está confirmada. `HEAT_REOPENED` lo deja de contar hasta confirmarse de nuevo.
- Clasificación: mejor tiempo; si empatan, los siguientes tiempos de mejor a peor; a quien le falte el tiempo comparado, queda después; si persiste, `tiedWithPrevious = true` (decide el juez, en v0.2).
- Retirados y atletas sin tiempo van al final, sin posición.
- Una sola oleada activa por carrera. La siguiente salida se habilita al terminar toda la salida actual.

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

## 9. Versiones

| Versión | Contenido |
|---|---|
| 0.1.0 | Oleadas, salidas, parejas, llegadas, revisión, reapertura, no corre, no terminó, retiro y clasificación provisional |
| 0.2.0 | Cierre de instancia, clasificados, desempates del juez y retiros de clasificados |
| 0.3.0 | Protocolo de lluvias |

Cada entrega lleva etiqueta Git `engine-vX.Y.Z`. Al actualizar, se copia el núcleo completo y se corren los casos dorados nuevos.
