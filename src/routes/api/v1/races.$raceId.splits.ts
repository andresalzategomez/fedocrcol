import { createFileRoute } from "@tanstack/react-router";
import { authenticate, json, preflight, handler } from "../../../lib/server/api";

/**
 * GET /api/v1/races/:raceId/splits — puntos de control (checkpoints) de la carrera.
 *
 * Si quien llama es un juez (role='judge'), solo devuelve los checkpoints
 * que tiene asignados (checkpoint_judges) — así el Timer, sin lógica
 * adicional, solo puede ofrecerle esos puntos de control para registrar
 * tiempos. Admin/superadmin siguen viendo todos, igual que antes.
 */
export const Route = createFileRoute("/api/v1/races/$raceId/splits")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: handler(async ({ request, params }) => {
        const { supa, leagueId, role, userId } = await authenticate(request);

        let assignedIds: string[] | null = null;
        if (role === "judge") {
          const { data: assigned, error: assignedErr } = await supa
            .from("checkpoint_judges")
            .select("checkpoint_id")
            .eq("judge_id", userId);
          if (assignedErr) return json({ error: { code: "DB_ERROR", message: assignedErr.message } }, 500);
          assignedIds = (assigned ?? []).map((r) => r.checkpoint_id as string);
          if (assignedIds.length === 0) return json([]);
        }

        let query = supa
          .from("checkpoints")
          .select("id, name, ord, is_start, is_finish")
          .eq("event_id", params.raceId)
          .eq("tenant_id", leagueId);
        if (assignedIds) query = query.in("id", assignedIds);

        const { data, error } = await query.order("ord", { ascending: true });
        if (error) return json({ error: { code: "DB_ERROR", message: error.message } }, 500);

        return json(
          (data ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            order: c.ord,
            is_start: c.is_start,
            is_finish: c.is_finish,
          })),
        );
      }),
    },
  },
});
