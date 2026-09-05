import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate, json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

const bodySchema = z.object({ event_id: z.string() });

/**
 * POST /api/admin/recalculate-positions
 * Recalcula `results.position` de un evento (RPC `recalculate_event_positions`),
 * que solo puede ejecutar el service_role. Verifica que el usuario autenticado
 * sea admin/superadmin y dueño del evento antes de invocarla.
 */
export const Route = createFileRoute("/api/admin/recalculate-positions")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { supa, role, leagueId } = await authenticate(request);
        if (role !== "admin" && role !== "superadmin") {
          return apiError("FORBIDDEN", "Solo un admin de liga o la federación puede recalcular posiciones", 403);
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Falta event_id", 400);

        const { data: event } = await supa
          .from("events")
          .select("id, tenant_id")
          .eq("id", parsed.data.event_id)
          .maybeSingle();
        if (!event) return apiError("NOT_FOUND", "Carrera no encontrada o sin acceso", 404);
        if (role !== "superadmin" && (event as { tenant_id: string }).tenant_id !== leagueId) {
          return apiError("FORBIDDEN", "No puedes recalcular una carrera de otra liga", 403);
        }

        const { error } = await serviceClient().rpc("recalculate_event_positions", {
          p_event_id: parsed.data.event_id,
        });
        if (error) return apiError("DB_ERROR", error.message, 500);

        return json({ ok: true });
      }),
    },
  },
});
