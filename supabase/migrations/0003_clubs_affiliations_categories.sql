-- =====================================================================
-- 0003_clubs_affiliations_categories
-- ---------------------------------------------------------------------
-- Clubes (por liga), afiliaciones/membresías de atletas (carnet) y el
-- catálogo nacional de categorías deportivas (edad / nivel / género).
--
-- Idempotente: seguro de re-ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- ---------- Tipos ----------------------------------------------------
do $$ begin
  create type public.club_status as enum ('active', 'inactive', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.affiliation_type as enum ('individual', 'club');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.affiliation_status as enum ('pending', 'active', 'expired', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.competitive_level as enum ('elite','age_group','amateur','beginner','kids');
exception when duplicate_object then null; end $$;

-- ---------- Catálogo nacional de categorías --------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,            -- "Elite Masculino", "18-29 Femenino"
  level      public.competitive_level not null,
  gender     text not null check (gender in ('F','M','X')),
  min_age    int,
  max_age    int,
  created_at timestamptz not null default now()
);
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
alter table public.categories enable row level security;

drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories for select using (true);
drop policy if exists "categories_superadmin_manage" on public.categories;
create policy "categories_superadmin_manage" on public.categories for all to authenticated
  using (public.has_role(auth.uid(),'superadmin'))
  with check (public.has_role(auth.uid(),'superadmin'));

-- ---------- Clubes (pertenecen a una liga/tenant) --------------------
create table if not exists public.clubs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  nit           text,
  city          text,
  department    text,
  logo_url      text,
  contact_email text,
  contact_phone text,
  status        public.club_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name)
);
create index if not exists idx_clubs_tenant on public.clubs(tenant_id);
grant select on public.clubs to anon, authenticated;
grant insert, update, delete on public.clubs to authenticated;
grant all on public.clubs to service_role;
alter table public.clubs enable row level security;

drop trigger if exists trg_clubs_updated_at on public.clubs;
create trigger trg_clubs_updated_at before update on public.clubs
  for each row execute function public.set_updated_at();

drop policy if exists "clubs_public_read" on public.clubs;
create policy "clubs_public_read" on public.clubs for select using (true);
drop policy if exists "clubs_tenant_manage" on public.clubs;
create policy "clubs_tenant_manage" on public.clubs for all to authenticated
  using (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id())
  with check (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id());

-- ---------- Afiliaciones / membresías (carnet) -----------------------
create table if not exists public.affiliations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  athlete_id  uuid not null references public.profiles(id) on delete cascade,
  club_id     uuid references public.clubs(id) on delete set null,
  season      int  not null,                  -- año de la temporada, p. ej. 2026
  type        public.affiliation_type not null default 'individual',
  status      public.affiliation_status not null default 'pending',
  member_code text unique,                    -- código de carnet
  start_date  timestamptz not null default now(),
  end_date    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (athlete_id, season, tenant_id)
);
create index if not exists idx_affiliations_tenant_season on public.affiliations(tenant_id, season, status);
grant select, insert, update, delete on public.affiliations to authenticated;
grant all on public.affiliations to service_role;
alter table public.affiliations enable row level security;

drop trigger if exists trg_affiliations_updated_at on public.affiliations;
create trigger trg_affiliations_updated_at before update on public.affiliations
  for each row execute function public.set_updated_at();

-- El atleta ve/crea su propia afiliación; admin/superadmin gestionan las de su tenant.
drop policy if exists "affiliations_read_scoped" on public.affiliations;
create policy "affiliations_read_scoped" on public.affiliations for select to authenticated
  using (
    athlete_id = auth.uid()
    or public.has_role(auth.uid(),'superadmin')
    or (public.has_role(auth.uid(),'admin') and tenant_id = public.current_tenant_id())
  );
drop policy if exists "affiliations_insert_self" on public.affiliations;
create policy "affiliations_insert_self" on public.affiliations for insert to authenticated
  with check (athlete_id = auth.uid() and status = 'pending');
drop policy if exists "affiliations_admin_update" on public.affiliations;
create policy "affiliations_admin_update" on public.affiliations for update to authenticated
  using (public.has_role(auth.uid(),'superadmin') or (public.has_role(auth.uid(),'admin') and tenant_id = public.current_tenant_id()))
  with check (public.has_role(auth.uid(),'superadmin') or (public.has_role(auth.uid(),'admin') and tenant_id = public.current_tenant_id()));

-- ---------- Vincular categoría (opcional) a inscripciones ------------
alter table public.registrations add column if not exists ranking_category_id uuid references public.categories(id) on delete set null;

-- ---------- Semillas de categorías estándar OCR ----------------------
insert into public.categories (name, level, gender, min_age, max_age) values
  ('Elite Masculino',    'elite',     'M', 18, null),
  ('Elite Femenino',     'elite',     'F', 18, null),
  ('18-29 Masculino',    'age_group', 'M', 18, 29),
  ('18-29 Femenino',     'age_group', 'F', 18, 29),
  ('30-39 Masculino',    'age_group', 'M', 30, 39),
  ('30-39 Femenino',     'age_group', 'F', 30, 39),
  ('40-49 Masculino',    'age_group', 'M', 40, 49),
  ('40-49 Femenino',     'age_group', 'F', 40, 49),
  ('50+ Masculino',      'age_group', 'M', 50, null),
  ('50+ Femenino',       'age_group', 'F', 50, null),
  ('Kids',               'kids',      'X', 6,  13)
on conflict (name) do nothing;
