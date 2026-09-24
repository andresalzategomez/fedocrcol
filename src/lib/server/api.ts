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
 * recuperación de contraseña).
 *
 * Se probaron CUATRO formas de resolverlo y ninguna funciona en este
 * hosting de Lovable, confirmado con pruebas repetidas en producción:
 *   1. La variable de entorno SITE_URL -- nunca se leyó con un valor útil.
 *   2. Borrar esa misma variable por completo -- Lovable reportó "SITE_URL
 *      eliminada", pero el secret sigue apareciendo en la lista del
 *      proyecto y el valor viejo se sigue leyendo igual. No hay forma
 *      confiable de hacer que ese secret desaparezca desde este proyecto.
 *   3. Las cabeceras `x-forwarded-host`/`host` del proxy -- Lovable
 *      tampoco las reenvía.
 *   4. `new URL(request.url).origin` -- en producción `request.url` YA
 *      refleja el listener interno del contenedor ("http://localhost:3000"),
 *      idéntico a como luce una petición real de desarrollo local.
 *
 * Por eso el código YA NO lee `SITE_URL` en absoluto -- da igual qué
 * tenga guardado ese secret zombie, nunca más se consulta. El dominio de
 * producción queda fijo aquí. Si algún día cambia, hay que actualizar
 * PRODUCTION_SITE_URL.
 */
const PRODUCTION_SITE_URL = "https://fedocrcol.lovable.app";

export function siteUrl(_request: Request): string {
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
