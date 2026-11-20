import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

const recordSchema = z.object({
  id: z.string(), // id del registro en el cliente (idempotencia): debe ser un UUID
  bib_number: z.number().int(),
  split_id: z.string().nullable().optional(), // checkpoint; null = meta directa
  exact_timestamp: z.number().int(), // epoch ms de la lectura
  penalty_seconds: z.number().int().default(0),
  net_time_ms: z.number().int().nullable().optional(),
  status: z.enum(["OK", "DNF", "DSQ", "DNS"]).default("OK"),
  wave_id: z.string().nullable().optional(),
});

const bodySchema = z.object({
  race_id: z.string(),
  records: z.array(recordSchema).min(1),
});

const STATUS_MAP: Record<string, string> = {
  OK: "finished",
  DNF: "dnf",
  DSQ: "dsq",
  DNS: "dns",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles que pueden enviar tiempos: el administrador de la liga, la federación y los jueces (solo sus checkpoints). */
const ALLOWED_ROLES = new Set(["admin", "superadmin", "judge"]);

/**
 * POST /api/v1/time-records/batch
 * Recibe un lote de tiempos calculados offline por el Timer y los persiste.
 * Devuelve { synced_ids, failed_ids: [{ id, reason }] } (+ ignored_ids, informativo).
 * El net_time_ms del Timer es autoritativo (results.source = 'timer').
 *
 * Seguridad: solo admin/superadmin de la liga y jueces. Un juez solo puede enviar lecturas de los
 * checkpoints que tiene asignados. Las escrituras se hacen con el JWT del usuario (RLS vuelve a validar
 * el rol, la liga y que la carrera esté en curso para los jueces); la lectura de inscripciones y
 * checkpoints usa service_role solo para resolver dorsales (un juez no tiene permiso de lectura sobre
 * inscripciones y de otro modo no se podría resolver el dorsal).
 *
 * Fiabilidad: cada escritura se revisa; un registro solo cuenta como sincronizado si realmente quedó guardado.
 * Idempotencia: un reintento (mismo id) no vuelve a tocar el resultado, y un registro más viejo que el
 * resultado ya guardado, o un resultado corregido a mano (source = 'manual'), nunca se sobrescriben.
 */
export const Route = createFileRoute("/api/v1/time-records/batch")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { supa, leagueId, role, userId } = await authenticate(request);
        if (!ALLOWED_ROLES.has(role)) {
          return apiError("FORBIDDEN", "Tu rol no puede enviar tiempos", 403);
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiError("BAD_REQUEST", "Formato de lote inválido", 400);
        }
        const { race_id, records } = parsed.data;
        if (!UUID_RE.test(race_id)) return apiError("BAD_REQUEST", "race_id inválido", 400);

        const admin = serviceClient();

        // La carrera debe ser de la liga del token y estándar (las track no se operan por /api/v1).
        const { data: race, error: raceErr } = await admin
          .from("events")
          .select("id, race_format")
          .eq("id", race_id)
          .eq("tenant_id", leagueId)
          .maybeSingle();
        if (raceErr) return apiError("DB_ERROR", raceErr.message, 500);
        if (!race || race.race_format === "track") return apiError("NOT_FOUND", "Carrera no encontrada", 404);

        // Inscripciones (bib -> {id, athlete_id}), checkpoints (id -> is_finish) y, para jueces, los checkpoints asignados.
        const [{ data: regs, error: regsErr }, { data: cps, error: cpsErr }, assigned] = await Promise.all([
          admin.from("registrations").select("id, bib_number, athlete_id").eq("event_id", race_id).eq("tenant_id", leagueId),
          admin.from("checkpoints").select("id, is_finish").eq("event_id", race_id),
          role === "judge"
            ? admin.from("checkpoint_judges").select("checkpoint_id").eq("judge_id", userId)
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (regsErr || cpsErr || assigned.error) {
          return apiError("DB_ERROR", (regsErr ?? cpsErr ?? assigned.error)?.message ?? "Error leyendo la carrera", 500);
        }

        // bib_number en la BD es texto con ceros a la izquierda ("0001"), pero el
        // Timer siempre lo envía como número (su coerceBib lo normaliza así) — se
        // compara parseando ambos lados a entero, sin importar el formato de guardado.
        const regByBib = new Map<number, { id: string; athlete_id: string | null }>();
        (regs ?? []).forEach((r) => {
          const bib = parseInt(String(r.bib_number), 10);
          if (Number.isFinite(bib)) regByBib.set(bib, { id: r.id, athlete_id: r.athlete_id });
        });
        const finishById = new Map<string, boolean>();
        (cps ?? []).forEach((c) => finishById.set(c.id, c.is_finish as boolean));

        // Un juez solo envía lecturas de sus checkpoints; la meta directa (sin checkpoint) solo si tiene asignado uno de meta.
        const assignedIds = new Set((assigned.data ?? []).map((a) => a.checkpoint_id as string));
        const judgeHasFinish = [...assignedIds].some((id) => finishById.get(id) === true);

        const synced_ids: string[] = [];
        const failed_ids: { id: string; reason: string }[] = [];
        const ignored_ids: { id: string; reason: string }[] = [];

        for (const rec of records) {
          try {
            if (!UUID_RE.test(rec.id)) {
              failed_ids.push({ id: rec.id, reason: "INVALID_RECORD_ID" });
              continue;
            }
            const reg = regByBib.get(rec.bib_number);
            if (!reg) {
              failed_ids.push({ id: rec.id, reason: "ATHLETE_NOT_FOUND" });
              continue;
            }
            if (rec.split_id && !finishById.has(rec.split_id)) {
              failed_ids.push({ id: rec.id, reason: "SPLIT_NOT_FOUND" });
              continue;
            }
            if (role === "judge") {
              const allowed = rec.split_id ? assignedIds.has(rec.split_id) : judgeHasFinish;
              if (!allowed) {
                failed_ids.push({ id: rec.id, reason: "CHECKPOINT_NOT_ASSIGNED" });
                continue;
              }
            }

            const readAt = new Date(rec.exact_timestamp).toISOString();
            const isFinish = rec.split_id ? finishById.get(rec.split_id) === true : true;

            // 1) Resultado autoritativo (solo en meta o registro sin split)
            if (isFinish) {
              const { data: existing, error: existingErr } = await supa
                .from("results")
                .select("id, finish_at, source")
                .eq("registration_id", reg.id)
                .maybeSingle();
              if (existingErr) {
                failed_ids.push({ id: rec.id, reason: "RESULT_READ_FAILED" });
                continue;
              }

              const resultRow = {
                event_id: race_id,
                tenant_id: leagueId,
                registration_id: reg.id,
                athlete_id: reg.athlete_id,
                duration_ms: rec.net_time_ms ?? null,
                penalty_seconds: rec.penalty_seconds ?? 0,
                status: STATUS_MAP[rec.status],
                finish_at: readAt,
                source: "timer",
              };

              if (existing && existing.source === "manual") {
                // Corrección manual de un administrador: el Timer no la pisa.
                ignored_ids.push({ id: rec.id, reason: "MANUAL_RESULT_KEPT" });
              } else if (existing && existing.finish_at && new Date(existing.finish_at as string).getTime() > rec.exact_timestamp) {
                // Un registro más viejo que el ya guardado (reintento tardío, otro dispositivo): no lo pisa.
                ignored_ids.push({ id: rec.id, reason: "OLDER_THAN_SAVED_RESULT" });
              } else {
                const { error: saveErr } = existing
                  ? await supa.from("results").update(resultRow).eq("registration_id", reg.id)
                  : await supa.from("results").insert(resultRow);
                if (saveErr) {
                  failed_ids.push({ id: rec.id, reason: "RESULT_SAVE_FAILED" });
                  continue;
                }
              }
            }

            // 2) Lectura cruda (auditoría) — solo si hay checkpoint asociado
            if (rec.split_id) {
              const { error: readErr } = await supa.from("timing_reads").insert({
                tenant_id: leagueId,
                event_id: race_id,
                registration_id: reg.id,
                checkpoint_id: rec.split_id,
                read_at: readAt,
                source: "fedocr-timer",
                client_record_id: rec.id,
                raw_payload: {
                  penalty_seconds: rec.penalty_seconds,
                  net_time_ms: rec.net_time_ms,
                  status: rec.status,
                  wave_id: rec.wave_id ?? null,
                },
              });
              // 23505 = ya existe (client_record_id único) -> idempotente, cuenta como sincronizado
              if (readErr && readErr.code !== "23505") {
                failed_ids.push({ id: rec.id, reason: readErr.code ?? "READ_INSERT_FAILED" });
                continue;
              }
            }

            synced_ids.push(rec.id);
          } catch {
            failed_ids.push({ id: rec.id, reason: "INTERNAL_ERROR" });
          }
        }

        return json({ synced_ids, failed_ids, ignored_ids });
      }),
    },
  },
});
