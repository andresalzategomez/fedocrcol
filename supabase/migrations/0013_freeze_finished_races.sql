-- =====================================================================
-- 0013 — El congelamiento de carrera también aplica a `finished`
-- Idempotente.
--
-- La 0012 congelaba el contenido de una carrera (checkpoints, oleadas,
-- categorías, inscritos) solo mientras estaba `in_progress`. Una carrera
-- `finished` quedaba editable otra vez — bug reportado desde el panel:
-- se podían seguir agregando/borrando categorías de una carrera ya
-- finalizada. Ahora el congelamiento cubre `in_progress` Y `finished`.
-- =====================================================================

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
  -- Sin sesión de usuario autenticado (service_role vía API, o una conexión
  -- administrativa directa como el SQL Editor / MCP de Supabase): omite
  -- estas reglas, igual que ya omite RLS por diseño del proyecto.
  if auth.uid() is null then
    return new;
  end if;

  -- No se puede aprobar una carrera sin haber indicado si es oficial.
  if new.status = 'approved' and old.status is distinct from 'approved' and new.is_official is null then
    raise exception 'La carrera debe indicar si es oficial o no antes de aprobarla';
  end if;

  if is_own_tenant or (is_super and is_creator) then
    -- Dueño de la carrera (su liga, o el superadmin que la creó): puede
    -- editarla mientras no esté en curso ni finalizada. En esos dos
    -- estados solo se le puede seguir cambiando el status (p.ej. cerrarla).
    if old.status in ('in_progress', 'finished') and not core_unchanged then
      raise exception 'La carrera ya está en curso o finalizada; no se puede modificar';
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

-- Regla compartida para checkpoints/waves/event_categories/registrations:
-- se puede escribir si (dueño de la liga, o superadmin creador) y la
-- carrera no está en curso ni finalizada.
create or replace function public.can_manage_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status not in ('in_progress', 'finished')
      and (
        e.tenant_id = public.current_tenant_id()
        or (public.has_role(auth.uid(), 'superadmin') and e.created_by = auth.uid())
      )
  );
$$;

-- Registrations: alta (panel o inscripción pública del sitio) — mismo
-- criterio ampliado.
drop policy if exists "registrations_public_insert" on public.registrations;
create policy "registrations_public_insert" on public.registrations for insert to anon, authenticated
  with check (
    status = 'pending'
    and exists (select 1 from public.events e where e.id = event_id and e.status not in ('in_progress', 'finished'))
  );
