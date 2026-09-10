import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Invita (o reenvía) una cuenta de un rol "ligado a una liga" (judge,
 * race_manager, ...): crea el usuario vía generateLink({type:"invite"})
 * -- que NO envía el correo integrado de Supabase, ver resend-server.ts
 * para el porqué -- y deja el profile con el rol y la liga correctos.
 *
 * Reenvío: si ya existe un profile con ese correo, con el MISMO rol, la
 * MISMA liga y sin confirmar (password_set_at null), se borra la cuenta
 * pendiente y se recrea con el mismo correo (generateLink falla con
 * "already registered" si el correo ya existe, confirmado o no). Si el
 * correo pertenece a otro rol, otra liga, o ya está confirmado, se
 * rechaza como conflicto real: nunca se borra una cuenta activa ajena.
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
  | { ok: true; userId: string; actionLink: string; resent: boolean; previousId: string | null }
  | { ok: false; code: string; message: string; status: number };

export async function inviteOrResendAccount(params: InviteAccountParams): Promise<InviteAccountResult> {
  const { admin, role, email, fullName, leagueId, redirectTo } = params;

  const { data: existing, error: existingErr } = await admin
    .from("profiles")
    .select("id, role, tenant_id, password_set_at")
    .eq("email", email)
    .maybeSingle();
  if (existingErr) return { ok: false, code: "DB_ERROR", message: existingErr.message, status: 500 };

  let previousId: string | null = null;
  if (existing) {
    const canResend = existing.role === role && existing.tenant_id === leagueId && !existing.password_set_at;
    if (!canResend) {
      return {
        ok: false,
        code: "EMAIL_TAKEN",
        message: "Ya existe una cuenta con este correo (de otra liga, de otro rol, o ya confirmada)",
        status: 409,
      };
    }
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

  return { ok: true, userId, actionLink, resent: Boolean(existing), previousId };
}
