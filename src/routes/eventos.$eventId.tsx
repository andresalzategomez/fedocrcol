import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";
import { CalendarDays, CheckCircle2, CreditCard, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEMO_EVENTS, formatCOP, formatDate, leagueById } from "@/data/demo";
import { dynamicPrice, qrUrl } from "@/lib/ocr-data";
import { createRegistration } from "@/lib/registrations";
import { useTenantTheme } from "@/lib/tenant-theme";

const schema = z.object({
  full_name: z.string().min(5, "Escribe tu nombre completo"),
  document_id: z.string().min(6, "Documento inválido").max(15),
  email: z.string().email("Correo inválido"),
  phone: z.string().min(7, "Teléfono inválido"),
  birth_date: z.string().min(4, "Fecha requerida"),
  gender: z.enum(["F", "M", "X"], { message: "Selecciona una opción" }),
  category_id: z.string().min(1, "Selecciona una categoría"),
});
type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/eventos/$eventId")({
  loader: ({ params }) => {
    const event = DEMO_EVENTS.find((e) => e.id === params.eventId);
    if (!event) throw notFound();
    return { event };
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
  const { event } = Route.useLoaderData();
  const league = leagueById(event.tenant_id);
  useTenantTheme(league ? { primary_color: league.primary_color, secondary_color: league.secondary_color } : null);

  const [ticket, setTicket] = useState<{ code: string; amount: number; category: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", document_id: "", email: "", phone: "", birth_date: "", category_id: "" },
  });

  const selected = event.categories.find((c) => c.id === form.watch("category_id"));
  const pricing = selected ? dynamicPrice(selected.price, event.date) : null;

  async function onSubmit(values: FormValues) {
    const category = event.categories.find((c) => c.id === values.category_id);
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
        athlete: values,
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
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 grid gap-5 sm:grid-cols-2">
                <FormField control={form.control} name="full_name" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Nombre completo</FormLabel>
                    <FormControl><Input placeholder="Andrés Felipe Alzate" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="document_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Documento</FormLabel>
                    <FormControl><Input placeholder="1020304050" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="birth_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de nacimiento</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo</FormLabel>
                    <FormControl><Input type="email" placeholder="atleta@correo.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Celular</FormLabel>
                    <FormControl><Input placeholder="3001234567" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="gender" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Género</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="F">Femenino</SelectItem>
                        <SelectItem value="M">Masculino</SelectItem>
                        <SelectItem value="X">Otro</SelectItem>
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

      <SiteFooter />
    </div>
  );
}
