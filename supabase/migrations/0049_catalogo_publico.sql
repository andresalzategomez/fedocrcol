-- =====================================================================
-- 0049 — Visibilidad pública de ligas y carreras (interruptor del superadmin) y "muestra".
-- Idempotente.
--
--  * site_settings: ajustes del sitio. La clave 'public_catalog' ({"visible": true|false}) decide si el sitio público
--    muestra todas las ligas y carreras o solo las marcadas como muestra. Sin fila = visible (comportamiento anterior).
--    Cualquiera puede LEER esa clave (el sitio público la consulta); solo el superadmin puede escribirla.
--  * tenants.is_showcase / events.is_showcase: lo que se sigue mostrando de ejemplo cuando el catálogo está oculto.
--
-- Esto controla lo que MUESTRA el sitio; no cambia quién puede ver o administrar los datos en el panel.
-- =====================================================================

create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update on public.site_settings to authenticated;
grant all on public.site_settings to service_role;

drop policy if exists "site_settings_public_read" on public.site_settings;
create policy "site_settings_public_read" on public.site_settings for select to anon, authenticated
  using (key = 'public_catalog');

drop policy if exists "site_settings_super_read" on public.site_settings;
create policy "site_settings_super_read" on public.site_settings for select to authenticated
  using (public.has_role(auth.uid(), 'superadmin'));

drop policy if exists "site_settings_super_insert" on public.site_settings;
create policy "site_settings_super_insert" on public.site_settings for insert to authenticated
  with check (public.has_role(auth.uid(), 'superadmin'));

drop policy if exists "site_settings_super_update" on public.site_settings;
create policy "site_settings_super_update" on public.site_settings for update to authenticated
  using (public.has_role(auth.uid(), 'superadmin'))
  with check (public.has_role(auth.uid(), 'superadmin'));

alter table public.tenants add column if not exists is_showcase boolean not null default false;
alter table public.events  add column if not exists is_showcase boolean not null default false;
