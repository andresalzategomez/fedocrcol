import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/set-password")({
  head: () => ({ meta: [{ title: "Crear contraseña — FEDOCR Colombia" }, { name: "robots", content: "noindex" }] }),
  component: SetPasswordPage,
});

/**
 * Destino del enlace de invitación (jueces creados desde el panel, ver
 * POST /api/admin/judges) y de recuperación de contraseña. El cliente de
 * Supabase detecta la sesión del enlace en la URL automáticamente
 * (detectSessionInUrl, activo por defecto) — esta página solo espera a
 * que aparezca esa sesión y deja fijar la contraseña definitiva.
 */
function SetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!supabase) { setChecked(true); return; }
    supabase.auth.getSession().then(({ data }) => { setReady(Boolean(data.session)); setChecked(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setReady(Boolean(session)));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < 8) { toast.error("La contraseña debe tener al menos 8 caracteres"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setDone(true);
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto grid max-w-md gap-6 px-4 py-16">
        <div>
          <h1 className="font-display text-4xl">Crear contraseña</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Define la contraseña de tu cuenta. La usarás para iniciar sesión en FedOCR Timer.
          </p>
        </div>
        <Card className="border-border/70">
          <CardContent className="p-6">
            {done ? (
              <div className="flex items-start gap-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                <p>Contraseña creada. Ya puedes iniciar sesión en FedOCR Timer con tu correo y esta contraseña.</p>
              </div>
            ) : !checked ? (
              <p className="text-sm text-muted-foreground">Verificando el enlace…</p>
            ) : !ready ? (
              <p className="text-sm text-muted-foreground">
                Este enlace no es válido o ya expiró. Pide que te reenvíen la invitación.
              </p>
            ) : (
              <form onSubmit={submit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="password">Nueva contraseña</Label>
                  <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar contraseña"}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
