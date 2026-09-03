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
