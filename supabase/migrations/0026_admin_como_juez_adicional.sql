-- =====================================================================
-- 0026 — Un admin de liga puede aparecer también en la lista de jueces
-- de su propia liga (para asignarlo a un checkpoint) SIN dejar de ser
-- admin. Idempotente.
--
-- Un atleta (o club, o gestor) que se invita como juez SÍ cambia de rol
-- por completo -- un usuario normal no puede ser juez y atleta a la vez
-- (eso ya lo resuelve profiles.role, sin necesidad de esta tabla).
--
-- Un admin (o superadmin) es distinto: conserva su rol y su acceso
-- normal, y esta tabla solo lo marca como "también disponible como
-- juez" en esa liga, para que aparezca en el selector de checkpoints.
-- No reemplaza checkpoint_judges (esa sigue siendo la asignación real
-- a un checkpoint puntual) ni cambia los permisos de escritura de
-- timing_reads -- un admin de liga ya puede escribir tiempos de su
-- propia liga hoy (timing_reads_insert_scoped compara tenant_id, no
-- profiles.role). Actuar como juez de OTRA liga sigue sin soportarse
-- (queda pendiente para más adelante).
-- =====================================================================

create table if not exists public.tenant_judges (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

grant select, insert, update, delete on public.tenant_judges to authenticated;
grant all on public.tenant_judges to service_role;
alter table public.tenant_judges enable row level security;

drop policy if exists "tenant_judges_read_scoped" on public.tenant_judges;
create policy "tenant_judges_read_scoped" on public.tenant_judges for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or tenant_id = public.current_tenant_id()
    or user_id = auth.uid()
  );
