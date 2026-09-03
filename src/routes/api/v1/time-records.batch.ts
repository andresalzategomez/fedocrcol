import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";

const recordSchema = z.object({
  id: z.string(), // id del registro en el cliente (idempotencia)
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

/**
 * POST /api/v1/time-records/batch
 * Recibe un lote de tiempos calculados offline por el Timer y los persiste.
 * Devuelve { synced_ids, failed_ids: [{ id, reason }] }.
 * El net_time_ms del Timer es autoritativo (results.source = 'timer').
 */
export const Route = createFileRoute("/api/v1/time-records/batch")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { supa, leagueId } = await authenticate(request);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiError("BAD_REQUEST", "Formato de lote inválido", 400);
        }
        const { race_id, records } = parsed.data;

        // Prefetch inscripciones (bib -> {id, athlete_id}) y checkpoints (id -> is_finish)
        const [{ data: regs }, { data: cps }] = await Promise.all([
          supa
            .from("registrations")
            .select("id, bib_number, athlete_id")
            .eq("event_id", race_id)
            .eq("tenant_id", leagueId),
          supa.from("checkpoints").select("id, is_finish").eq("event_id", race_id),
        ]);

        const regByBib = new Map<number, { id: string; athlete_id: string | null }>();
        (regs ?? []).forEach((r) => regByBib.set(r.bib_number as number, { id: r.id, athlete_id: r.athlete_id }));
        const finishById = new Map<string, boolean>();
        (cps ?? []).forEach((c) => finishById.set(c.id, c.is_finish as boolean));

        const synced_ids: string[] = [];
        const failed_ids: { id: string; reason: string }[] = [];

        for (const rec of records) {
          try {
            const reg = regByBib.get(rec.bib_number);
            if (!reg) {
              failed_ids.push({ id: rec.id, reason: "ATHLETE_NOT_FOUND" });
              continue;
            }
            const readAt = new Date(rec.exact_timestamp).toISOString();
            const isFinish = rec.split_id ? finishById.get(rec.split_id) === true : true;

            // 1) Resultado autoritativo (solo en meta o registro sin split)
            if (isFinish) {
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
              const { data: existing } = await supa
                .from("results")
                .select("id")
                .eq("registration_id", reg.id)
                .maybeSingle();
              if (existing) {
                await supa.from("results").update(resultRow).eq("registration_id", reg.id);
              } else {
                await supa.from("results").insert(resultRow);
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

        return json({ synced_ids, failed_ids });
      }),
    },
  },
});
