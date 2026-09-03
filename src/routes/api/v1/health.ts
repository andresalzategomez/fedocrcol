import { createFileRoute } from "@tanstack/react-router";
import { json, preflight } from "../../../lib/server/api";

/** GET /api/v1/health — health check para el poll de estado del Timer. */
export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: () => json({ status: "ok", time: new Date().toISOString() }),
    },
  },
});
