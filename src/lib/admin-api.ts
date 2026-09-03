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
}
export interface EventCategory { id: string; event_id: string; name: string; price: number; slots_available: number; }
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
    published: true,
  }).select("*").single();
  if (error) throw error;
  const ev = data as EventRow;
  // Modalidad por defecto para poder inscribir de inmediato
  await db().from("event_categories").insert({
    event_id: ev.id, name: "General", price: 0, slots_available: ev.max_capacity ?? 0,
  });
  return ev;
}

// --------------------------- Modalidades -----------------------------
export async function listEventCategories(eventId: string): Promise<EventCategory[]> {
  const { data, error } = await db().from("event_categories").select("*").eq("event_id", eventId).order("name");
  if (error) throw error;
  return data as EventCategory[];
}
export async function createEventCategory(eventId: string, name: string, price: number, slots: number) {
  const { error } = await db().from("event_categories").insert({ event_id: eventId, name, price, slots_available: slots });
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

// --------------------------- Inscripciones ---------------------------
export async function listRegistrations(eventId: string): Promise<Registration[]> {
  const { data, error } = await db().from("registrations")
    .select("id, event_id, bib_number, wave_id, status, athlete_name, athlete_document, athlete_gender, ranking_category_id, category_id")
    .eq("event_id", eventId).order("bib_number");
  if (error) throw error;
  return data as Registration[];
}

export async function createRegistration(input: {
  tenant_id: string; event_id: string; category_id: string;
  athlete_name: string; athlete_document: string; athlete_gender: "F" | "M" | "X";
  bib_number?: number | null; wave_id?: string | null; ranking_category_id?: string | null;
}): Promise<void> {
  const qr = `OCR-${input.event_id.slice(0, 6).toUpperCase()}-${input.bib_number ?? "X"}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  // La política de inserción exige status 'pending'; luego lo confirmamos.
  const { data, error } = await db().from("registrations").insert({
    tenant_id: input.tenant_id,
    event_id: input.event_id,
    category_id: input.category_id,
    status: "pending",
    qr_code: qr,
    athlete_name: input.athlete_name,
    athlete_document: input.athlete_document,
    athlete_gender: input.athlete_gender,
    amount: 0,
    bib_number: input.bib_number ?? null,
    wave_id: input.wave_id ?? null,
    ranking_category_id: input.ranking_category_id ?? null,
  }).select("id").single();
  if (error) throw error;
  // Confirmar (status 'paid') vía política de update admin/tenant.
  await db().from("registrations").update({ status: "paid" }).eq("id", (data as { id: string }).id);
}

export async function updateRegistration(id: string, patch: {
  bib_number?: number | null; wave_id?: string | null; status?: string;
}) {
  const { error } = await db().from("registrations").update(patch).eq("id", id);
  if (error) throw error;
}
