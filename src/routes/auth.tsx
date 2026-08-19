import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEMO_LEAGUES } from "@/data/demo";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Ingresar o registrarte — FEDOCR Colombia" },
      { name: "description", content: "Accede a tu cuenta de atleta, administrador de liga o administración nacional de la Federación de OCR." },
      { property: "og:title", content: "Ingresar o registrarte — FEDOCR Colombia" },
      { property: "og:description", content: "Cuenta única para atletas y administradores de ligas OCR." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tenant, setTenant] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      toast.info("Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para habilitar el login real.");
      navigate({ to: "/panel" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bienvenido de vuelta");
    navigate({ to: "/panel" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      toast.info("Conecta tu proyecto de Supabase externo para crear cuentas reales.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, tenant_id: tenant, role: "athlete" } },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Cuenta creada. Revisa tu correo para confirmar.");
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto grid max-w-md gap-6 px-4 py-16">
        <div>
          <h1 className="font-display text-4xl">Acceso a la plataforma</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Atletas, administradores de liga y administración nacional usan la misma cuenta; los permisos se
            resuelven con RLS en Supabase.
          </p>
        </div>

        {!isSupabaseConfigured ? (
          <div className="flex gap-3 rounded border border-warning/40 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Modo demo: aún no hay credenciales de Supabase. Copia <code>.env.example</code> a{" "}
              <code>.env</code> y ejecuta <code>supabase/schema.sql</code> en tu proyecto.
            </p>
          </div>
        ) : null}

        <Card className="border-border/70">
          <CardContent className="p-6">
            <Tabs defaultValue="login">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">Ingresar</TabsTrigger>
                <TabsTrigger value="signup" className="flex-1">Registrarme</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-5">
                <form onSubmit={signIn} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Correo</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={loading}>{loading ? "Ingresando..." : "Ingresar"}</Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-5">
                <form onSubmit={signUp} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Nombre completo</Label>
                    <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="email2">Correo</Label>
                    <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pass2">Contraseña</Label>
                    <Input id="pass2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Liga departamental</Label>
                    <Select value={tenant} onValueChange={setTenant}>
                      <SelectTrigger><SelectValue placeholder="Selecciona tu liga" /></SelectTrigger>
                      <SelectContent>
                        {DEMO_LEAGUES.filter((l) => l.status === "active").map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.department}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={loading}>{loading ? "Creando..." : "Crear cuenta de atleta"}</Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
