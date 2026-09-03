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


-- #####################################################################
-- #  AMPLIACIONES CONSOLIDADAS (equivalentes a las migraciones)
-- #  Todo lo de abajo es idempotente. Ver supabase/migrations/.
-- #####################################################################

-- =====================================================================
-- 0002_timing — Integración de CRONOMETRAJE (FedOCR Timer)
-- ---------------------------------------------------------------------
-- Añade el modelo necesario para que el aplicativo FedOCR Timer lea las
-- inscripciones (dorsales / oleadas) y escriba lecturas de tiempo en los
-- puntos de control, y para que la federación consolide resultados.
--
-- Idempotente: seguro de re-ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- ---------- Helper compartido: updated_at automático -----------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ---------- Tipos ----------------------------------------------------
do $$ begin
  create type public.result_status as enum ('finished', 'dnf', 'dns', 'dsq');
exception when duplicate_object then null; end $$;

-- ---------- API Keys (autenticación de servicios: FedOCR Timer) -------
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- "FedOCR Timer - Evento X"
  key_hash     text not null unique,          -- hash del token (nunca el token en claro)
  tenant_id    uuid references public.tenants(id) on delete cascade,
  scopes       text[] not null default '{timing:write,registrations:read}',
  is_active    boolean not null default true,
  last_used_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
grant all on public.api_keys to service_role;
alter table public.api_keys enable row level security;
-- Sin políticas para anon/authenticated: las api_keys solo se manejan con service_role.

-- ---------- Oleadas de salida (waves) --------------------------------
create table if not exists public.waves (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  event_id       uuid not null references public.events(id) on delete cascade,
  category_id    uuid references public.event_categories(id) on delete set null,
  name           text not null,               -- "Oleada 1 - 08:00"
  scheduled_time timestamptz,
  started_at     timestamptz,                 -- hora real de salida (la fija el Timer)
  created_at     timestamptz not null default now(),
  unique (event_id, name)
);
create index if not exists idx_waves_event on public.waves(event_id);
grant select on public.waves to anon, authenticated;
grant insert, update, delete on public.waves to authenticated;
grant all on public.waves to service_role;
alter table public.waves enable row level security;

-- ---------- Puntos de control / obstáculos ---------------------------
create table if not exists public.checkpoints (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null,                   -- "Salida", "KM 2.5", "Meta"
  ord        int  not null,                   -- orden en el recorrido
  is_start   boolean not null default false,
  is_finish  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_id, ord)
);
create index if not exists idx_checkpoints_event on public.checkpoints(event_id);
grant select on public.checkpoints to anon, authenticated;
grant insert, update, delete on public.checkpoints to authenticated;
grant all on public.checkpoints to service_role;
alter table public.checkpoints enable row level security;

-- ---------- Campos de cronometraje en registrations ------------------
alter table public.registrations add column if not exists bib_number int;
alter table public.registrations add column if not exists wave_id uuid references public.waves(id) on delete set null;
-- Dorsal único por evento
create unique index if not exists uq_registrations_event_bib
  on public.registrations(event_id, bib_number) where bib_number is not null;

-- ---------- Lecturas de tiempo (append-only) -------------------------
create table if not exists public.timing_reads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  checkpoint_id   uuid not null references public.checkpoints(id) on delete cascade,
  read_at         timestamptz not null,        -- momento exacto de la lectura
  source          text default 'fedocr-timer', -- origen del dato
  raw_payload     jsonb,                        -- datos originales del dispositivo (auditoría)
  created_at      timestamptz not null default now()
);
create index if not exists idx_timing_reads_reg on public.timing_reads(registration_id, checkpoint_id);
create index if not exists idx_timing_reads_event on public.timing_reads(event_id, read_at);
grant select on public.timing_reads to authenticated;
grant insert on public.timing_reads to authenticated;
grant all on public.timing_reads to service_role;
alter table public.timing_reads enable row level security;

-- ---------- Extender results con datos de cronometraje ---------------
alter table public.results add column if not exists registration_id uuid references public.registrations(id) on delete cascade;
alter table public.results add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.results add column if not exists status public.result_status not null default 'finished';
alter table public.results add column if not exists start_time timestamptz;
alter table public.results add column if not exists finish_at timestamptz;
alter table public.results add column if not exists duration_ms bigint;      -- tiempo neto autoritativo
alter table public.results add column if not exists category_rank int;
alter table public.results add column if not exists updated_at timestamptz not null default now();
create unique index if not exists uq_results_registration on public.results(registration_id) where registration_id is not null;
create index if not exists idx_results_event_duration on public.results(event_id, duration_ms);

drop trigger if exists trg_results_updated_at on public.results;
create trigger trg_results_updated_at before update on public.results
  for each row execute function public.set_updated_at();

-- =====================================================================
--  LÓGICA DE CONSOLIDACIÓN
-- =====================================================================

-- Recalcula el resultado de UNA inscripción a partir de sus timing_reads:
-- toma la lectura del checkpoint de salida y la de meta del evento.
create or replace function public.recalculate_result(p_registration_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_reg        public.registrations%rowtype;
  v_start_ts   timestamptz;
  v_finish_ts  timestamptz;
  v_athlete    uuid;
begin
  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then return; end if;

  -- Salida: primera lectura en un checkpoint is_start; si no hay, usa started_at de la oleada
  select min(tr.read_at) into v_start_ts
  from public.timing_reads tr
  join public.checkpoints c on c.id = tr.checkpoint_id
  where tr.registration_id = p_registration_id and c.is_start;

  if v_start_ts is null then
    select w.started_at into v_start_ts from public.waves w where w.id = v_reg.wave_id;
  end if;

  -- Meta: última lectura en un checkpoint is_finish
  select max(tr.read_at) into v_finish_ts
  from public.timing_reads tr
  join public.checkpoints c on c.id = tr.checkpoint_id
  where tr.registration_id = p_registration_id and c.is_finish;

  v_athlete := v_reg.athlete_id;

  insert into public.results (event_id, tenant_id, registration_id, athlete_id,
                              start_time, finish_at, duration_ms, finish_time, status)
  values (
    v_reg.event_id, v_reg.tenant_id, p_registration_id, v_athlete,
    v_start_ts, v_finish_ts,
    case when v_start_ts is not null and v_finish_ts is not null
         then (extract(epoch from (v_finish_ts - v_start_ts)) * 1000)::bigint end,
    case when v_start_ts is not null and v_finish_ts is not null
         then (v_finish_ts - v_start_ts) end,
    case when v_finish_ts is not null then 'finished'::public.result_status
         else 'dnf'::public.result_status end
  )
  on conflict (registration_id) do update set
    start_time  = excluded.start_time,
    finish_at   = excluded.finish_at,
    duration_ms = excluded.duration_ms,
    finish_time = excluded.finish_time,
    status      = excluded.status;
end; $$;

-- Recalcula posiciones (general y por modalidad) de un evento completo.
create or replace function public.recalculate_event_positions(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  with ranked as (
    select r.id,
           row_number() over (order by r.duration_ms asc) as overall
    from public.results r
    where r.event_id = p_event_id and r.status = 'finished' and r.duration_ms is not null
  )
  update public.results r set position = ranked.overall
  from ranked where ranked.id = r.id;
end; $$;

-- Trigger: cada lectura de tiempo recalcula el resultado de esa inscripción.
create or replace function public.on_timing_read_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalculate_result(new.registration_id);
  return new;
end; $$;

drop trigger if exists trg_timing_read_recalc on public.timing_reads;
create trigger trg_timing_read_recalc after insert on public.timing_reads
  for each row execute function public.on_timing_read_insert();

-- =====================================================================
--  RLS — Cronometraje
--  Escritura permitida a superadmin o al admin/juez del tenant dueño del
--  evento. Lectura pública de lo que ya es público (waves/checkpoints).
-- =====================================================================

-- Waves
drop policy if exists "waves_public_read" on public.waves;
create policy "waves_public_read" on public.waves for select using (true);
drop policy if exists "waves_tenant_manage" on public.waves;
create policy "waves_tenant_manage" on public.waves for all to authenticated
  using (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id())
  with check (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id());

-- Checkpoints
drop policy if exists "checkpoints_public_read" on public.checkpoints;
create policy "checkpoints_public_read" on public.checkpoints for select using (true);
drop policy if exists "checkpoints_tenant_manage" on public.checkpoints;
create policy "checkpoints_tenant_manage" on public.checkpoints for all to authenticated
  using (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id())
  with check (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id());

-- Timing reads: lectura por admin/superadmin del tenant; inserción por el
-- tenant dueño del evento. El FedOCR Timer que use service_role no pasa por RLS.
drop policy if exists "timing_reads_read_scoped" on public.timing_reads;
create policy "timing_reads_read_scoped" on public.timing_reads for select to authenticated
  using (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id());
drop policy if exists "timing_reads_insert_scoped" on public.timing_reads;
create policy "timing_reads_insert_scoped" on public.timing_reads for insert to authenticated
  with check (public.has_role(auth.uid(),'superadmin') or tenant_id = public.current_tenant_id());

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

-- =====================================================================
-- 0004_harden_functions — refuerzo de seguridad de funciones (0002)
-- ---------------------------------------------------------------------
-- Resuelve avisos del linter de Supabase:
--  * search_path mutable en set_updated_at()
--  * funciones internas de consolidación expuestas por RPC a anon/authenticated
-- Idempotente.
-- =====================================================================

alter function public.set_updated_at() set search_path = public;

revoke execute on function public.recalculate_result(uuid) from anon, authenticated;
revoke execute on function public.recalculate_event_positions(uuid) from anon, authenticated;
revoke execute on function public.on_timing_read_insert() from anon, authenticated;

grant execute on function public.recalculate_result(uuid) to service_role;
grant execute on function public.recalculate_event_positions(uuid) to service_role;

-- =====================================================================
-- 0005_timer_contract_reconciliation
-- Ajusta el esquema para calzar el contrato del FedOCR Timer.
-- Idempotente.
-- =====================================================================

do $$ begin
  create type public.wave_status as enum ('pending','started','completed');
exception when duplicate_object then null; end $$;

alter table public.waves add column if not exists wave_number int;
alter table public.waves add column if not exists status public.wave_status not null default 'pending';

-- Penalización (segundos) que el Timer ya sumó al net_time.
alter table public.results add column if not exists penalty_seconds int not null default 0;

-- Id del registro en el cliente (Timer) para idempotencia en el push.
alter table public.timing_reads add column if not exists client_record_id uuid;
create unique index if not exists uq_timing_reads_client
  on public.timing_reads(client_record_id) where client_record_id is not null;

-- =====================================================================
-- 0006_results_source_guard
-- Los resultados enviados por el Timer (source='timer') son autoritativos;
-- el recálculo automático desde timing_reads no debe sobrescribirlos.
-- Idempotente.
-- =====================================================================

alter table public.results add column if not exists source text not null default 'computed';

create or replace function public.recalculate_result(p_registration_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_reg        public.registrations%rowtype;
  v_start_ts   timestamptz;
  v_finish_ts  timestamptz;
  v_athlete    uuid;
begin
  if exists (select 1 from public.results
             where registration_id = p_registration_id and source = 'timer') then
    return;
  end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then return; end if;

  select min(tr.read_at) into v_start_ts
  from public.timing_reads tr
  join public.checkpoints c on c.id = tr.checkpoint_id
  where tr.registration_id = p_registration_id and c.is_start;

  if v_start_ts is null then
    select w.started_at into v_start_ts from public.waves w where w.id = v_reg.wave_id;
  end if;

  select max(tr.read_at) into v_finish_ts
  from public.timing_reads tr
  join public.checkpoints c on c.id = tr.checkpoint_id
  where tr.registration_id = p_registration_id and c.is_finish;

  v_athlete := v_reg.athlete_id;

  insert into public.results (event_id, tenant_id, registration_id, athlete_id,
                              start_time, finish_at, duration_ms, finish_time, status, source)
  values (
    v_reg.event_id, v_reg.tenant_id, p_registration_id, v_athlete,
    v_start_ts, v_finish_ts,
    case when v_start_ts is not null and v_finish_ts is not null
         then (extract(epoch from (v_finish_ts - v_start_ts)) * 1000)::bigint end,
    case when v_start_ts is not null and v_finish_ts is not null
         then (v_finish_ts - v_start_ts) end,
    case when v_finish_ts is not null then 'finished'::public.result_status
         else 'dnf'::public.result_status end,
    'computed'
  )
  on conflict (registration_id) do update set
    start_time  = excluded.start_time,
    finish_at   = excluded.finish_at,
    duration_ms = excluded.duration_ms,
    finish_time = excluded.finish_time,
    status      = excluded.status;
end; $$;

revoke execute on function public.recalculate_result(uuid) from anon, authenticated;
grant execute on function public.recalculate_result(uuid) to service_role;
