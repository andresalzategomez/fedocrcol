import { userClient, isServerSupabaseConfigured } from "./supabase-server";

/** Cabeceras CORS abiertas: el Timer (Electron) llama desde el proceso Node,
 *  pero dejamos CORS permisivo por si se consume desde otro origen. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-league-id",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/** Respuesta a preflight OPTIONS. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Origen público del sitio, para armar enlaces de correo (invitación,
 * recuperación de contraseña). NO se puede confiar en `new URL(request.url).origin`
 * en producción: detrás del proxy de Lovable, `request.url` refleja el
 * listener interno del contenedor ("http://localhost:3000"), no el
 * dominio público.
 *
 * Se intentaron dos formas "dinámicas" de resolverlo y ninguna funcionó en
 * este hosting (confirmado con pruebas repetidas en producción, incluso
 * después de publicar varias veces):
 *   1. La variable de entorno SITE_URL -- nunca se leyó con un valor útil,
 *      ni siquiera después de borrarla y volverla a crear.
 *   2. Las cabeceras `x-forwarded-host`/`host` del proxy -- Lovable
 *      tampoco las reenvía: el proceso ve "localhost:3000" como si fuera
 *      su propia dirección, no la del visitante.
 * Por eso el último recurso es un dominio fijo en el código: si `request.url`
 * no es localhost/127.0.0.1 (desarrollo local real) y las cabeceras
 * tampoco dan algo útil, asumimos que estamos en el despliegue de
 * producción conocido. Si algún día cambia el dominio, hay que actualizar
 * PRODUCTION_SITE_URL aquí.
 */
const PRODUCTION_SITE_URL = "https://fedocrcol.lovable.app";
const LOCALHOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

export function siteUrl(request: Request): string {
  if (process.env["SITE_URL"]) return process.env["SITE_URL"] as string;

  const requestOrigin = new URL(request.url).origin;
  if (LOCALHOST_RE.test(requestOrigin.replace(/^https?:\/\//, ""))) return requestOrigin;

  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost && !LOCALHOST_RE.test(forwardedHost)) {
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return PRODUCTION_SITE_URL;
}

export interface AuthContext {
  supa: ReturnType<typeof userClient>;
  userId: string;
  leagueId: string;
  role: string;
  userName: string | null;
}

/**
 * Autentica la petición con el Bearer token (JWT de Supabase Auth) y resuelve
 * la liga (tenant) del usuario desde su profile. Lanza Response en caso de error.
 */
export async function authenticate(request: Request): Promise<AuthContext> {
  if (!isServerSupabaseConfigured) {
    throw apiError("NOT_CONFIGURED", "Supabase no está configurado en el servidor", 503);
  }
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw apiError("UNAUTHORIZED", "Falta el token Bearer", 401);
  }
  const token = header.slice(7);
  const supa = userClient(token);

  const { data: userData, error } = await supa.auth.getUser();
  if (error || !userData?.user) {
    throw apiError("UNAUTHORIZED", "Token inválido o expirado", 401);
  }

  const { data: profile } = await supa
    .from("profiles")
    .select("tenant_id, role, full_name")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.tenant_id) {
    throw apiError("NO_LEAGUE", "El usuario no está asociado a ninguna liga", 403);
  }

  // El header X-League-Id, si viene, debe coincidir con la liga del token.
  const leagueHeader = request.headers.get("x-league-id");
  if (leagueHeader && leagueHeader !== profile.tenant_id) {
    throw apiError("LEAGUE_MISMATCH", "El league_id no coincide con el del token", 409);
  }

  return {
    supa,
    userId: userData.user.id,
    leagueId: profile.tenant_id as string,
    role: (profile.role as string) ?? "athlete",
    userName: (profile.full_name as string) ?? null,
  };
}

/** Envuelve un handler: captura Response lanzadas por authenticate() y errores. */
export function handler(fn: (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>) {
  return async (ctx: { request: Request; params: Record<string, string> }) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error(e);
      return apiError("INTERNAL_ERROR", "Error interno del servidor", 500);
    }
  };
}
