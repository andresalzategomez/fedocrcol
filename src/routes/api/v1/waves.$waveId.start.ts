import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

const bodySchema = z.object({ started_at: z.number().int() }); // epoch ms, capturado por el Timer

/**
 * POST /api/v1/waves/:waveId/start
 * El Timer llama esto al disparar una oleada (startWave local) para que
 * `waves.started_at` deje de quedar siempre vacío en fedocrcol.
 *
 * Usa service_role para el UPDATE a propósito: la política RLS
 * `waves_tenant_manage` (vía `can_manage_event()`) bloquea escrituras
 * mientras el evento está `in_progress` — congela la CONFIGURACIÓN de la
 * carrera para el panel admin — pero una oleada arranca precisamente
 * durante `in_progress`. Este endpoint valida el permiso con el JWT del
 * juez (misma liga que la oleada) y luego escribe con service_role, igual
 * que /races/:id/start|finish y recalculate-positions.
 *
 * Idempotente: si ya tenía started_at, no lo pisa — devuelve el valor
 * existente con `already: true` (el Timer puede reintentar sin riesgo de
 * sobrescribir la hora real con la de un reintento tardío).
 */
export const Route = createFileRoute("/api/v1/waves/$waveId/start")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request, params }) => {
        const { supa, leagueId } = await authenticate(request);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Falta started_at (epoch ms)", 400);

        const { data: wave, error: findErr } = await supa
          .from("waves")
          .select("id, started_at")
          .eq("id", params.waveId)
          .eq("tenant_id", leagueId)
          .maybeSingle();
        if (findErr) return apiError("DB_ERROR", findErr.message, 500);
        if (!wave) return apiError("NOT_FOUND", "Oleada no encontrada", 404);

        if (wave.started_at) {
          return json({ started_at: wave.started_at, already: true });
        }

        const startedAtIso = new Date(parsed.data.started_at).toISOString();
        const { error } = await serviceClient().from("waves").update({ started_at: startedAtIso }).eq("id", wave.id);
        if (error) return apiError("DB_ERROR", error.message, 500);

        return json({ started_at: startedAtIso });
      }),
    },
  },
});
