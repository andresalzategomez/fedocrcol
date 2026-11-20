-- =====================================================================
-- 0046 — Carreras tipo TRACK: tablas, juez único y permisos.
-- Idempotente.
--
-- Las carreras track (events.race_format = 'track', ver 0043) las cronometra
-- Timer_track por /api/track/v1. Estas tablas guardan la configuración
-- (instancias, parejas iniciales), el estado consolidado que calcula el motor
-- de reglas en el servidor, y el historial inalterable de eventos del juez.
-- No escriben en results, waves, checkpoints, timing_reads ni v_athlete_ranking.
--
-- Permisos: sin acceso público. Solo el administrador de la liga dueña y la
-- federación LEEN (is_event_admin); TODA escritura la hace el servidor
-- (service_role) después de validar el rol del que llama.
-- =====================================================================

-- Un único juez por carrera track.
alter table public.events add column if not exists track_judge_id uuid references public.profiles(id) on delete set null;

-- ---------- Instancias (clasificación, cuartos, semifinal, final) por categoría ----------
create table if not exists public.track_stages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  event_id         uuid not null references public.events(id) on delete cascade,
  category_id      uuid not null references public.event_categories(id) on delete cascade,
  stage_number     int  not null check (stage_number >= 1),
  name             text not null,
  runs_per_athlete int  not null check (runs_per_athlete >= 1),
  qualifiers_count int  check (qualifiers_count is null or qualifiers_count >= 1),
  status           text not null default 'pending' check (status in ('pending', 'open', 'closed')),
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (event_id, category_id, stage_number)
);
create index if not exists idx_track_stages_event on public.track_stages(event_id);

-- ---------- Participantes de cada instancia ----------
create table if not exists public.track_stage_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  stage_id        uuid not null references public.track_stages(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  seed            int,
  status          text not null default 'active' check (status in ('active', 'withdrawn', 'qualified', 'eliminated')),
  best_time_ms    int,
  rank            int,
  qualified       boolean not null default false,
  note            text,
  unique (stage_id, registration_id)
);
create index if not exists idx_track_stage_entries_event on public.track_stage_entries(event_id);

-- ---------- Parejas iniciales (instancia 1, salida 1): configuración inmutable que llega al paquete ----------
-- Se edita (panel) hasta que la carrera inicia; el motor siempre arranca desde aquí.
create table if not exists public.track_initial_heats (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  event_id              uuid not null references public.events(id) on delete cascade,
  stage_id              uuid not null references public.track_stages(id) on delete cascade,
  heat_number           int  not null check (heat_number >= 1),
  left_registration_id  uuid not null references public.registrations(id) on delete cascade,
  right_registration_id uuid references public.registrations(id) on delete cascade,
  unique (stage_id, heat_number)
);
create index if not exists idx_track_initial_heats_event on public.track_initial_heats(event_id);

-- ---------- Oleadas (estado consolidado; el id lo genera la app) ----------
create table if not exists public.track_heats (
  id             uuid primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  event_id       uuid not null references public.events(id) on delete cascade,
  stage_id       uuid not null references public.track_stages(id) on delete cascade,
  run_number     int  not null check (run_number >= 1),
  heat_number    int  not null check (heat_number >= 1),
  heat_type      text not null default 'regular' check (heat_type in ('regular', 'tiebreak')),
  tiebreak_id    uuid,
  pairing_source text not null default 'fedocr' check (pairing_source in ('fedocr', 'same_as_previous', 'random', 'manual', 'seeded')),
  status         text not null default 'pending'
                 check (status in ('pending', 'started', 'awaiting_confirmation', 'confirmed', 'cancelled', 'voided')),
  started_at     timestamptz,
  confirmed_at   timestamptz,
  judge_id       uuid references public.profiles(id) on delete set null,
  review_note    text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_track_heats_event on public.track_heats(event_id, stage_id, run_number);

create table if not exists public.track_heat_lanes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  heat_id         uuid not null references public.track_heats(id) on delete cascade,
  lane            text not null check (lane in ('left', 'right')),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  arrival_order   int,
  finish_at       timestamptz,
  elapsed_ms      int,
  -- 'voided': anulado por el protocolo de lluvia; el tiempo original se conserva y no cuenta.
  outcome         text not null default 'pending'
                  check (outcome in ('pending', 'time', 'did_not_run', 'did_not_finish', 'withdrawn', 'voided')),
  note            text,
  unique (heat_id, lane)
);
create index if not exists idx_track_heat_lanes_event on public.track_heat_lanes(event_id);

-- ---------- Retiros ----------
create table if not exists public.track_withdrawals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  stage_id        uuid references public.track_stages(id) on delete set null,
  heat_id         uuid,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  reason          text not null check (reason in ('rule_violation', 'voluntary', 'injury', 'other')),
  note            text not null check (length(trim(note)) > 0),
  judge_id        uuid references public.profiles(id) on delete set null,
  occurred_at     timestamptz not null default now(),
  unique (event_id, registration_id)
);

-- ---------- Desempates (los usa el motor v0.2) ----------
create table if not exists public.track_tiebreaks (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants(id) on delete cascade,
  event_id                   uuid not null references public.events(id) on delete cascade,
  stage_id                   uuid not null references public.track_stages(id) on delete cascade,
  tied_registration_ids      uuid[] not null,
  resolution                 text check (resolution in ('all_times', 'judge_direct', 'runoff')),
  qualified_registration_ids uuid[],
  note                       text,
  judge_id                   uuid references public.profiles(id) on delete set null,
  decided_at                 timestamptz
);

-- ---------- Dispositivo activo (máximo uno por carrera) ----------
create table if not exists public.track_race_devices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  event_id       uuid not null references public.events(id) on delete cascade,
  device_id      text not null,
  judge_id       uuid references public.profiles(id) on delete set null,
  is_active      boolean not null default true,
  activated_at   timestamptz not null default now(),
  deactivated_at timestamptz,
  last_synced_at timestamptz,
  takeover_note  text
);
create unique index if not exists uq_track_one_active_device on public.track_race_devices(event_id) where is_active;
create index if not exists idx_track_race_devices_event on public.track_race_devices(event_id, device_id);

-- ---------- Historial inalterable de eventos del juez ----------
create table if not exists public.track_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  client_event_id   uuid not null unique,
  device_id         text not null,
  device_seq        int  not null check (device_seq >= 1),
  type              text not null,
  payload           jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  judge_id          uuid references public.profiles(id) on delete set null,
  processing_status text not null default 'accepted' check (processing_status in ('accepted', 'rejected', 'needs_review')),
  rejection_code    text,
  rejection_message text,
  engine_version    text,
  unique (event_id, device_id, device_seq)
);
create index if not exists idx_track_events_event on public.track_events(event_id, received_at);

-- El historial no se altera: no se borra ni se cambia lo recibido (solo la resolución de una revisión).
create or replace function public.protect_track_events()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Borrado directo: prohibido. Se permite solo cuando se elimina la carrera completa (borrado en cascada:
    -- en ese momento la carrera ya no existe).
    if exists (select 1 from public.events e where e.id = old.event_id) then
      raise exception 'El historial de eventos de track no se puede borrar';
    end if;
    return old;
  end if;
  if new.client_event_id is distinct from old.client_event_id or new.event_id is distinct from old.event_id
     or new.device_id is distinct from old.device_id or new.device_seq is distinct from old.device_seq
     or new.type is distinct from old.type or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at or new.received_at is distinct from old.received_at then
    raise exception 'El historial de eventos de track no se puede modificar';
  end if;
  return new;
end; $$;

drop trigger if exists trg_track_events_protect on public.track_events;
create trigger trg_track_events_protect before update or delete on public.track_events
  for each row execute function public.protect_track_events();

-- ---------- Permisos: solo lectura para admin de la liga y federación; escribe el servidor ----------
do $$
declare t text;
begin
  foreach t in array array['track_stages', 'track_stage_entries', 'track_initial_heats', 'track_heats', 'track_heat_lanes',
                           'track_withdrawals', 'track_tiebreaks', 'track_race_devices', 'track_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists "%s_read" on public.%I', t, t);
    execute format('create policy "%s_read" on public.%I for select to authenticated using (public.is_event_admin(event_id))', t, t);
  end loop;
end $$;
