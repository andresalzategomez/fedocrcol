import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler, siteUrl } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";
import { sendEmail } from "../../../lib/server/resend-server";
import { clubRequestLeagueHtml, clubRequestLeagueSubject } from "../../../lib/server/email-templates/club-request-league";
import { clubRegisteredHtml, clubRegisteredSubject } from "../../../lib/server/email-templates/club-registered";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  club_name: z.string().min(2),
  /** Obligatoria: todo club pertenece a una liga activa (ya no hay clubes independientes). */
  tenant_id: z.string().uuid(),
  city: z.string().optional(),
  department: z.string().optional(),
});

/**
 * POST /api/public/register-club
 * Registro público de un club nuevo. Igual que register-league.ts, la
 * cuenta se crea directo con la contraseña elegida (sin invitación).
 *
 * Debe elegir una liga activa: queda pendiente de que ESA liga lo apruebe.
 * Ya no se registran clubes independientes. Al registrarse, la liga (sus
 * administradores) recibe un correo para que sepa que hay un club por
 * aprobar y el club recibe un acuse; si esos correos fallan el registro
 * no se cae: el club ya quedó creado y aparece igual en Solicitudes.
 */
export const Route = createFileRoute("/api/public/register-club")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos del formulario", 400);
        const { email, password, full_name, club_name, tenant_id, city, department } = parsed.data;

        const admin = serviceClient();

        const { data: tenant } = await admin.from("tenants").select("id, name, status").eq("id", tenant_id).maybeSingle();
        if (!tenant || tenant.status !== "active") return apiError("BAD_REQUEST", "La liga seleccionada no existe o no está activa", 400);

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name },
        });
        if (createErr) {
          const status = createErr.status && createErr.status >= 400 && createErr.status < 500 ? createErr.status : 500;
          return apiError("SIGNUP_FAILED", createErr.message, status);
        }
        const userId = created.user?.id;
        if (!userId) return apiError("SIGNUP_FAILED", "No se pudo crear la cuenta", 500);

        const { data: club, error: clubErr } = await admin
          .from("clubs")
          .insert({
            tenant_id,
            name: club_name,
            city: city ?? null,
            department: department ?? null,
            contact_email: email,
            owner_id: userId,
            approval_status: "pending",
          })
          .select("id")
          .single();
        if (clubErr) return apiError("DB_ERROR", `La cuenta se creó, pero no se pudo registrar el club: ${clubErr.message}`, 500);

        const { error: profErr } = await admin
          .from("profiles")
          .update({ role: "club", tenant_id, full_name, email })
          .eq("id", userId);
        if (profErr) return apiError("DB_ERROR", `El club se creó, pero no se pudo vincular tu cuenta: ${profErr.message}`, 500);

        const panelUrl = `${siteUrl(request)}/panel`;
        const leagueName = tenant.name as string;
        const { data: leagueAdmins } = await admin.from("profiles").select("email").eq("tenant_id", tenant_id).eq("role", "admin");
        const recipients = [...new Set((leagueAdmins ?? []).map((a) => a.email as string | null).filter((e): e is string => Boolean(e)))];
        await Promise.all([
          ...recipients.map(async (to) => {
            const sent = await sendEmail({
              to,
              subject: clubRequestLeagueSubject(club_name),
              html: clubRequestLeagueHtml({ leagueName, clubName: club_name, contactName: full_name, contactEmail: email, panelUrl }),
            });
            if (!sent.ok) console.error("No se pudo avisar a la liga del nuevo club por aprobar:", sent.error);
          }),
          sendEmail({
            to: email,
            subject: clubRegisteredSubject(club_name),
            html: clubRegisteredHtml({ fullName: full_name, clubName: club_name, leagueName, panelUrl }),
          }).then((sent) => { if (!sent.ok) console.error("No se pudo enviar el acuse de registro al club:", sent.error); }),
        ]);

        return json({ club_id: club.id, user_id: userId, pending_approval_by: "league" });
      }),
    },
  },
});
