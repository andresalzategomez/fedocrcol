import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, userClient, isServerSupabaseConfigured } from "../supabase-server";
import { trackError } from "./http";

export interface TrackUser {
  userId: string;
  role: string;
  tenantId: string | null;
  name: string | null;
}

export interface TrackRace {
  id: string;
  title: string;
  date: string;
  location: string;
  status: string;
  tenant_id: string;
  track_judge_id: string | null;
}

export interface TrackContext extends TrackUser {
  admin: SupabaseClient;
  race: TrackRace;
}

/** Roles que operan carreras track: el juez asignado, el administrador de la liga dueña y la federación. */
const TRACK_ROLES = new Set(["judge", "admin", "superadmin"]);

/** Valida el Bearer (JWT de Supabase Auth) y devuelve el usuario con su rol. Lanza Response si falla. */
export async function authenticateTrackUser(request: Request): Promise<TrackUser> {
  if (!isServerSupabaseConfigured) throw trackError(request, "NOT_CONFIGURED", "Supabase no está configurado en el servidor", 503);
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw trackError(request, "UNAUTHORIZED", "Falta el token Bearer", 401);
  const { data, error } = await userClient(header.slice(7)).auth.getUser();
  if (error || !data?.user) throw trackError(request, "UNAUTHORIZED", "Token inválido o expirado", 401);

  const { data: profile } = await serviceClient().from("profiles").select("role, tenant_id, full_name").eq("id", data.user.id).maybeSingle();
  const role = (profile?.role as string | undefined) ?? "athlete";
  if (!TRACK_ROLES.has(role)) throw trackError(request, "FORBIDDEN_ROLE", "Tu cuenta no puede operar carreras track", 403);
  return {
    userId: data.user.id,
    role,
    tenantId: (profile?.tenant_id as string | null | undefined) ?? null,
    name: (profile?.full_name as string | null | undefined) ?? null,
  };
}

/**
 * Autentica y autoriza el acceso a UNA carrera track: debe ser track y el usuario debe ser su juez asignado, el
 * administrador de la liga dueña o superadmin. Cualquier otro caso responde "no encontrada" (no se revela que existe).
 */
export async function authenticateTrackRace(request: Request, raceId: string): Promise<TrackContext> {
  const user = await authenticateTrackUser(request);
  const admin = serviceClient();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(raceId)) throw trackError(request, "NOT_FOUND", "Carrera no encontrada", 404);

  const { data: race } = await admin
    .from("events")
    .select("id, title, date, location, status, tenant_id, track_judge_id, race_format")
    .eq("id", raceId)
    .maybeSingle();
  if (!race || race.race_format !== "track") throw trackError(request, "NOT_FOUND", "Carrera no encontrada", 404);

  const allowed =
    user.role === "superadmin" ||
    (user.role === "admin" && user.tenantId === race.tenant_id) ||
    (user.role === "judge" && race.track_judge_id === user.userId);
  if (!allowed) throw trackError(request, "NOT_FOUND", "Carrera no encontrada", 404);

  return { ...user, admin, race: race as TrackRace };
}
