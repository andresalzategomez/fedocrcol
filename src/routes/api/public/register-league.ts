import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, apiError, preflight, handler } from "../../../lib/server/api";
import { serviceClient } from "../../../lib/server/supabase-server";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  league_name: z.string().min(2),
  department: z.string().min(1),
  city: z.string().optional(),
});

function slugify(value: string): string {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "liga";
}

/**
 * POST /api/public/register-league
 * Registro público de una liga nueva: a diferencia de jueces/race_manager
 * (invitados por correo con generateLink), acá la persona está presente
 * llenando el formulario, así que se crea la cuenta directo con la
 * contraseña que eligió (admin.createUser + email_confirm:true) -- no
 * hace falta invitación ni Resend.
 *
 * La liga queda en tenants.status='pending' hasta que el superadmin la
 * apruebe (panel de aprobaciones, fase D). El usuario ya puede iniciar
 * sesión, pero el panel le muestra que está pendiente en vez del
 * contenido real (ver panel.tsx).
 */
export const Route = createFileRoute("/api/public/register-league")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      POST: handler(async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError("BAD_REQUEST", "Revisa los datos del formulario", 400);
        const { email, password, full_name, league_name, department, city } = parsed.data;

        const admin = serviceClient();

        const base = slugify(league_name);
        const { data: existingSlugs } = await admin.from("tenants").select("slug").like("slug", `${base}%`);
        const taken = new Set((existingSlugs ?? []).map((r) => r.slug as string));
        let slug = base;
        let n = 2;
        while (taken.has(slug)) slug = `${base}-${n++}`;

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

        const { data: tenant, error: tenantErr } = await admin
          .from("tenants")
          .insert({ name: league_name, slug, department, city: city ?? null, status: "pending", created_by: userId })
          .select("id")
          .single();
        if (tenantErr) return apiError("DB_ERROR", `La cuenta se creó, pero no se pudo registrar la liga: ${tenantErr.message}`, 500);

        const { error: profErr } = await admin
          .from("profiles")
          .update({ role: "admin", tenant_id: tenant.id, full_name, email })
          .eq("id", userId);
        if (profErr) return apiError("DB_ERROR", `La liga se creó, pero no se pudo vincular tu cuenta: ${profErr.message}`, 500);

        return json({ tenant_id: tenant.id, user_id: userId });
      }),
    },
  },
});
