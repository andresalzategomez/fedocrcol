-- =====================================================================
-- 0037 — Checkpoints ordenables, máximo 2 por juez, gestores asignados
-- por carrera y aprobación de carreras por quien la creó.
-- Idempotente.
--
-- 1) reorder_checkpoints(event, ids[]): fija el orden consecutivo 1..N según
--    la lista recibida y deduce Salida (primero) y Meta (último) del lugar
--    en la lista. is_start/is_finish se conservan como columnas porque el
--    Timer y el cálculo de resultados las usan.
-- 2) Un juez no puede quedar en más de 2 checkpoints de la misma carrera.
-- 3) event_managers: el gestor solo ve/edita las carreras que el director
--    (o la federación) le asignó. Un gestor ya no puede crear carreras.
-- 4) events.approval_by: quién aprueba una carrera enviada por un gestor:
--    'league' (director de la liga) o 'federation' si la creó la federación.
--    La federación deja de aprobar carreras creadas dentro de las ligas.
-- 5) Categorías estándar: edad mínima/máxima deducida del nombre.
-- =====================================================================

-- ---------- 1) Orden de checkpoints ---------------------------------
create or replace function public.reorder_checkpoints(p_event_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_given int := coalesce(array_length(p_ids, 1), 0);
begin
  if auth.uid() is not null and not public.can_manage_event(p_event_id) then
    raise exception 'No puedes modificar los checkpoints de esta carrera';
  end if;

  select count(*) into v_total from public.checkpoints where event_id = p_event_id;
  if v_given <> v_total
     or exists (select 1 from unnest(p_ids) i where not exists (
          select 1 from public.checkpoints c where c.id = i and c.event_id = p_event_id))
     or (select count(distinct i) from unnest(p_ids) i) <> v_given then
    raise exception 'La lista de checkpoints no coincide con la de la carrera';
  end if;

  -- Paso 1: libera los órdenes actuales (la restricción unique (event_id, ord) no admite cruces).
  update public.checkpoints set ord = -ord where event_id = p_event_id;
  -- Paso 2: orden consecutivo; primero = salida, último = meta (si hay más de uno).
  update public.checkpoints c
     set ord = t.pos,
         is_start = (t.pos = 1),
         is_finish = (t.pos = v_given and v_given > 1)
    from (select u.i as id, u.n::int as pos from unnest(p_ids) with ordinality as u(i, n)) t
   where c.id = t.id and c.event_id = p_event_id;
end; $$;

revoke execute on function public.reorder_checkpoints(uuid, uuid[]) from anon;
grant execute on function public.reorder_checkpoints(uuid, uuid[]) to authenticated, service_role;

-- ---------- 2) Máximo 2 checkpoints por juez en una carrera ----------
create or replace function public.enforce_judge_checkpoint_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
  v_count int;
begin
  select event_id into v_event from public.checkpoints where id = new.checkpoint_id;
  select count(*) into v_count
    from public.checkpoint_judges cj
    join public.checkpoints c on c.id = cj.checkpoint_id
   where cj.judge_id = new.judge_id and c.event_id = v_event
     and cj.id is distinct from new.id;
  if v_count >= 2 then
    raise exception 'Un juez solo puede tener máximo 2 checkpoints en la misma carrera';
  end if;
  return new;
end; $$;

drop trigger if exists trg_checkpoint_judges_limit on public.checkpoint_judges;
create trigger trg_checkpoint_judges_limit before insert on public.checkpoint_judges
  for each row execute function public.enforce_judge_checkpoint_limit();

-- ---------- 3) Gestores asignados por carrera ------------------------
create table if not exists public.event_managers (
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists idx_event_managers_user on public.event_managers(user_id);

grant select, insert, delete on public.event_managers to authenticated;
grant all on public.event_managers to service_role;
alter table public.event_managers enable row level security;

create or replace function public.is_event_manager(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.event_managers em
    where em.event_id = p_event_id and em.user_id = auth.uid()
  ) and public.has_role(auth.uid(), 'race_manager');
$$;

-- Quién puede asignar gestores: el admin de la liga dueña, o el superadmin que creó la carrera.
create or replace function public.can_assign_event_managers(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (
        (e.tenant_id = public.current_tenant_id() and public.has_role(auth.uid(), 'admin'))
        or (public.has_role(auth.uid(), 'superadmin') and e.created_by = auth.uid())
      )
  );
$$;

-- El usuario asignado debe ser un gestor de la misma liga que la carrera.
create or replace function public.enforce_event_manager_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.events e
    join public.profiles p on p.id = new.user_id
    where e.id = new.event_id and p.role = 'race_manager' and p.tenant_id = e.tenant_id
  ) then
    raise exception 'Solo se puede asignar un gestor de carreras de la misma liga';
  end if;
  new.tenant_id := (select tenant_id from public.events where id = new.event_id);
  new.assigned_by := auth.uid();
  return new;
end; $$;

drop trigger if exists trg_event_managers_check on public.event_managers;
create trigger trg_event_managers_check before insert on public.event_managers
  for each row execute function public.enforce_event_manager_assignment();

drop policy if exists "event_managers_read" on public.event_managers;
create policy "event_managers_read" on public.event_managers for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'superadmin') or public.can_assign_event_managers(event_id));

drop policy if exists "event_managers_insert" on public.event_managers;
create policy "event_managers_insert" on public.event_managers for insert to authenticated
  with check (public.can_assign_event_managers(event_id));

drop policy if exists "event_managers_delete" on public.event_managers;
create policy "event_managers_delete" on public.event_managers for delete to authenticated
  using (public.can_assign_event_managers(event_id));

-- Eventos: el gestor ya no crea carreras y solo ve/edita las que tiene asignadas.
drop policy if exists "events_race_manager_insert" on public.events;

drop policy if exists "events_race_manager_read" on public.events;
create policy "events_race_manager_read" on public.events for select to authenticated
  using (public.is_event_manager(id));

drop policy if exists "events_race_manager_update" on public.events;
create policy "events_race_manager_update" on public.events for update to authenticated
  using (public.is_event_manager(id) and status not in ('approved', 'in_progress', 'finished', 'cancelled'))
  with check (public.is_event_manager(id) and status not in ('approved', 'in_progress', 'finished', 'cancelled'));

-- can_manage_event: admin de la liga dueña, superadmin creador, o gestor asignado.
-- (Antes bastaba con tener el mismo tenant, lo que incluía a cualquier rol de la liga.)
create or replace function public.can_manage_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status not in ('in_progress', 'finished')
      and (
        (e.tenant_id = public.current_tenant_id() and public.has_role(auth.uid(), 'admin'))
        or (public.has_role(auth.uid(), 'superadmin') and e.created_by = auth.uid())
        or public.is_event_manager(e.id)
      )
  );
$$;

-- Asignar jueces a checkpoints: también el gestor (can_manage_event ya exige que esté asignado).
drop policy if exists "checkpoint_judges_manage" on public.checkpoint_judges;
create policy "checkpoint_judges_manage" on public.checkpoint_judges for all to authenticated
  using (
    (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'race_manager'))
    and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and public.can_manage_event(c.event_id))
  )
  with check (
    (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'race_manager'))
    and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and public.can_manage_event(c.event_id))
  );

-- El gestor asignado puede leer las inscripciones de su carrera (Inscritos / Sin pagar).
drop policy if exists "registrations_manager_read" on public.registrations;
create policy "registrations_manager_read" on public.registrations for select to authenticated
  using (public.is_event_manager(event_id));

-- ---------- 4) Quién aprueba una carrera -----------------------------
alter table public.events add column if not exists approval_by text not null default 'league';
alter table public.events drop constraint if exists events_approval_by_check;
alter table public.events add constraint events_approval_by_check check (approval_by in ('league', 'federation'));

update public.events e set approval_by = 'federation'
 where exists (select 1 from public.profiles p where p.id = e.created_by and p.role = 'superadmin');

create or replace function public.set_event_created_by()
returns trigger language plpgsql set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.approval_by := case when public.has_role(auth.uid(), 'superadmin') then 'federation' else 'league' end;
  return new;
end; $$;

create or replace function public.enforce_events_write_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_super  boolean := public.has_role(auth.uid(), 'superadmin');
  is_creator boolean := old.created_by is not null and old.created_by = auth.uid();
  is_own_tenant boolean := coalesce(old.tenant_id = public.current_tenant_id(), false);
  is_manager boolean := public.has_role(auth.uid(), 'race_manager');
  core_unchanged boolean :=
    new.title is not distinct from old.title and
    new.date is not distinct from old.date and
    new.location is not distinct from old.location and
    new.distance_km is not distinct from old.distance_km and
    new.obstacles is not distinct from old.obstacles and
    new.max_capacity is not distinct from old.max_capacity and
    new.is_official is not distinct from old.is_official and
    new.club_id is not distinct from old.club_id and
    new.tenant_id is not distinct from old.tenant_id;
  becoming_approved boolean := new.status = 'approved' and old.status is distinct from 'approved';
begin
  if auth.uid() is null then
    return new;
  end if;

  if becoming_approved and new.is_official is null then
    raise exception 'La carrera debe indicar si es oficial o no antes de aprobarla';
  end if;

  -- El gestor solo edita datos y envía a revisión: nunca publica ni marca aprobaciones.
  if is_manager and (
    new.published is distinct from old.published or
    new.league_approved is distinct from old.league_approved or
    new.federation_approved is distinct from old.federation_approved or
    new.approved_at is distinct from old.approved_at or
    new.approval_by is distinct from old.approval_by or
    new.created_by is distinct from old.created_by
  ) then
    raise exception 'Un gestor no puede aprobar ni publicar carreras';
  end if;

  -- Una carrera creada por la federación solo la aprueba la federación.
  if becoming_approved and old.approval_by = 'federation' and not is_super then
    raise exception 'Esta carrera la aprueba la federación';
  end if;

  if is_own_tenant or (is_super and is_creator) then
    if old.status in ('in_progress', 'finished') and not core_unchanged then
      raise exception 'La carrera ya está en curso o finalizada; no se puede modificar';
    end if;
    return new;
  end if;

  if is_super then
    -- La federación solo aprueba/rechaza lo que ella misma creó; las carreras de las ligas las aprueba su director.
    if old.approval_by = 'federation'
       and old.status = 'pending_federation' and new.status in ('approved', 'draft') and core_unchanged then
      return new;
    end if;
    raise exception 'El superadmin solo puede aprobar o rechazar carreras creadas por la federación';
  end if;

  raise exception 'No tienes permiso para modificar esta carrera';
end; $$;

-- ---------- 5) Edad de las categorías estándar -----------------------
update public.event_categories
   set min_age = (regexp_match(name, '(\d{1,2})\s*-\s*(\d{1,2})'))[1]::int,
       max_age = (regexp_match(name, '(\d{1,2})\s*-\s*(\d{1,2})'))[2]::int
 where min_age is null and max_age is null and name ~ '(\d{1,2})\s*-\s*(\d{1,2})';
update public.event_categories
   set min_age = (regexp_match(name, '(\d{1,2})\s*\+'))[1]::int
 where min_age is null and max_age is null and name ~ '(\d{1,2})\s*\+';
