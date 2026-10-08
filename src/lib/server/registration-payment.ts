import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentLink, getPaymentLink, type BoldLinkStatus } from "./bold";
import { sendEmail } from "./resend-server";
import { registrationPaidHtml, registrationPaidSubject } from "./email-templates/registration-paid";
import { registrationPaidAdminHtml, registrationPaidAdminSubject } from "./email-templates/registration-paid-admin";
import { dynamicPrice } from "../pricing";
import { bogotaToday, paymentWindow } from "../payment-window";

/** Bold: mínimo $1.000 por cobro; hasta $10.000.000 (tarjeta y PSE solo hasta $5.000.000). */
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 10_000_000;
const LINK_VALID_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
const REUSE_MIN_REMAINING_MS = 60 * 60 * 1000;
const MIN_USEFUL_LINK_MS = 10 * 60 * 1000;
/** Bold exige que la referencia sea alfanumérica, guion o guion bajo, de máximo 60 caracteres. */
const REFERENCE_RE = /^[A-Za-z0-9_-]{1,60}$/;

/**
 * Bold NO acepta reutilizar una referencia ("has been used before"), así que cada link lleva la suya:
 * <código de inscripción>-<sufijo>. Se guarda en registration_payment_links.reference, que es lo que
 * el webhook usa para volver a encontrar la inscripción.
 */
function newPaymentReference(qrCode: string): string {
  return `${qrCode}-${Date.now().toString(36).slice(-6)}`;
}

/** Inscripción a la que pertenece la referencia de un aviso de Bold (o el propio código si no hay link con esa referencia). */
export async function qrCodeFromReference(admin: SupabaseClient, reference: string): Promise<string> {
  const { data: row } = await admin.from("registration_payment_links").select("registration_id").eq("reference", reference).maybeSingle();
  if (!row) return reference;
  const { data: reg } = await admin.from("registrations").select("qr_code").eq("id", row.registration_id as string).maybeSingle();
  return (reg?.qr_code as string | undefined) ?? reference;
}

export type PrepareResult =
  | { ok: true; url: string; amount: number }
  | { ok: false; code: string; message: string; status: number };

function fail(code: string, message: string, status: number): PrepareResult {
  return { ok: false, code, message, status };
}

/** Texto sin tildes para la descripción del link (Bold la muestra tal cual al pagador). */
function plain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Crea (o reutiliza) el link de pago de una inscripción pendiente.
 *
 * El monto lo calcula el servidor: precio de la categoría con la tarifa dinámica
 * del día en que el atleta se inscribió. El monto que guardó el navegador al
 * inscribirse NO se usa para cobrar (se corrige en la inscripción si difiere).
 * Aplica el plazo de pago de la carrera y el link nunca vive más allá de él.
 */
export async function prepareRegistrationPayment(admin: SupabaseClient, qrCode: string, siteOrigin: string): Promise<PrepareResult> {
  if (!REFERENCE_RE.test(qrCode)) return fail("BAD_REQUEST", "Código de inscripción inválido", 400);

  const { data: reg } = await admin
    .from("registrations")
    .select("id, event_id, category_id, status, amount, created_at")
    .eq("qr_code", qrCode)
    .maybeSingle();
  if (!reg) return fail("NOT_FOUND", "No encontramos esa inscripción", 404);
  if (reg.status === "paid") return fail("ALREADY_PAID", "Esta inscripción ya está pagada", 409);
  if (reg.status !== "pending") return fail("NOT_PAYABLE", "Esta inscripción ya no se puede pagar", 409);

  const { data: event } = await admin
    .from("events")
    .select("id, title, date, status, payment_deadline")
    .eq("id", reg.event_id as string)
    .maybeSingle();
  if (!event) return fail("NOT_FOUND", "No encontramos la carrera", 404);
  if (event.status === "finished" || event.status === "cancelled" || (event.date as string) < bogotaToday()) {
    return fail("EVENT_CLOSED", "La carrera ya no recibe pagos", 409);
  }
  if (paymentWindow(event.payment_deadline as string | null) === "closed") {
    return fail("PAYMENT_CLOSED", `El plazo de pago venció el ${event.payment_deadline}. Pide a tu liga que lo extienda para poder pagar.`, 409);
  }

  const { data: category } = await admin
    .from("event_categories")
    .select("name, price")
    .eq("id", reg.category_id as string)
    .maybeSingle();
  if (!category || Number(category.price) <= 0) {
    return fail("NO_PRICE", "Esta categoría aún no tiene precio. Comunícate con tu liga.", 409);
  }

  const amount = dynamicPrice(Number(category.price), event.date as string, new Date(reg.created_at as string)).price;
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return fail("AMOUNT_OUT_OF_RANGE", "El valor de esta inscripción no se puede cobrar en línea. Comunícate con tu liga.", 409);
  }
  if (Number(reg.amount) !== amount) {
    await admin.from("registrations").update({ amount }).eq("id", reg.id as string);
  }

  const { data: existing } = await admin
    .from("registration_payment_links")
    .select("bold_link_id, payment_url, amount, expires_at")
    .eq("registration_id", reg.id as string)
    .maybeSingle();
  if (
    existing && Number(existing.amount) === amount && existing.expires_at &&
    new Date(existing.expires_at as string).getTime() - Date.now() > REUSE_MIN_REMAINING_MS
  ) {
    const current = await getPaymentLink(existing.bold_link_id as string);
    if (current.ok && current.link.status === "ACTIVE") return { ok: true, url: existing.payment_url as string, amount };
  }

  // El link no puede vivir más que el plazo de pago: si no, se podría pagar después de vencido.
  let expiresAt = new Date(Date.now() + LINK_VALID_MS);
  if (event.payment_deadline) {
    const deadlineEnd = new Date(`${event.payment_deadline}T23:59:00-05:00`);
    if (deadlineEnd < expiresAt) expiresAt = deadlineEnd;
  }
  if (expiresAt.getTime() - Date.now() < MIN_USEFUL_LINK_MS) {
    return fail("PAYMENT_CLOSED", "El plazo de pago está por vencer y ya no se puede generar un link. Comunícate con tu liga.", 409);
  }

  const reference = newPaymentReference(qrCode);
  if (!REFERENCE_RE.test(reference)) return fail("BAD_REQUEST", "Código de inscripción demasiado largo para generar el pago", 400);
  const created = await createPaymentLink({
    amount,
    reference,
    description: plain(`Inscripcion ${event.title} - ${category.name}`).slice(0, 100),
    expiresAt,
    callbackUrl: `${siteOrigin}/eventos/${event.id}?ref=${qrCode}`,
  });
  if (!created.ok) return fail("BOLD_ERROR", created.error, 502);

  const { error: upsertErr } = await admin.from("registration_payment_links").upsert({
    registration_id: reg.id,
    bold_link_id: created.linkId,
    payment_url: created.url,
    amount,
    reference,
    expires_at: expiresAt.toISOString(),
  }, { onConflict: "registration_id" });
  if (upsertErr) return fail("DB_ERROR", upsertErr.message, 500);

  return { ok: true, url: created.url, amount };
}

export type RegistrationActivation =
  | { state: "paid" }
  | { state: "paid_but_cancelled" }
  | { state: "not_paid"; boldStatus: BoldLinkStatus }
  | { state: "no_link" }
  | { state: "not_found" }
  | { state: "error"; error: string };

/**
 * Marca la inscripción como pagada SOLO si Bold confirma el pago del link (se consulta
 * a Bold, no se confía en el cuerpo de un webhook) y monto y referencia coinciden.
 * Idempotente: repetirla no duplica el pago ni el correo.
 */
export async function activateRegistrationIfPaid(admin: SupabaseClient, qrCode: string, panelUrl: string): Promise<RegistrationActivation> {
  const { data: reg } = await admin
    .from("registrations")
    .select("id, tenant_id, event_id, category_id, status, athlete_name, athlete_document, athlete_email")
    .eq("qr_code", qrCode)
    .maybeSingle();
  if (!reg) return { state: "not_found" };
  if (reg.status === "paid") return { state: "paid" };

  const { data: row } = await admin
    .from("registration_payment_links")
    .select("bold_link_id, amount, reference")
    .eq("registration_id", reg.id as string)
    .maybeSingle();
  if (!row) return { state: "no_link" };

  const res = await getPaymentLink(row.bold_link_id as string);
  if (!res.ok) return { state: "error", error: res.error };
  if (res.link.status !== "PAID") return { state: "not_paid", boldStatus: res.link.status };
  if (res.link.total !== Number(row.amount) || res.link.reference !== ((row.reference as string | null) ?? qrCode)) {
    return { state: "error", error: "El pago en Bold no coincide con el monto o la referencia esperados" };
  }
  if (reg.status === "cancelled") return { state: "paid_but_cancelled" };

  // Reclamo atómico: si dos avisos llegan a la vez, solo uno pasa de pending a paid.
  const { data: claimed, error: claimErr } = await admin
    .from("registrations")
    .update({ status: "paid" })
    .eq("id", reg.id as string)
    .eq("status", "pending")
    .select("id");
  if (claimErr) return { state: "error", error: claimErr.message };
  if (!claimed?.length) return { state: "paid" };

  await admin.from("payments").insert({
    registration_id: reg.id,
    transaction_id: res.link.transactionId ?? (row.bold_link_id as string),
    amount: Number(row.amount),
    method: res.link.paymentMethod ?? "bold",
    status: "approved",
  });

  // Avisos de inscripción confirmada: al atleta y a los administradores de la liga. Un correo que
  // falla nunca revierte el pago, y se envían en paralelo (Bold exige responder al webhook en < 2 s).
  const [{ data: event }, { data: category }, { data: admins }, { count: paidCount }] = await Promise.all([
    admin.from("events").select("title").eq("id", reg.event_id as string).maybeSingle(),
    admin.from("event_categories").select("name").eq("id", reg.category_id as string).maybeSingle(),
    admin.from("profiles").select("email").eq("tenant_id", reg.tenant_id as string).eq("role", "admin"),
    admin.from("registrations").select("id", { count: "exact", head: true }).eq("event_id", reg.event_id as string).eq("status", "paid"),
  ]);
  const eventTitle = (event?.title as string | undefined) ?? "la carrera";
  const categoryName = (category?.name as string | undefined) ?? "";
  const athleteName = (reg.athlete_name as string | null) ?? "Un atleta";
  const adminEmails = [...new Set((admins ?? []).map((a) => a.email as string | null).filter((e): e is string => Boolean(e)))];

  await Promise.all([
    reg.athlete_email
      ? sendEmail({
          to: reg.athlete_email as string,
          subject: registrationPaidSubject(eventTitle),
          html: registrationPaidHtml({ fullName: (reg.athlete_name as string | null) ?? "", eventTitle, categoryName, qrCode, amount: Number(row.amount) }),
        }).then((sent) => { if (!sent.ok) console.error("No se pudo enviar el correo de pago confirmado al atleta:", sent.error); })
      : Promise.resolve(),
    ...adminEmails.map((to) =>
      sendEmail({
        to,
        subject: registrationPaidAdminSubject(eventTitle, athleteName),
        html: registrationPaidAdminHtml({
          eventTitle, categoryName, athleteName,
          athleteDocument: (reg.athlete_document as string | null) ?? null,
          amount: Number(row.amount), paidCount: paidCount ?? 0, panelUrl,
        }),
      }).then((sent) => { if (!sent.ok) console.error("No se pudo avisar al administrador de la liga de la inscripción:", sent.error); })),
  ]);
  return { state: "paid" };
}
