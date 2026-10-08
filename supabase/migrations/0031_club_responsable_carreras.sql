-- =====================================================================
-- 0031 — Club responsable de una carrera oficial + clubes independientes
-- sin permiso de crear carreras.
--
-- * events.club_id: club responsable de la carrera. Solo una carrera
--   OFICIAL puede tenerlo; si no tiene, la responsable es la liga.
--   El club debe estar activo y ser de la liga de la carrera, o ser un
--   club independiente (su tenant tiene allows_events = false) -- esos
--   pueden ser responsables de carreras de cualquier liga.
-- * tenants.allows_events: false para el tenant que se crea al aprobar
--   un club independiente (approveIndependentClub): no puede crear
--   carreras, solo ser club responsable en las de otras ligas.
-- Idempotente.
-- =====================================================================

alter table public.tenants add column if not exists allows_events boolean not null default true;

alter table public.events add column if not exists club_id uuid references public.clubs(id) on delete set null;
create index if not exists idx_events_club on public.events(club_id);

create or replace function public.enforce_event_club_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and exists (
    select 1 from public.tenants t where t.id = new.tenant_id and t.allows_events = false
  ) then
    raise exception 'Este club independiente no puede crear carreras';
  end if;

  if new.club_id is not null and (
    tg_op = 'INSERT' or new.club_id is distinct from old.club_id or new.is_official is distinct from old.is_official
  ) then
    if new.is_official is distinct from true then
      raise exception 'Solo una carrera oficial puede tener club responsable';
    end if;
    if not exists (
      select 1
      from public.clubs c
      join public.tenants ct on ct.id = c.tenant_id
      where c.id = new.club_id
        and c.approval_status = 'active'
        and c.status = 'active'
        and (c.tenant_id = new.tenant_id or ct.allows_events = false)
    ) then
      raise exception 'El club responsable debe estar activo y ser de la liga de la carrera o un club independiente';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_events_club_rules on public.events;
create trigger trg_events_club_rules before insert or update on public.events
  for each row execute function public.enforce_event_club_rules();

-- El club responsable también queda congelado cuando la carrera está en curso o
-- finalizada (igual que el resto de sus datos): se suma a core_unchanged.
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
    new.club_id is not distinct from old.club_id and
    new.tenant_id is not distinct from old.tenant_id;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' and new.is_official is null then
    raise exception 'La carrera debe indicar si es oficial o no antes de aprobarla';
  end if;

  if is_own_tenant or (is_super and is_creator) then
    if old.status in ('in_progress', 'finished') and not core_unchanged then
      raise exception 'La carrera ya está en curso o finalizada; no se puede modificar';
    end if;
    return new;
  end if;

  if is_super then
    if old.status = 'pending_federation' and new.status in ('approved', 'draft') and core_unchanged then
      return new;
    end if;
    raise exception 'El superadmin solo puede aprobar o rechazar carreras que no creó';
  end if;

  raise exception 'No tienes permiso para modificar esta carrera';
end; $$;
