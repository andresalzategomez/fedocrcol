import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente para el proyecto de Supabase EXTERNO (propio de la Federación).
 * Se configura únicamente con variables de entorno (ver .env.example):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Mientras no estén configuradas, la app funciona en "modo demo" con datos
 * de ejemplo, sin lanzar errores.
 */
const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
