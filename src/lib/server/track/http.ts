/**
 * Respuestas y CORS de /api/track/v1 (API de Timer_track).
 *
 * CORS estricto: solo los orígenes de Timer_track. Se puede cambiar sin tocar el código con la variable de
 * entorno TRACK_ALLOWED_ORIGINS (lista separada por comas). La API no usa cookies (el token va en el encabezado
 * Authorization), así que no se permiten credenciales.
 */

export const TRACK_API_VERSION = "1.0.0";

const DEFAULT_ORIGINS = [
  "https://timertrack.fedocrcolombia.com",
  "http://localhost:5180",
  "http://localhost:5181",
];

export function allowedOrigins(): string[] {
  const raw = process.env["TRACK_ALLOWED_ORIGINS"];
  if (!raw) return DEFAULT_ORIGINS;
  const list = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const base: Record<string, string> = { vary: "Origin" };
  if (origin && allowedOrigins().includes(origin)) {
    return {
      ...base,
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-max-age": "600",
    };
  }
  return base;
}

export function trackPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function trackJson(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(request) },
  });
}

export function trackError(request: Request, code: string, message: string, status: number): Response {
  return trackJson(request, { error: { code, message }, server_time: new Date().toISOString(), api_version: TRACK_API_VERSION }, status);
}

/** Envuelve un handler: las Response lanzadas (errores de autenticación) y los errores inesperados salen con CORS. */
export function trackHandler(fn: (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>) {
  return async (ctx: { request: Request; params: Record<string, string> }) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error("Error en /api/track/v1:", e);
      return trackError(ctx.request, "INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  };
}
