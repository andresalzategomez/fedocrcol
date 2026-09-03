import { supabase } from "./supabase";

/**
 * Capa de datos del panel de administración (contra Supabase, respetando RLS).
 * Todas las funciones asumen que `supabase` está configurado; la UI valida
 * `isSupabaseConfigured` antes de usarlas.
 */
function db() {
  if (!supabase) throw new Error("Supabase no está configurado (revisa las variables VITE_).");
  return supabase;
}

// ----------------------------- Tipos ---------------------------------
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  department: string;
  city: string | null;
  primary_color: string;
  secondary_color: string;
  status: "active" | "suspended";
}
export type EventStatus = "draft" | "pending_federation" | "approved" | "in_progress" | "finished" | "cancelled";
export interface EventRow {
  id: string;
  tenant_id: string;
  title: string;
  date: string;
  location: string;
  distance_km: number | null;
  obstacles: number | null;
  max_capacity: number;
  published: boolean;
  status: EventStatus;
  league_approved: boolean;
  federation_approved: boolean;
}
export interface EventCategory { id: string; event_id: string; name: string; price: number; slots_available: number; gender: string | null; min_age: number | null; max_age: number | null; }
export interface Checkpoint { id: string; event_id: string; name: string; ord: number; is_start: boolean; is_finish: boolean; }
export interface Wave { id: string; event_id: string; wave_number: number | null; name: string; scheduled_time: string | null; status: string; }
export interface Category { id: string; name: string; level: string; gender: string; }
export interface Registration {
  id: string; event_id: string; bib_number: number | null; wave_id: string | null;
  status: string; athlete_name: string | null; athlete_document: string | null;
  athlete_gender: string | null; ranking_category_id: string | null; category_id: string;
}

// --------------------------- Ligas (tenants) -------------------------
export async function listTenants(): Promise<Tenant[]> {
  const { data, error } = await db().from("tenants").select("*").order("name");
  if (error) throw error;
  return data as Tenant[];
}

export async function createTenant(input: {
  name: string; slug: string; department: string; city?: string;
  primary_color?: string; secondary_color?: string;
}): Promise<Tenant> {
  const { data, error } = await db().from("tenants").insert({
    name: input.name,
    slug: input.slug,
    department: input.department,
    city: input.city ?? null,
    primary_color: input.primary_color ?? "#2de47f",
    secondary_color: input.secondary_color ?? "#ff9f1c",
    status: "active",
  }).select("*").single();
  if (error) throw error;
  return data as Tenant;
}

export async function setTenantStatus(id: string, status: "active" | "suspended") {
  const { error } = await db().from("tenants").update({ status }).eq("id", id);
  if (error) throw error;
}

// ------------------------------ Eventos ------------------------------
export async function listEvents(tenantId: string): Promise<EventRow[]> {
  const { data, error } = await db().from("events").select("*").eq("tenant_id", tenantId).order("date", { ascending: false });
  if (error) throw error;
  return data as EventRow[];
}

export async function createEvent(input: {
  tenant_id: string; title: string; date: string; location: string;
  distance_km?: number; obstacles?: number; max_capacity?: number;
}): Promise<EventRow> {
  const { data, error } = await db().from("events").insert({
    tenant_id: input.tenant_id,
    title: input.title,
    date: input.date,
    location: input.location,
    distance_km: input.distance_km ?? null,
    obstacles: input.obstacles ?? null,
    max_capacity: input.max_capacity ?? 0,
    published: false,
    status: "draft",
  }).select("*").single();
  if (error) throw error;
  const ev = data as EventRow;
  // Sembrar el maestro de categorías de la carrera con el catálogo nacional.
  await seedStandardCategories(ev.id);
  return ev;
}

/** Copia el catálogo nacional de categorías al maestro de esta carrera. */
export async function seedStandardCategories(eventId: string): Promise<void> {
  const cats = await listCategories();
  if (!cats.length) return;
  const rows = cats.map((c) => ({
    event_id: eventId, name: c.name, gender: (c as unknown as { gender: string }).gender ?? null,
    price: 0, slots_available: 0,
  }));
  // Evitar duplicados si ya hay categorías con esos nombres.
  const existing = await listEventCategories(eventId);
  const have = new Set(existing.map((e) => e.name));
  const toInsert = rows.filter((r) => !have.has(r.name));
  if (toInsert.length) {
    const { error } = await db().from("event_categories").insert(toInsert);
    if (error) throw error;
  }
}

/** Eventos pendientes de aprobación de la federación (todas las ligas). */
export async function listPendingFederation(): Promise<EventRow[]> {
  const { data, error } = await db().from("events").select("*").eq("status", "pending_federation").order("date");
  if (error) throw error;
  return data as EventRow[];
}

/** La liga envía el evento a aprobación de la federación. */
export async function submitEvent(id: string) {
  const { error } = await db().from("events")
    .update({ status: "pending_federation", league_approved: true, submitted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** La federación aprueba el evento (queda publicado y descargable por el Timer). */
export async function approveEvent(id: string) {
  const { error } = await db().from("events")
    .update({ status: "approved", federation_approved: true, published: true, approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** La federación rechaza: vuelve a borrador para que la liga lo corrija. */
export async function rejectEvent(id: string) {
  const { error } = await db().from("events")
    .update({ status: "draft", league_approved: false, federation_approved: false, published: false })
    .eq("id", id);
  if (error) throw error;
}

/** Cambia el estado de carrera (in_progress / finished / cancelled). */
export async function setEventStatus(id: string, status: EventStatus) {
  const { error } = await db().from("events").update({ status }).eq("id", id);
  if (error) throw error;
}

// --------------------------- Modalidades -----------------------------
export async function listEventCategories(eventId: string): Promise<EventCategory[]> {
  const { data, error } = await db().from("event_categories").select("*").eq("event_id", eventId).order("name");
  if (error) throw error;
  return data as EventCategory[];
}
export async function createEventCategory(eventId: string, input: {
  name: string; gender?: string | null; min_age?: number | null; max_age?: number | null;
}) {
  const { error } = await db().from("event_categories").insert({
    event_id: eventId, name: input.name, gender: input.gender ?? null,
    min_age: input.min_age ?? null, max_age: input.max_age ?? null, price: 0, slots_available: 0,
  });
  if (error) throw error;
}

export async function deleteEventCategory(id: string) {
  const { error } = await db().from("event_categories").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------- Checkpoints ----------------------------
export async function listCheckpoints(eventId: string): Promise<Checkpoint[]> {
  const { data, error } = await db().from("checkpoints").select("*").eq("event_id", eventId).order("ord");
  if (error) throw error;
  return data as Checkpoint[];
}
export async function createCheckpoint(tenantId: string, eventId: string, input: {
  name: string; ord: number; is_start: boolean; is_finish: boolean;
}) {
  const { error } = await db().from("checkpoints").insert({ tenant_id: tenantId, event_id: eventId, ...input });
  if (error) throw error;
}
export async function deleteCheckpoint(id: string) {
  const { error } = await db().from("checkpoints").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------ Oleadas ------------------------------
export async function listWaves(eventId: string): Promise<Wave[]> {
  const { data, error } = await db().from("waves").select("*").eq("event_id", eventId).order("wave_number");
  if (error) throw error;
  return data as Wave[];
}
export async function createWave(tenantId: string, eventId: string, input: {
  wave_number: number; name: string; scheduled_time?: string | null;
}) {
  const { error } = await db().from("waves").insert({
    tenant_id: tenantId, event_id: eventId,
    wave_number: input.wave_number, name: input.name,
    scheduled_time: input.scheduled_time ?? null, status: "pending",
  });
  if (error) throw error;
}

// ---------------------- Categorías (catálogo) ------------------------
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await db().from("categories").select("id, name, level, gender").order("name");
  if (error) throw error;
  return data as Category[];
}

/** Conteo de inscritos por evento (para reportes). */
export async function registrationCountsByEvent(tenantId: string): Promise<Record<string, number>> {
  const { data, error } = await db().from("registrations").select("event_id").eq("tenant_id", tenantId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  (data ?? []).forEach((r) => { const id = (r as { event_id: string }).event_id; counts[id] = (counts[id] ?? 0) + 1; });
  return counts;
}

// --------------------------- Inscripciones ---------------------------
export async function listRegistrations(eventId: string): Promise<Registration[]> {
  const { data, error } = await db().from("registrations")
    .select("id, event_id, bib_number, wave_id, status, athlete_name, athlete_document, athlete_gender, ranking_category_id, category_id")
    .eq("event_id", eventId).order("bib_number");
  if (error) throw error;
  return data as Registration[];
}

/** Próximo dorsal disponible del evento (máximo + 1, empezando en 1). */
export async function nextBib(eventId: string): Promise<number> {
  const { data } = await db().from("registrations")
    .select("bib_number").eq("event_id", eventId)
    .not("bib_number", "is", null).order("bib_number", { ascending: false }).limit(1);
  const max = (data && data[0]?.bib_number) || 0;
  return (max as number) + 1;
}

export async function createRegistration(input: {
  tenant_id: string; event_id: string; category_id: string;
  athlete_name: string; athlete_document: string; athlete_gender: "F" | "M" | "X";
  bib_number?: number | null; wave_id?: string | null; ranking_category_id?: string | null;
}): Promise<void> {
  // Dorsal automático si no viene uno explícito (reintenta ante colisión).
  let bib = input.bib_number ?? (await nextBib(input.event_id));
  for (let attempt = 0; attempt < 5; attempt++) {
    const qr = `OCR-${input.event_id.slice(0, 6).toUpperCase()}-${bib}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await db().from("registrations").insert({
      tenant_id: input.tenant_id, event_id: input.event_id, category_id: input.category_id,
      status: "pending", qr_code: qr,
      athlete_name: input.athlete_name, athlete_document: input.athlete_document,
      athlete_gender: input.athlete_gender, amount: 0,
      bib_number: bib, wave_id: input.wave_id ?? null, ranking_category_id: input.ranking_category_id ?? null,
    }).select("id").single();
    if (!error) {
      await db().from("registrations").update({ status: "paid" }).eq("id", (data as { id: string }).id);
      return;
    }
    // 23505 = dorsal ya usado: reintenta con el siguiente.
    if ((error as { code?: string }).code === "23505" && input.bib_number == null) { bib += 1; continue; }
    throw error;
  }
  throw new Error("No se pudo asignar un dorsal disponible");
}

export async function updateRegistration(id: string, patch: {
  bib_number?: number | null; wave_id?: string | null; status?: string; category_id?: string;
}) {
  const { error } = await db().from("registrations").update(patch).eq("id", id);
  if (error) throw error;
}

// ------------------- Generación automática de oleadas ----------------
export async function deleteWave(id: string) {
  const { error } = await db().from("waves").delete().eq("id", id);
  if (error) throw error;
}
export async function updateWave(id: string, patch: { wave_number?: number; name?: string; scheduled_time?: string | null; status?: string }) {
  const { error } = await db().from("waves").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Genera oleadas automáticamente: separadas por categoría y con máximo
 * `waveSize` atletas por oleada. Borra las oleadas previas del evento y
 * reasigna a los inscritos. Devuelve cuántas oleadas se crearon.
 */
export async function generateWaves(tenantId: string, eventId: string, waveSize: number): Promise<number> {
  if (!waveSize || waveSize < 1) throw new Error("El tamaño de oleada debe ser mayor que 0");

  // 1) Borrar oleadas previas (los registros quedan con wave_id = null por FK).
  const existing = await listWaves(eventId);
  for (const w of existing) await deleteWave(w.id);

  // 2) Traer inscritos y categorías del evento.
  const [regs, cats] = await Promise.all([listRegistrations(eventId), listEventCategories(eventId)]);
  const catName = new Map(cats.map((c) => [c.id, c.name] as const));

  // 3) Agrupar por categoría.
  const byCat = new Map<string, typeof regs>();
  for (const r of regs) {
    const key = r.category_id;
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(r);
  }

  // 4) Crear oleadas por categoría en bloques de waveSize y reasignar.
  let waveNo = 0;
  for (const [catId, list] of byCat) {
    list.sort((a, b) => (a.bib_number ?? 0) - (b.bib_number ?? 0));
    const name = catName.get(catId) ?? "Categoría";
    for (let i = 0; i < list.length; i += waveSize) {
      waveNo += 1;
      const chunk = list.slice(i, i + waveSize);
      const { data, error } = await db().from("waves").insert({
        tenant_id: tenantId, event_id: eventId, category_id: catId,
        wave_number: waveNo, name: `${name} - Oleada ${Math.floor(i / waveSize) + 1}`, status: "pending",
      }).select("id").single();
      if (error) throw error;
      const waveId = (data as { id: string }).id;
      const ids = chunk.map((c) => c.id);
      const { error: upErr } = await db().from("registrations").update({ wave_id: waveId }).in("id", ids);
      if (upErr) throw upErr;
    }
  }
  return waveNo;
}
