import { z } from "zod";
import { SUPPORTED_EVENT_TYPES, type TrackEvent } from "../../track-engine/core";

/**
 * Validación del JSON de /sync antes de llamar al motor: el motor supone eventos ya validados.
 * Los payloads usan snake_case, igual que la API. Zod 3 (el motor no depende de Zod).
 */

const uuid = z.string().uuid();
const lane = z.enum(["left", "right"]);
const note = z.string().max(2000);

export const envelopeSchema = z.object({
  client_event_id: uuid,
  device_seq: z.number().int().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  type: z.string().min(1).max(60),
  payload: z.record(z.unknown()).default({}),
});
export type Envelope = z.infer<typeof envelopeSchema>;

const payloadSchemas: Record<(typeof SUPPORTED_EVENT_TYPES)[number], z.ZodTypeAny> = {
  RACE_STARTED: z.object({}).passthrough(),
  PAIRING_SET: z.object({
    stage_id: uuid,
    run_number: z.number().int().min(1),
    source: z.enum(["fedocr", "same_as_previous", "random", "manual", "seeded"]),
    heats: z.array(z.object({ heat_id: uuid, heat_number: z.number().int().min(1), left: uuid, right: uuid.nullable() })).max(500),
  }),
  LANES_SWAPPED: z.object({ heat_id: uuid }),
  RUN_SKIPPED: z.object({ heat_id: uuid, registration_id: uuid, skipped: z.boolean() }),
  HEAT_STARTED: z.object({ heat_id: uuid, started_at_ms: z.number().int().min(0) }),
  ARRIVAL_MARKED: z.object({ heat_id: uuid, lane, elapsed_ms: z.number().int(), arrival_order: z.number().int().min(1) }),
  RUN_NOT_FINISHED: z.object({ heat_id: uuid, registration_id: uuid, note }),
  HEAT_REVIEWED: z.object({ heat_id: uuid, note, swap_arrivals: z.boolean() }),
  HEAT_REOPENED: z.object({ heat_id: uuid, note }),
  HEAT_CONFIRMED: z.object({ heat_id: uuid }),
  ATHLETE_WITHDRAWN: z.object({
    registration_id: uuid,
    stage_id: uuid,
    heat_id: uuid.nullable(),
    reason: z.enum(["rule_violation", "voluntary", "injury", "other"]),
    note,
  }),
};

export function isSupportedType(type: string): type is (typeof SUPPORTED_EVENT_TYPES)[number] {
  return (SUPPORTED_EVENT_TYPES as readonly string[]).includes(type);
}

/** Valida el payload de un tipo soportado y arma el evento en el formato del motor (camelCase en el sobre). */
export function toEngineEvent(env: Envelope): { ok: true; event: TrackEvent } | { ok: false; message: string } {
  if (!isSupportedType(env.type)) return { ok: false, message: `Tipo de evento no soportado: ${env.type}` };
  const parsed = payloadSchemas[env.type].safeParse(env.payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).slice(0, 3).join("; ") };
  }
  return {
    ok: true,
    event: {
      clientEventId: env.client_event_id,
      deviceSeq: env.device_seq,
      occurredAt: env.occurred_at,
      type: env.type,
      payload: parsed.data,
    } as TrackEvent,
  };
}

export const syncBodySchema = z.object({
  device_id: z.string().min(3).max(120),
  events: z.array(z.unknown()).max(200),
});

export const activateBodySchema = z.object({
  device_id: z.string().min(3).max(120),
  takeover_note: z.string().trim().max(500).optional(),
});
