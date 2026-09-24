import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Invita (o reenvía) una cuenta de un rol "ligado a una liga" (judge,
 * race_manager, ...): crea el usuario vía generateLink({type:"invite"})
 * -- que NO envía el correo integrado de Supabase, ver resend-server.ts
 * para el porqué -- y deja el profile con el rol y la liga correctos.
 *
 * Estos roles pueden ser CUALQUIER usuario existente (un atleta, un
 * club, un gestor/juez de otra liga, ...), no solo correos nuevos:
 * - Si el correo no existe: se crea una cuenta nueva vía invite link.
 * - Si existe pero SIN confirmar (password_set_at null, cualquier rol o
 *   liga): es una invitación pendiente de otra cosa -- se cancela y se
 *   recrea con el rol/liga nuevos (generateLink falla con "already
 *   registered" si el correo ya existe, confirmado o no).
 * - Si existe y YA confirmada (tiene contraseña): se reutiliza la MISMA
 *   cuenta, solo se le actualiza el rol y la liga -- ya puede iniciar
 *   sesión con lo que tiene, no hace falta un link nuevo. `actionLink`
 *   sale `null` en ese caso: quien llama debe enviar un correo distinto
 *   (de aviso, no de "crea tu contraseña").
 * - Excepción: una cuenta admin o superadmin nunca se reasigna así --
 *   protege de que alguien pierda su acceso de administrador por error.
 */
export interface InviteAccountParams {
  admin: SupabaseClient;
  role: string;
  email: string;
  fullName: string;
  leagueId: string;
  redirectTo: string;
}

export type InviteAccountResult =
  | { ok: true; userId: string; actionLink: string | null; resent: boolean; reused: boolean; previousId: string | null }
  | { ok: false; code: string; message: string; status: number };

export async function inviteOrResendAccount(params: InviteAccountParams): Promise<InviteAccountResult> {
  const { admin, role, email, fullName, leagueId, redirectTo } = params;

  const { data: existing, error: existingErr } = await admin
    .from("profiles")
    .select("id, role, tenant_id, password_set_at")
    .eq("email", email)
    .maybeSingle();
  if (existingErr) return { ok: false, code: "DB_ERROR", message: existingErr.message, status: 500 };

  if (existing && (existing.role === "superadmin" || existing.role === "admin")) {
    return {
      ok: false,
      code: "PROTECTED_ROLE",
      message: "Esa cuenta ya es administradora (de la federación o de una liga) -- no se puede reasignar a este rol desde aquí.",
      status: 409,
    };
  }

  if (existing && existing.password_set_at) {
    const { error: profErr } = await admin
      .from("profiles")
      .update({ role, tenant_id: leagueId, full_name: fullName })
      .eq("id", existing.id);
    if (profErr) return { ok: false, code: "DB_ERROR", message: profErr.message, status: 500 };
    return { ok: true, userId: existing.id, actionLink: null, resent: false, reused: true, previousId: null };
  }

  let previousId: string | null = null;
  if (existing) {
    previousId = existing.id;
    const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
    if (delErr) return { ok: false, code: "INVITE_FAILED", message: `No se pudo reenviar: ${delErr.message}`, status: 500 };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName, tenant_id: leagueId }, redirectTo },
  });
  if (error) {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return { ok: false, code: "INVITE_FAILED", message: error.message, status };
  }
  const userId = data.user?.id;
  const actionLink = data.properties?.action_link;
  if (!userId || !actionLink) return { ok: false, code: "INVITE_FAILED", message: "La invitación no devolvió un usuario o un enlace", status: 500 };

  const { error: profErr } = await admin
    .from("profiles")
    .update({ role, tenant_id: leagueId, full_name: fullName, email })
    .eq("id", userId);
  if (profErr) return { ok: false, code: "DB_ERROR", message: profErr.message, status: 500 };

  return { ok: true, userId, actionLink, resent: Boolean(existing), reused: false, previousId };
}

export interface RemoveAccountParams {
  admin: SupabaseClient;
  id: string;
  role: string;
  leagueId: string;
  isSuperadmin: boolean;
}

export type RemoveAccountResult =
  | { ok: true; email: string | null; fullName: string | null }
  | { ok: false; code: string; message: string; status: number };

/**
 * Elimina una cuenta "ligada a una liga" (judge, race_manager, ...): borra
 * el usuario de Supabase Auth vía service_role, lo que en cascada borra su
 * profile y (para jueces) sus asignaciones en checkpoint_judges. Sirve
 * tanto para "cancelar invitación" (cuenta sin password_set_at) como para
 * remover del todo a alguien que ya la había aceptado -- es la misma acción.
 * Devuelve el correo/nombre de la cuenta borrada para que el endpoint que
 * llama pueda avisarle por correo, si corresponde.
 */
export async function removeAccount(params: RemoveAccountParams): Promise<RemoveAccountResult> {
  const { admin, id, role, leagueId, isSuperadmin } = params;

  const { data: profile, error } = await admin.from("profiles").select("id, role, tenant_id, email, full_name").eq("id", id).maybeSingle();
  if (error) return { ok: false, code: "DB_ERROR", message: error.message, status: 500 };
  if (!profile || profile.role !== role) {
    return { ok: false, code: "NOT_FOUND", message: "No se encontró esa cuenta", status: 404 };
  }
  if (!isSuperadmin && profile.tenant_id !== leagueId) {
    return { ok: false, code: "FORBIDDEN", message: "Esa cuenta no pertenece a tu liga", status: 403 };
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(id);
  if (delErr) return { ok: false, code: "DELETE_FAILED", message: delErr.message, status: 500 };
  return { ok: true, email: (profile.email as string | null) ?? null, fullName: (profile.full_name as string | null) ?? null };
}
