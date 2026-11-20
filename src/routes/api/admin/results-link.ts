import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateUser, json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { newResultsToken, isPubliclyViewable } from "../../../lib/server/public-results";

const bodySchema = z.object({
  event_id: z.string().uuid(),
  /** true: genera un código nuevo (el enlace anterior deja de funcionar). */
  regenerate: z.boolean().optional(),
});

/**
 * POST /api/admin/results-link  { event_id, regenerate? }
 * Devuelve el enlace público de resultados de la carrera (lo crea la primera vez). Solo el administrador de la liga
 * dueña de la carrera y la federación. El enlace solo funciona si la carrera es pública y hasta el final del día de la
 * carrera; `available` indica si hoy funcionaría.
 */
export const Route = createFileRoute("/api/admin/results-link")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const { role, tenantId } = await authenticateUser(request);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Falta la carrera", 400);
        const { event_id, regenerate } = parsed.data;

        const admin = serviceClient();
        const { data: event } = await admin
          .from("events")
          .select("id, tenant_id, date, status, visibility, published, race_format")
          .eq("id", event_id)
          .maybeSingle();
        if (!event) return apiError("NOT_FOUND", "No encontramos esa carrera", 404);
        const allowed = role === "superadmin" || (role === "admin" && tenantId === event.tenant_id);
        if (!allowed) return apiError("FORBIDDEN", "No tienes permiso sobre esta carrera", 403);

        const { data: existing } = await admin.from("event_results_links").select("token").eq("event_id", event_id).maybeSingle();
        let token = existing?.token as string | undefined;
        if (!token || regenerate) {
          token = newResultsToken();
          const { error } = existing
            ? await admin.from("event_results_links").update({ token, rotated_at: new Date().toISOString() }).eq("event_id", event_id)
            : await admin.from("event_results_links").insert({ event_id, token });
          if (error) return apiError("DB_ERROR", error.message, 500);
        }

        return json({
          ok: true,
          token,
          url: `${siteUrl(request)}/resultados/${token}`,
          available: isPubliclyViewable(event as never),
          valid_until: event.date,
          visibility: event.visibility,
        });
      }),
    },
  },
});
