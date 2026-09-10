-- =====================================================================
-- 0020 — Fase D: paneles de aprobación (superadmin y admin de liga).
-- Idempotente.
--
-- tenants_admin_update_own ya dejaba al admin de una liga editar
-- CUALQUIER columna de su propia liga -- inofensivo antes de que
-- 'pending'/'rejected' existieran, pero ahora un admin podría
-- auto-aprobarse (status='active') con un update directo. Se agrega un
-- trigger (RLS no puede comparar old vs new fácilmente) que bloquea
-- cualquier cambio de status que no venga del superadmin, salvo la
-- única transición que el propio admin sí puede hacer: reintentar tras
-- un rechazo (rejected -> pending), igual que ya existe para clubs vía
-- clubs_owner_manage.
-- =====================================================================

alter type public.tenant_status add value if not exists 'rejected';

create or replace function public.enforce_tenants_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service_role / conexión directa (migraciones, MCP)
  end if;
  if new.status is distinct from old.status then
    if public.has_role(auth.uid(), 'superadmin') then
      return new;
    end if;
    if public.has_role(auth.uid(), 'admin') and old.id = public.current_tenant_id()
       and old.status = 'rejected' and new.status = 'pending' then
      return new;
    end if;
    raise exception 'No tienes permiso para cambiar el estado de esta liga';
  end if;
  return new;
end; $$;

drop trigger if exists trg_tenants_status_change on public.tenants;
create trigger trg_tenants_status_change before update on public.tenants
  for each row execute function public.enforce_tenants_status_change();
