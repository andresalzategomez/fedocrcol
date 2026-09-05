-- =====================================================================
-- 0012 — Carrera oficial, congelamiento al iniciar, y alcance del superadmin
-- Idempotente.
--
-- 1) `events.is_official`: obligatorio (a nivel de app + trigger) antes de
--    poder aprobar una carrera.
-- 2) `events.created_by`: quién creó la carrera (lo fija un trigger, nunca
--    el cliente). Sirve para la regla 3.
-- 3) Trigger `enforce_events_write_rules`: una carrera EN CURSO no se puede
--    modificar (solo se le puede cambiar el status, p.ej. finalizarla); y
--    un superadmin que no creó la carrera solo puede aprobarla/rechazarla
--    (pending_federation -> approved/draft), nunca tocar su contenido.
-- 4) `can_manage_event(event_id)`: misma regla aplicada a checkpoints,
--    waves, event_categories y registrations (todas cuelgan de un event_id).
-- =====================================================================

alter table public.events add column if not exists is_official boolean;
alter table public.events add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- El creador de una carrera lo decide el servidor (auth.uid()), nunca el cliente.
create or replace function public.set_event_created_by()
returns trigger language plpgsql as $$
begin
  new.created_by := auth.uid();
  return new;
end; $$;

drop trigger if exists trg_events_created_by on public.events;
create trigger trg_events_created_by before insert on public.events
  for each row execute function public.set_event_created_by();

-- Reglas de escritura sobre `events`.
create or replace function public.enforce_events_write_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_super  boolean := public.has_role(auth.uid(), 'superadmin');
  is_creator boolean := old.created_by is not null and old.created_by = auth.uid();
  is_own_tenant boolean := coalesce(old.tenant_id = public.current_tenant_id(), false);
  core_unchanged boolean :=
    new.title is not distinct from old.title and
    new.date is not distinct from old.date and
    new.location is not distinct from old.location and
    new.distance_km is not distinct from old.distance_km and
    new.obstacles is not distinct from old.obstacles and
    new.max_capacity is not distinct from old.max_capacity and
    new.is_official is not distinct from old.is_official and
    new.tenant_id is not distinct from old.tenant_id;
begin
  -- No se puede aprobar una carrera sin haber indicado si es oficial.
  if new.status = 'approved' and old.status is distinct from 'approved' and new.is_official is null then
    raise exception 'La carrera debe indicar si es oficial o no antes de aprobarla';
  end if;

  if is_own_tenant or (is_super and is_creator) then
    -- Dueño de la carrera (su liga, o el superadmin que la creó): puede
    -- editarla mientras no haya iniciado. Ya iniciada, solo se le puede
    -- cambiar el estado (p.ej. finalizarla), no su contenido.
    if old.status = 'in_progress' and not core_unchanged then
      raise exception 'La carrera ya está en curso; no se puede modificar';
    end if;
    return new;
  end if;

  if is_super then
    -- Un superadmin que no creó la carrera solo puede aprobarla o
    -- rechazarla — nunca tocar su contenido ni su estado de otra forma.
    if old.status = 'pending_federation' and new.status in ('approved', 'draft') and core_unchanged then
      return new;
    end if;
    raise exception 'El superadmin solo puede aprobar o rechazar carreras que no creó';
  end if;

  raise exception 'No tienes permiso para modificar esta carrera';
end; $$;

drop trigger if exists trg_events_write_rules on public.events;
create trigger trg_events_write_rules before update on public.events
  for each row execute function public.enforce_events_write_rules();

-- Regla compartida para checkpoints/waves/event_categories/registrations:
-- se puede escribir si (dueño de la liga, o superadmin creador) y la
-- carrera no está en curso.
create or replace function public.can_manage_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status <> 'in_progress'
      and (
        e.tenant_id = public.current_tenant_id()
        or (public.has_role(auth.uid(), 'superadmin') and e.created_by = auth.uid())
      )
  );
$$;

-- Waves
drop policy if exists "waves_tenant_manage" on public.waves;
create policy "waves_tenant_manage" on public.waves for all to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- Checkpoints
drop policy if exists "checkpoints_tenant_manage" on public.checkpoints;
create policy "checkpoints_tenant_manage" on public.checkpoints for all to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- Event categories
drop policy if exists "categories_tenant_manage" on public.event_categories;
create policy "categories_tenant_manage" on public.event_categories for all to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- Registrations: edición desde el panel (dorsal, oleada, status).
drop policy if exists "registrations_admin_update" on public.registrations;
create policy "registrations_admin_update" on public.registrations for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- Registrations: alta (panel o inscripción pública del sitio). Antes solo
-- exigía status='pending'; ahora además bloquea si la carrera ya inició.
drop policy if exists "registrations_public_insert" on public.registrations;
create policy "registrations_public_insert" on public.registrations for insert to anon, authenticated
  with check (
    status = 'pending'
    and exists (select 1 from public.events e where e.id = event_id and e.status <> 'in_progress')
  );
