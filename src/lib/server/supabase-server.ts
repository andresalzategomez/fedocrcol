import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Clientes de Supabase para uso EXCLUSIVO en el servidor (server routes /api/v1).
 * Requiere variables de entorno de servidor (ver .env.example):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

export const isServerSupabaseConfigured = Boolean(url && anonKey);

/** Cliente anónimo (para login). */
export function anonClient(): SupabaseClient {
  return createClient(url as string, anonKey as string, { auth: { persistSession: false } });
}

/** Cliente con el JWT del usuario: las consultas respetan RLS (aislamiento por liga). */
export function userClient(token: string): SupabaseClient {
  return createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Cliente con service role: omite RLS. Solo para operaciones administrativas. */
export function serviceClient(): SupabaseClient {
  return createClient(url as string, serviceKey as string, { auth: { persistSession: false } });
}
