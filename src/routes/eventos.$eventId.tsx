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
import { TableCell, TableRow } from "@/components/ui/table";
import { SimpleTable } from "@/components/simple-table";
import { formatCOP, formatDate } from "@/data/demo";
import { countRegistrationsByCategory, dynamicPrice, fetchEvents, fetchLeagues, fetchPublicRegistrations, qrUrl, type PublicRegistration } from "@/lib/ocr-data";
import { createRegistration } from "@/lib/registrations";
import { useTenantTheme } from "@/lib/tenant-theme";
import { useSession } from "@/lib/use-session";
import { supabase } from "@/lib/supabase";
import { LiveResults } from "@/components/live-results";

const REGISTRATION_LIST_STATUS_LABEL: Record<string, string> = { pending: "Pendiente", paid: "Pagada" };

const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;
const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

const schema = z.object({
  full_name: z.string().min(5, "Escribe tu nombre completo"),
  document_id: z.string().min(6, "Documento inválido").max(15),
  email: z.string().email("Correo inválido"),
  phone: z.string().min(7, "Teléfono inválido"),
  birth_date: z.string().min(4, "Fecha requerida"),
  gender: z.enum(["F", "M"], { message: "Selecciona una opción" }),
  category_id: z.string().min(1, "Selecciona una categoría"),
  social_media: z.string().optional(),
  eps: z.string().min(2, "Escribe tu EPS"),
  blood_type: z.enum(BLOOD_TYPES, { message: "Selecciona tu RH" }),
  emergency_contact_name: z.string().min(3, "Escribe el nombre de contacto"),
  emergency_contact_phone: z.string().min(7, "Teléfono inválido"),
  shirt_name: z.string().min(1, "Escribe el nombre para la camiseta"),
  shirt_size: z.enum(SHIRT_SIZES, { message: "Selecciona la talla" }),
});
type FormValues = z.infer<typeof schema>;

const DOCUMENT_TYPE_LABEL: Record<string, string> = { CC: "C.C.", TI: "T.I.", CE: "C.E.", PA: "Pasaporte" };
const REGISTRATION_STATUS_LABEL: Record<string, string> = { pending: "pendiente de pago", paid: "pagada", cancelled: "cancelada" };

type Ticket = { code: string; amount: number; category: string; status: string; preexisting: boolean };

/** Confirmación con QR -- se muestra igual en el layout completo (barra lateral) y en el minimal (bajo el formulario). */
function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <Card className="border-secondary/60">
      <CardContent className="p-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-secondary" />
        <h3 className="mt-2 font-display text-2xl">Inscripción registrada</h3>
        <p className="text-sm text-muted-foreground">
          {ticket.category} · {formatCOP(ticket.amount)} · estado: {REGISTRATION_STATUS_LABEL[ticket.status] ?? ticket.status}
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
        {ticket.status === "pending" ? (
          <Button className="mt-4 w-full" asChild>
            <a href={`/api/public/pagos/checkout?ref=${ticket.code}&amount=${ticket.amount}`}>
              Ir a la pasarela de pago
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/eventos/$eventId")({
  validateSearch: (search: Record<string, unknown>): { minimal?: true } => {
    const minimal = search.minimal === "1" || search.minimal === 1 || search.minimal === true || search.minimal === "true";
    return minimal ? { minimal: true } : {};
  },
  loader: async ({ params }) => {
    const [events, leagues] = await Promise.all([fetchEvents(), fetchLeagues()]);
    const rawEvent = events.find((e) => e.id === params.eventId);
    if (!rawEvent) throw notFound();
    const league = leagues.find((l) => l.id === rawEvent.tenant_id) ?? null;
    const registrations = await fetchPublicRegistrations([rawEvent.id]);
    const countByCategory = countRegistrationsByCategory(registrations);
    const event = {
      ...rawEvent,
      registered: registrations.length,
      categories: rawEvent.categories.map((c) => ({
        ...c,
        slots_available: Math.max(0, c.slots_available - (countByCategory.get(c.id) ?? 0)),
      })),
    };
    return { event, league, registrations };
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
  const { event, league, registrations } = Route.useLoaderData();
  const { minimal } = Route.useSearch();
  useTenantTheme(league ? { primary_color: league.primary_color, secondary_color: league.secondary_color } : null);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { profile, email: sessionEmail } = useSession();
  const [personalDataLocked, setPersonalDataLocked] = useState(false);
  const [quickCategoryId, setQuickCategoryId] = useState("");
  const [quickExtra, setQuickExtra] = useState({
    social_media: "",
    eps: "",
    blood_type: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    shirt_name: "",
    shirt_size: "",
  });

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
    defaultValues: {
      full_name: "", document_id: "", email: "", phone: "", birth_date: "", category_id: "",
      social_media: "", eps: "", emergency_contact_name: "", emergency_contact_phone: "", shirt_name: "",
    },
  });

  /**
   * Estos 7 campos no bloquean el formulario rápido (a diferencia de los
   * datos de identidad): se precargan de profiles si ya se guardaron en
   * una inscripción anterior, pero siguen editables -- por ejemplo la
   * talla de camiseta puede cambiar de una carrera a otra.
   */
  useEffect(() => {
    if (!profile) return;
    setQuickExtra({
      social_media: profile.social_media ?? "",
      eps: profile.eps ?? "",
      blood_type: profile.blood_type ?? "",
      emergency_contact_name: profile.emergency_contact_name ?? "",
      emergency_contact_phone: profile.emergency_contact_phone ?? "",
      shirt_name: profile.shirt_name ?? "",
      shirt_size: profile.shirt_size ?? "",
    });
    if (!hasCompleteProfile) {
      form.setValue("social_media", profile.social_media ?? "");
      form.setValue("eps", profile.eps ?? "");
      if (profile.blood_type) form.setValue("blood_type", profile.blood_type as FormValues["blood_type"]);
      form.setValue("emergency_contact_name", profile.emergency_contact_name ?? "");
      form.setValue("emergency_contact_phone", profile.emergency_contact_phone ?? "");
      form.setValue("shirt_name", profile.shirt_name ?? "");
      if (profile.shirt_size) form.setValue("shirt_size", profile.shirt_size as FormValues["shirt_size"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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
      .select("athlete_name, athlete_document, athlete_email, athlete_phone, athlete_birth_date, athlete_gender, athlete_social_media, athlete_eps, athlete_blood_type, athlete_emergency_contact_name, athlete_emergency_contact_phone, athlete_shirt_name, athlete_shirt_size")
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
          social_media: data.athlete_social_media ?? "",
          eps: data.athlete_eps ?? "",
          blood_type: (data.athlete_blood_type as FormValues["blood_type"]) ?? undefined,
          emergency_contact_name: data.athlete_emergency_contact_name ?? "",
          emergency_contact_phone: data.athlete_emergency_contact_phone ?? "",
          shirt_name: data.athlete_shirt_name ?? "",
          shirt_size: (data.athlete_shirt_size as FormValues["shirt_size"]) ?? undefined,
        });
        setPersonalDataLocked(true);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, sessionEmail]);

  /**
   * Si el atleta ya tiene una inscripción (no cancelada) para ESTA carrera,
   * se carga esa inscripción en vez de mostrar el formulario -- evita que
   * intente inscribirse dos veces (el índice único en base de datos ya lo
   * bloquea, pero esto lo evita desde la UI directamente).
   */
  useEffect(() => {
    if (!profile || !supabase) return;
    let active = true;
    supabase
      .from("registrations")
      .select("qr_code, amount, category_id, status")
      .eq("event_id", event.id)
      .eq("athlete_id", profile.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const category = event.categories.find((c) => c.id === data.category_id);
        setTicket({
          code: data.qr_code,
          amount: data.amount,
          category: category?.name ?? "—",
          status: data.status,
          preexisting: true,
        });
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, event.id]);

  const selected = event.categories.find((c) => c.id === form.watch("category_id"));
  const pricing = selected ? dynamicPrice(selected.price, event.date) : null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDate = event.date < todayStr;
  const isFinished = event.status === "finished";
  const registrationsClosed = isPastDate || isFinished;

  async function registerForCategory(categoryId: string, athlete: {
    full_name: string; document_id: string; email: string; phone: string; birth_date: string; gender: "F" | "M";
    social_media?: string | undefined; eps: string; blood_type: string; emergency_contact_name: string;
    emergency_contact_phone: string; shirt_name: string; shirt_size: string;
  }) {
    if (registrationsClosed) {
      toast.error("Las inscripciones para esta carrera están cerradas.");
      return;
    }
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
      setTicket({ code: result.qr_code, amount: result.amount, category: category.name, status: result.status, preexisting: false });
      toast.success("Inscripción creada. Continúa con el pago.");

      // Best-effort: la inscripción ya quedó creada, así que un correo que
      // falla no debe interrumpir la pantalla de éxito -- solo se registra
      // en consola para depurar.
      fetch("/api/public/registration-confirmation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: athlete.email,
          full_name: athlete.full_name,
          event_title: event.title,
          category_name: category.name,
          qr_code: result.qr_code,
          amount: result.amount,
        }),
      })
        .then((res) => { if (!res.ok) console.error("No se pudo enviar el correo de confirmación de inscripción:", res.status); })
        .catch((e) => console.error("No se pudo enviar el correo de confirmación de inscripción:", e));
    } catch (e) {
      const message = e instanceof Error && e.message.includes("Ya existe una inscripción")
        ? e.message
        : "No pudimos crear la inscripción. Intenta de nuevo.";
      toast.error(message);
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
    if (!quickExtra.eps.trim()) { toast.error("Escribe tu EPS"); return; }
    if (!quickExtra.blood_type) { toast.error("Selecciona tu RH"); return; }
    if (!quickExtra.emergency_contact_name.trim()) { toast.error("Escribe el contacto de emergencia"); return; }
    if (!quickExtra.emergency_contact_phone.trim()) { toast.error("Escribe el celular del contacto de emergencia"); return; }
    if (!quickExtra.shirt_name.trim()) { toast.error("Escribe el nombre para la camiseta"); return; }
    if (!quickExtra.shirt_size) { toast.error("Selecciona la talla de camiseta"); return; }
    await registerForCategory(quickCategoryId, {
      full_name: profile.full_name ?? "",
      document_id: profile.document_id ?? "",
      email: sessionEmail ?? "",
      phone: profile.phone ?? "",
      birth_date: profile.birth_date ?? "",
      gender: profile.gender,
      social_media: quickExtra.social_media,
      eps: quickExtra.eps,
      blood_type: quickExtra.blood_type,
      emergency_contact_name: quickExtra.emergency_contact_name,
      emergency_contact_phone: quickExtra.emergency_contact_phone,
      shirt_name: quickExtra.shirt_name,
      shirt_size: quickExtra.shirt_size,
    });
  }

  return (
    <div className="min-h-screen">
      <SiteHeader activeLeagueSlug={league?.slug} minimalNav={minimal} />

      {!minimal ? (
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
      ) : (
        <div className="mx-auto max-w-2xl px-4 pt-10 sm:px-6">
          <h1 className="font-display text-3xl">{event.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(event.date)} · {event.location}</p>
        </div>
      )}

      <div className={minimal ? "mx-auto max-w-2xl px-4 py-8 sm:px-6" : "mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_1fr]"}>
        <Card className="border-border/70">
          <CardContent className="p-6 sm:p-8">
            <h2 className="font-display text-3xl">Formulario de inscripción</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Los datos quedan asociados a tu perfil de atleta en la liga de {league?.department}.
            </p>
            {ticket ? (
              <div className="mt-6 rounded-lg border border-secondary/60 bg-secondary/10 p-5 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-secondary">
                  <CheckCircle2 className="size-4" />
                  {ticket.preexisting ? "Ya estás inscrito en esta carrera" : "¡Tu inscripción quedó registrada!"}
                </p>
                <p className="mt-2 text-muted-foreground">
                  Categoría <strong>{ticket.category}</strong> · estado: {REGISTRATION_STATUS_LABEL[ticket.status] ?? ticket.status}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{ticket.code}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Revisa el comprobante y el código QR a la derecha.
                </p>
              </div>
            ) : registrationsClosed ? (
              <div className="mt-6 rounded-lg border border-border/70 bg-accent/40 p-5 text-sm text-muted-foreground">
                Las inscripciones para esta carrera están cerradas{isFinished ? " -- la carrera ya finalizó." : " -- la fecha de la carrera ya pasó."}
              </div>
            ) : hasCompleteProfile ? (
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
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="quick-social">Redes sociales (opcional)</Label>
                    <Input id="quick-social" placeholder="@usuario" value={quickExtra.social_media}
                      onChange={(e) => setQuickExtra((v) => ({ ...v, social_media: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="quick-eps">EPS</Label>
                    <Input id="quick-eps" placeholder="Nombre de tu EPS" value={quickExtra.eps}
                      onChange={(e) => setQuickExtra((v) => ({ ...v, eps: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="quick-blood">RH</Label>
                    <Select value={quickExtra.blood_type} onValueChange={(v) => setQuickExtra((s) => ({ ...s, blood_type: v }))}>
                      <SelectTrigger id="quick-blood"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                      <SelectContent>
                        {BLOOD_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="quick-ec-name">Contacto de emergencia</Label>
                    <Input id="quick-ec-name" placeholder="Nombre completo" value={quickExtra.emergency_contact_name}
                      onChange={(e) => setQuickExtra((v) => ({ ...v, emergency_contact_name: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="quick-ec-phone">Celular contacto de emergencia</Label>
                    <Input id="quick-ec-phone" placeholder="3001234567" value={quickExtra.emergency_contact_phone}
                      onChange={(e) => setQuickExtra((v) => ({ ...v, emergency_contact_phone: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="quick-shirt-name">Nombre para camiseta</Label>
                    <Input id="quick-shirt-name" placeholder="Como quieres que salga" value={quickExtra.shirt_name}
                      onChange={(e) => setQuickExtra((v) => ({ ...v, shirt_name: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="quick-shirt-size">Talla para camiseta</Label>
                    <Select value={quickExtra.shirt_size} onValueChange={(v) => setQuickExtra((s) => ({ ...s, shirt_size: v }))}>
                      <SelectTrigger id="quick-shirt-size"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                      <SelectContent>
                        {SHIRT_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
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
                    <FormField control={form.control} name="social_media" render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Redes sociales (opcional)</FormLabel>
                        <FormControl><Input placeholder="@usuario" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="eps" render={({ field }) => (
                      <FormItem>
                        <FormLabel>EPS</FormLabel>
                        <FormControl><Input placeholder="Nombre de tu EPS" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="blood_type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>RH</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {BLOOD_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="emergency_contact_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contacto de emergencia</FormLabel>
                        <FormControl><Input placeholder="Nombre completo" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="emergency_contact_phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Celular contacto de emergencia</FormLabel>
                        <FormControl><Input placeholder="3001234567" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="shirt_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre para camiseta</FormLabel>
                        <FormControl><Input placeholder="Como quieres que salga" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="shirt_size" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Talla para camiseta</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {SHIRT_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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

        {minimal ? (
          ticket ? <div className="mt-6"><TicketCard ticket={ticket} /></div> : null
        ) : (
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

            {ticket ? <TicketCard ticket={ticket} /> : null}
          </div>
        )}
      </div>

      {!minimal ? (
        <>
          <div className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
            <h2 className="font-display text-3xl">Inscritos</h2>
            {registrations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Todavía no hay inscritos en esta carrera.</p>
            ) : (
              <div className="mt-5">
                <SimpleTable head={["Dorsal", "Atleta", "Categoría", "Estado"]}>
                  {registrations.map((r: PublicRegistration) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-muted-foreground">{r.bib_number ?? "—"}</TableCell>
                      <TableCell className="font-medium">{r.athlete_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{r.category_name}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.status === "paid" ? "default" : "outline"}>
                          {REGISTRATION_LIST_STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </SimpleTable>
              </div>
            )}
          </div>

          {event.visibility === "public" && (event.status === "in_progress" || event.status === "finished") ? (
            <div className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
              <LiveResults eventId={event.id} />
            </div>
          ) : null}

          <SiteFooter />
        </>
      ) : null}
    </div>
  );
}
