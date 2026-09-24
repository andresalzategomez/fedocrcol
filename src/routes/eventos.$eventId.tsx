import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CalendarDays, CheckCircle2, CreditCard, Lock, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCOP, formatDate } from "@/data/demo";
import { dynamicPrice, fetchEvents, fetchLeagues, qrUrl } from "@/lib/ocr-data";
import { createRegistration } from "@/lib/registrations";
import { useTenantTheme } from "@/lib/tenant-theme";
import { useSession } from "@/lib/use-session";
import { supabase } from "@/lib/supabase";
import { LiveResults } from "@/components/live-results";

const schema = z.object({
  full_name: z.string().min(5, "Escribe tu nombre completo"),
  document_id: z.string().min(6, "Documento inválido").max(15),
  email: z.string().email("Correo inválido"),
  phone: z.string().min(7, "Teléfono inválido"),
  birth_date: z.string().min(4, "Fecha requerida"),
  gender: z.enum(["F", "M"], { message: "Selecciona una opción" }),
  category_id: z.string().min(1, "Selecciona una categoría"),
});
type FormValues = z.infer<typeof schema>;

const DOCUMENT_TYPE_LABEL: Record<string, string> = { CC: "C.C.", TI: "T.I.", CE: "C.E.", PA: "Pasaporte" };

export const Route = createFileRoute("/eventos/$eventId")({
  loader: async ({ params }) => {
    const [events, leagues] = await Promise.all([fetchEvents(), fetchLeagues()]);
    const event = events.find((e) => e.id === params.eventId);
    if (!event) throw notFound();
    const league = leagues.find((l) => l.id === event.tenant_id) ?? null;
    return { event, league };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Carrera no encontrada — FEDOCR" }, { name: "robots", content: "noindex" }] };
    const { event } = loaderData;
    const desc = `Inscripción oficial a ${event.title}: ${event.distance_km} km y ${event.obstacles} obstáculos en ${event.location}.`;
    return {
      meta: [
        { title: `${event.title} — Inscripción OCR` },
        { name: "description", content: desc },
        { property: "og:title", content: `${event.title} — Inscripción OCR` },
        { property: "og:description", content: desc },
      ],
    };
  },
  errorComponent: () => <p className="p-10 text-center">No pudimos cargar la carrera.</p>,
  notFoundComponent: () => <p className="p-10 text-center">Carrera no encontrada.</p>,
  component: EventDetail,
});

function EventDetail() {
  const { event, league } = Route.useLoaderData();
  useTenantTheme(league ? { primary_color: league.primary_color, secondary_color: league.secondary_color } : null);

  const [ticket, setTicket] = useState<{ code: string; amount: number; category: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { profile, email: sessionEmail } = useSession();
  const [personalDataLocked, setPersonalDataLocked] = useState(false);
  const [quickCategoryId, setQuickCategoryId] = useState("");

  /**
   * Si la cuenta ya tiene todos sus datos personales (los pide el registro
   * de atleta desde que existe /api/public/register-athlete con estos
   * campos -- cuentas viejas pueden no tenerlos), no hace falta volver a
   * pedirlos: el formulario se reduce a elegir la categoría.
   */
  const hasCompleteProfile = Boolean(
    profile?.full_name && profile.document_id && profile.phone && profile.birth_date && profile.gender,
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", document_id: "", email: "", phone: "", birth_date: "", category_id: "" },
  });

  /**
   * Si el atleta ya inició sesión, su correo de cuenta se prellena y bloquea
   * siempre (es el dato de su cuenta, no de este formulario). Si además ya
   * tiene una inscripción previa en cualquier carrera, se usan esos datos
   * (nombre, documento, teléfono, fecha de nacimiento, género) para
   * prellenar y bloquear el resto -- así no los vuelve a escribir cada vez.
   * Un atleta nuevo sin inscripciones previas ve el formulario normal,
   * vacío y editable.
   */
  useEffect(() => {
    if (!profile || hasCompleteProfile) return;
    form.setValue("email", sessionEmail ?? "");
    if (!supabase) return;
    let active = true;
    supabase
      .from("registrations")
      .select("athlete_name, athlete_document, athlete_email, athlete_phone, athlete_birth_date, athlete_gender")
      .eq("athlete_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        form.reset({
          ...form.getValues(),
          full_name: data.athlete_name ?? "",
          document_id: data.athlete_document ?? "",
          email: data.athlete_email ?? sessionEmail ?? "",
          phone: data.athlete_phone ?? "",
          birth_date: data.athlete_birth_date ?? "",
          gender: data.athlete_gender === "F" || data.athlete_gender === "M" ? data.athlete_gender : undefined,
        });
        setPersonalDataLocked(true);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, sessionEmail]);

  const selected = event.categories.find((c) => c.id === form.watch("category_id"));
  const pricing = selected ? dynamicPrice(selected.price, event.date) : null;

  async function registerForCategory(categoryId: string, athlete: {
    full_name: string; document_id: string; email: string; phone: string; birth_date: string; gender: "F" | "M";
  }) {
    const category = event.categories.find((c) => c.id === categoryId);
    if (!category) return;
    if (category.slots_available <= 0) {
      toast.error("Sin cupos disponibles en esta categoría");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createRegistration({
        event_id: event.id,
        tenant_id: event.tenant_id,
        category_id: category.id,
        athlete,
        amount: dynamicPrice(category.price, event.date).price,
      });
      setTicket({ code: result.qr_code, amount: result.amount, category: category.name });
      toast.success("Inscripción creada. Continúa con el pago.");
    } catch {
      toast.error("No pudimos crear la inscripción. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(values: FormValues) {
    await registerForCategory(values.category_id, values);
  }

  async function onQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quickCategoryId) { toast.error("Selecciona una categoría"); return; }
    if (!profile || (profile.gender !== "F" && profile.gender !== "M")) return;
    await registerForCategory(quickCategoryId, {
      full_name: profile.full_name ?? "",
      document_id: profile.document_id ?? "",
      email: sessionEmail ?? "",
      phone: profile.phone ?? "",
      birth_date: profile.birth_date ?? "",
      gender: profile.gender,
    });
  }

  return (
    <div className="min-h-screen">
      <SiteHeader activeLeagueSlug={league?.slug} />

      <section className="surface-grit border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <Link to="/ligas/$slug" params={{ slug: league?.slug ?? "" }}>
            <Badge variant="outline" className="mb-3">{league?.department}</Badge>
          </Link>
          <h1 className="font-display text-5xl sm:text-6xl">{event.title}</h1>
          <div className="mt-4 flex flex-wrap gap-5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><CalendarDays className="size-4" />{formatDate(event.date)}</span>
            <span className="flex items-center gap-1.5"><MapPin className="size-4" />{event.location}</span>
            <span>{event.distance_km} km · {event.obstacles} obstáculos</span>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="border-border/70">
          <CardContent className="p-6 sm:p-8">
            <h2 className="font-display text-3xl">Formulario de inscripción</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Los datos quedan asociados a tu perfil de atleta en la liga de {league?.department}.
            </p>
            {hasCompleteProfile ? (
              <form onSubmit={onQuickSubmit} className="mt-6 grid gap-5">
                <div className="rounded-lg border border-border/70 bg-accent/40 p-4 text-sm">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Lock className="size-3.5 text-muted-foreground" /> Tus datos de atleta
                  </p>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    <div className="flex justify-between sm:justify-start sm:gap-2"><dt className="text-muted-foreground">Nombre:</dt><dd>{profile?.full_name}</dd></div>
                    <div className="flex justify-between sm:justify-start sm:gap-2"><dt className="text-muted-foreground">Documento:</dt><dd>{DOCUMENT_TYPE_LABEL[profile?.document_type ?? ""] ?? profile?.document_type} {profile?.document_id}</dd></div>
                    <div className="flex justify-between sm:justify-start sm:gap-2"><dt className="text-muted-foreground">Nacimiento:</dt><dd>{profile?.birth_date}</dd></div>
                    <div className="flex justify-between sm:justify-start sm:gap-2"><dt className="text-muted-foreground">Celular:</dt><dd>{profile?.phone}</dd></div>
                    <div className="flex justify-between sm:justify-start sm:gap-2"><dt className="text-muted-foreground">Género:</dt><dd>{profile?.gender === "F" ? "Femenino" : "Masculino"}</dd></div>
                    <div className="flex justify-between sm:justify-start sm:gap-2"><dt className="text-muted-foreground">Correo:</dt><dd>{sessionEmail}</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    ¿Algo está mal? Actualízalo desde tu perfil, no se puede editar aquí.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="quick-category">Categoría</Label>
                  <Select value={quickCategoryId} onValueChange={setQuickCategoryId}>
                    <SelectTrigger id="quick-category"><SelectValue placeholder="Selecciona categoría" /></SelectTrigger>
                    <SelectContent>
                      {event.categories.map((c) => (
                        <SelectItem key={c.id} value={c.id} disabled={c.slots_available <= 0}>
                          {c.name} — {c.slots_available} cupos
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                    <CreditCard className="mr-2 size-4" />
                    {submitting ? "Procesando..." : "Continuar al pago"}
                  </Button>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Pago seguro con Bold / PayU · PSE, tarjetas y Nequi
                  </p>
                </div>
              </form>
            ) : (
              <>
                {personalDataLocked ? (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" /> Tus datos personales vienen de tu inscripción anterior y no se pueden editar aquí.
                  </p>
                ) : null}
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 grid gap-5 sm:grid-cols-2">
                    <FormField control={form.control} name="full_name" render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Nombre completo</FormLabel>
                        <FormControl><Input placeholder="Andrés Felipe Alzate" {...field} disabled={personalDataLocked} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="document_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Documento</FormLabel>
                        <FormControl><Input placeholder="1020304050" {...field} disabled={personalDataLocked} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="birth_date" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fecha de nacimiento</FormLabel>
                        <FormControl><Input type="date" {...field} disabled={personalDataLocked} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Correo</FormLabel>
                        <FormControl><Input type="email" placeholder="atleta@correo.com" {...field} disabled={Boolean(profile)} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Celular</FormLabel>
                        <FormControl><Input placeholder="3001234567" {...field} disabled={personalDataLocked} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="gender" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Género</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange} disabled={personalDataLocked}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="F">Femenino</SelectItem>
                            <SelectItem value="M">Masculino</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="category_id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categoría</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecciona categoría" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {event.categories.map((c) => (
                              <SelectItem key={c.id} value={c.id} disabled={c.slots_available <= 0}>
                                {c.name} — {c.slots_available} cupos
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="sm:col-span-2">
                      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                        <CreditCard className="mr-2 size-4" />
                        {submitting ? "Procesando..." : "Continuar al pago"}
                      </Button>
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        Pago seguro con Bold / PayU · PSE, tarjetas y Nequi
                      </p>
                    </div>
                  </form>
                </Form>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-border/70">
            <CardContent className="p-6">
              <h3 className="font-display text-2xl">Resumen</h3>
              <div className="mt-4 space-y-3 text-sm">
                {event.categories.map((c) => {
                  const p = dynamicPrice(c.price, event.date);
                  return (
                    <div key={c.id} className="flex items-center justify-between border-b border-border/60 pb-2">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{p.stage} · {c.slots_available} cupos</p>
                      </div>
                      <p className="font-semibold text-primary">{formatCOP(p.price)}</p>
                    </div>
                  );
                })}
              </div>
              {pricing ? (
                <div className="mt-5 rounded bg-accent p-4">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Total a pagar</p>
                  <p className="font-display text-4xl text-primary">{formatCOP(pricing.price)}</p>
                  <p className="text-xs text-muted-foreground">{pricing.stage}</p>
                </div>
              ) : null}
              <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                El cupo se reserva como “Pendiente” y se confirma automáticamente con el webhook de la pasarela.
              </p>
            </CardContent>
          </Card>

          {ticket ? (
            <Card className="border-secondary/60">
              <CardContent className="p-6 text-center">
                <CheckCircle2 className="mx-auto size-8 text-secondary" />
                <h3 className="mt-2 font-display text-2xl">Inscripción registrada</h3>
                <p className="text-sm text-muted-foreground">
                  {ticket.category} · {formatCOP(ticket.amount)} · estado: pendiente de pago
                </p>
                <img
                  src={qrUrl(ticket.code)}
                  alt={`Código QR del comprobante ${ticket.code}`}
                  className="mx-auto mt-4 rounded bg-white p-2"
                  width={220}
                  height={220}
                  loading="lazy"
                />
                <p className="mt-2 font-mono text-xs text-muted-foreground">{ticket.code}</p>
                <Button className="mt-4 w-full" asChild>
                  <a href={`/api/public/pagos/checkout?ref=${ticket.code}&amount=${ticket.amount}`}>
                    Ir a la pasarela de pago
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {event.visibility === "public" ? (
        <div className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
          <LiveResults eventId={event.id} />
        </div>
      ) : null}

      <SiteFooter />
    </div>
  );
}
