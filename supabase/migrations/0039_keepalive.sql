-- =====================================================================
-- 0039 — Latido para que Supabase no pause el proyecto gratuito.
-- Idempotente.
--
-- Supabase pausa los proyectos del plan gratuito tras ~7 días sin actividad
-- en la base de datos, y una simple lectura por la API no bastó (el proyecto
-- se pausó aunque el flujo diario recibía HTTP 200). Este latido ESCRIBE una
-- marca de tiempo; lo llama el flujo .github/workflows/keep-supabase-awake.yml
-- con la llave pública. La función no recibe datos y solo actualiza una fecha,
-- así que exponerla a anon no abre ningún permiso delicado.
-- =====================================================================

create table if not exists public.keepalive (
  id         int primary key default 1 check (id = 1),
  touched_at timestamptz not null default now()
);

alter table public.keepalive enable row level security;
revoke all on public.keepalive from anon, authenticated;
grant all on public.keepalive to service_role;

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

create or replace function public.keepalive_touch()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v timestamptz := now();
begin
  update public.keepalive set touched_at = v where id = 1;
  return v;
end; $$;

revoke all on function public.keepalive_touch() from public;
grant execute on function public.keepalive_touch() to anon, authenticated, service_role;
