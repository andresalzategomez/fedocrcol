-- =====================================================================
-- FEDOCR Colombia — Esquema multi-tenant para Supabase EXTERNO
-- Ejecutar manualmente en el SQL Editor del proyecto de Supabase.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------- Tipos ------------------------------------
do $$ begin
  create type public.app_role as enum ('superadmin', 'admin', 'athlete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tenant_status as enum ('active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.registration_status as enum ('pending', 'paid', 'cancelled');
exception when duplicate_object then null; end $$;

-- ------------------------- Tenants (ligas) ---------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  department text not null,
  city text,
  description text,
  logo_url text,
  banner_url text,
  primary_color text not null default '#F0562A',
  secondary_color text not null default '#C8F02A',
  payment_keys jsonb not null default '{}'::jsonb,
  commission_rate numeric(5,2) not null default 8.00,
  status public.tenant_status not null default 'active',
  created_at timestamptz not null default now()
);

grant select on public.tenants to anon;
grant select, insert, update, delete on public.tenants to authenticated;
grant all on public.tenants to service_role;
alter table public.tenants enable row level security;

-- ------------------------- Profiles ----------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'athlete',
  tenant_id uuid references public.tenants(id) on delete set null,
  document_id text,
  full_name text,
  gender text check (gender in ('F','M','X')),
  birth_date date,
  phone text,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ---------------- Funciones security definer (evitan recursión) ------
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = _user_id and role = _role);
$$;

create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

-- ------------------------- Events ------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  date date not null,
  location text not null,
  distance_km numeric(5,1),
  obstacles int,
  max_capacity int not null default 0,
  registered int not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

grant select on public.events to anon;
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;

-- ------------------------- Event categories --------------------------
create table if not exists public.event_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null,
  slots_available int not null default 0
);

grant select on public.event_categories to anon;
grant select, insert, update, delete on public.event_categories to authenticated;
grant all on public.event_categories to service_role;
alter table public.event_categories enable row level security;

-- ------------------------- Registrations -----------------------------
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  category_id uuid not null references public.event_categories(id) on delete restrict,
  athlete_id uuid references public.profiles(id) on delete set null,
  athlete_name text,
  athlete_email text,
  athlete_document text,
  athlete_phone text,
  athlete_birth_date date,
  athlete_gender text check (athlete_gender in ('F','M','X')),
  amount numeric(12,2) not null default 0,
  status public.registration_status not null default 'pending',
  qr_code text not null unique,
  created_at timestamptz not null default now()
);

grant insert on public.registrations to anon; -- inscripción pública
grant select, insert, update, delete on public.registrations to authenticated;
grant all on public.registrations to service_role;
alter table public.registrations enable row level security;

-- ------------------------- Payments ----------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  transaction_id text,
  amount numeric(12,2) not null default 0,
  method text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

grant select on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;

-- ------------------------- Results -----------------------------------
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  finish_time interval,
  position int,
  points_awarded int not null default 0,
  created_at timestamptz not null default now()
);

grant select on public.results to anon;
grant select, insert, update, delete on public.results to authenticated;
grant all on public.results to service_role;
alter table public.results enable row level security;

-- ======================= Row Level Security ==========================

-- Tenants
drop policy if exists "tenants_public_read" on public.tenants;
create policy "tenants_public_read" on public.tenants for select using (true);

drop policy if exists "tenants_superadmin_write" on public.tenants;
create policy "tenants_superadmin_write" on public.tenants for all to authenticated
  using (public.has_role(auth.uid(), 'superadmin'))
  with check (public.has_role(auth.uid(), 'superadmin'));

drop policy if exists "tenants_admin_update_own" on public.tenants;
create policy "tenants_admin_update_own" on public.tenants for update to authenticated
  using (public.has_role(auth.uid(), 'admin') and id = public.current_tenant_id())
  with check (public.has_role(auth.uid(), 'admin') and id = public.current_tenant_id());

-- Profiles
drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  );

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'superadmin'))
  with check (id = auth.uid() or public.has_role(auth.uid(), 'superadmin'));

-- Events
drop policy if exists "events_public_read" on public.events;
create policy "events_public_read" on public.events for select using (published = true);

drop policy if exists "events_tenant_manage" on public.events;
create policy "events_tenant_manage" on public.events for all to authenticated
  using (public.has_role(auth.uid(), 'superadmin') or tenant_id = public.current_tenant_id())
  with check (public.has_role(auth.uid(), 'superadmin') or tenant_id = public.current_tenant_id());

-- Event categories
drop policy if exists "categories_public_read" on public.event_categories;
create policy "categories_public_read" on public.event_categories for select using (true);

drop policy if exists "categories_tenant_manage" on public.event_categories;
create policy "categories_tenant_manage" on public.event_categories for all to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or exists (select 1 from public.events e where e.id = event_id and e.tenant_id = public.current_tenant_id())
  )
  with check (
    public.has_role(auth.uid(), 'superadmin')
    or exists (select 1 from public.events e where e.id = event_id and e.tenant_id = public.current_tenant_id())
  );

-- Registrations
drop policy if exists "registrations_public_insert" on public.registrations;
create policy "registrations_public_insert" on public.registrations for insert to anon, authenticated
  with check (status = 'pending');

drop policy if exists "registrations_read_scoped" on public.registrations;
create policy "registrations_read_scoped" on public.registrations for select to authenticated
  using (
    athlete_id = auth.uid()
    or public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  );

drop policy if exists "registrations_admin_update" on public.registrations;
create policy "registrations_admin_update" on public.registrations for update to authenticated
  using (public.has_role(auth.uid(), 'superadmin') or tenant_id = public.current_tenant_id())
  with check (public.has_role(auth.uid(), 'superadmin') or tenant_id = public.current_tenant_id());

-- Payments (escritos por el webhook con service_role)
drop policy if exists "payments_read_scoped" on public.payments;
create policy "payments_read_scoped" on public.payments for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or exists (
      select 1 from public.registrations r
      where r.id = registration_id
        and (r.athlete_id = auth.uid() or r.tenant_id = public.current_tenant_id())
    )
  );

-- Results
drop policy if exists "results_public_read" on public.results;
create policy "results_public_read" on public.results for select using (true);

drop policy if exists "results_tenant_manage" on public.results;
create policy "results_tenant_manage" on public.results for all to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or exists (select 1 from public.events e where e.id = event_id and e.tenant_id = public.current_tenant_id())
  )
  with check (
    public.has_role(auth.uid(), 'superadmin')
    or exists (select 1 from public.events e where e.id = event_id and e.tenant_id = public.current_tenant_id())
  );

-- ======================= Ranking ====================================
create or replace view public.v_athlete_ranking as
select
  row_number() over (order by sum(r.points_awarded) desc) as position,
  p.full_name as athlete,
  p.tenant_id,
  coalesce(p.gender, 'X') as category,
  count(r.id) as races,
  sum(r.points_awarded) as points,
  (row_number() over (order by sum(r.points_awarded) desc)) <= 5 as qualified
from public.results r
join public.profiles p on p.id = r.athlete_id
group by p.id, p.full_name, p.tenant_id, p.gender;

grant select on public.v_athlete_ranking to anon, authenticated;
grant all on public.v_athlete_ranking to service_role;

-- ======================= Trigger de perfil ===========================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, tenant_id, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    nullif(new.raw_user_meta_data->>'tenant_id','')::uuid,
    'athlete'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
