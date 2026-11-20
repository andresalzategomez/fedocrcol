import type { Lane, PairingSource, WithdrawalReason } from './types';

/**
 * Eventos del juez, como tipos puros (sin dependencias).
 * La validación de datos externos (JSON de la API o de un respaldo) se hace fuera del núcleo:
 * en Timer_track con Zod (src/lib/engine/schemas.ts); en el servidor, con su propio validador.
 *
 * Los payloads usan snake_case, igual que la API. El sobre (clientEventId, deviceSeq, occurredAt)
 * usa camelCase; en la API se llaman client_event_id, device_seq y occurred_at.
 */

interface Envelope<T extends string, P> {
  clientEventId: string;
  /** Orden del evento en el dispositivo que lo generó (por carrera). */
  deviceSeq: number;
  /** ISO 8601. Informativo: no interviene en las reglas, salvo como fecha de notas y retiros. */
  occurredAt: string;
  type: T;
  payload: P;
}

/** Payload sin campos. */
export type EmptyPayload = Record<string, unknown>;

export interface PairingDraft {
  heat_id: string;
  heat_number: number;
  left: string;
  right: string | null;
}

export type TrackEvent =
  | Envelope<'RACE_STARTED', EmptyPayload>
  | Envelope<'PAIRING_SET', { stage_id: string; run_number: number; source: PairingSource; heats: PairingDraft[] }>
  | Envelope<'LANES_SWAPPED', { heat_id: string }>
  | Envelope<'RUN_SKIPPED', { heat_id: string; registration_id: string; skipped: boolean }>
  | Envelope<'HEAT_STARTED', { heat_id: string; started_at_ms: number }>
  | Envelope<'ARRIVAL_MARKED', { heat_id: string; lane: Lane; elapsed_ms: number; arrival_order: number }>
  | Envelope<'RUN_NOT_FINISHED', { heat_id: string; registration_id: string; note: string }>
  | Envelope<'HEAT_REVIEWED', { heat_id: string; note: string; swap_arrivals: boolean }>
  | Envelope<'HEAT_REOPENED', { heat_id: string; note: string }>
  | Envelope<'HEAT_CONFIRMED', { heat_id: string }>
  | Envelope<
      'ATHLETE_WITHDRAWN',
      { registration_id: string; stage_id: string; heat_id: string | null; reason: WithdrawalReason; note: string }
    >
  | Envelope<
      'TIEBREAK_STARTED',
      { tiebreak_id: string; stage_id: string; registration_ids: string[]; note: string; heats: PairingDraft[] }
    >
  | Envelope<
      'TIEBREAK_DECIDED',
      {
        stage_id: string;
        tiebreak_id: string | null;
        resolution: 'direct' | 'runoff';
        registration_ids: string[];
        order: string[];
        note: string;
      }
    >
  | Envelope<'STAGE_CLOSED', { stage_id: string }>
  | Envelope<'RUN_RESTARTED', { stage_id: string; run_number: number; note: string; heats: PairingDraft[] }>
  | Envelope<'RUN_VOIDED', { stage_id: string; run_number: number; note: string }>
  | Envelope<'RACE_FINISHED', EmptyPayload>
  // Eventos de dispositivo y respaldo: los procesa el almacenamiento y la sincronización, no las reglas.
  | Envelope<'DEVICE_TAKEOVER', EmptyPayload>
  | Envelope<'BACKUP_IMPORTED', EmptyPayload>;

export type TrackEventType = TrackEvent['type'];
export type PayloadOf<T extends TrackEventType> = Extract<TrackEvent, { type: T }>['payload'];

/** Lo que la interfaz pide registrar; el almacenamiento completa id, orden y fecha. */
export type EventInput = TrackEvent extends infer E ? (E extends TrackEvent ? Pick<E, 'type' | 'payload'> : never) : never;

/** Tipos que el núcleo aplica en esta versión. Los demás se rechazan con NOT_SUPPORTED_YET. */
export const SUPPORTED_EVENT_TYPES = [
  'RACE_STARTED',
  'PAIRING_SET',
  'LANES_SWAPPED',
  'RUN_SKIPPED',
  'HEAT_STARTED',
  'ARRIVAL_MARKED',
  'RUN_NOT_FINISHED',
  'HEAT_REVIEWED',
  'HEAT_REOPENED',
  'HEAT_CONFIRMED',
  'ATHLETE_WITHDRAWN',
  'TIEBREAK_STARTED',
  'TIEBREAK_DECIDED',
  'STAGE_CLOSED',
  'RUN_RESTARTED',
  'RUN_VOIDED',
  'RACE_FINISHED',
  'DEVICE_TAKEOVER',
  'BACKUP_IMPORTED',
] as const satisfies readonly TrackEventType[];
