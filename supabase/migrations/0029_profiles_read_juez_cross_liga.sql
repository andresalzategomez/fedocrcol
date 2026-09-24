-- =====================================================================
-- 0029 — Un admin, superadmin o gestor de carreras puede leer el
-- profile de un juez marcado en tenant_judges como "también disponible"
-- para su liga (ver migraciones 0026/0028), aunque ese juez sea nativo
-- de OTRA liga.
--
-- Bug encontrado probando el flujo de invitar un juez de otra liga:
-- profiles_read_own solo dejaba a un admin leer profiles de SU PROPIO
-- tenant_id, así que el join embebido en listJudges()
-- (tenant_judges -> profiles) devolvía profiles=null para el juez
-- foráneo y RLS lo descartaba en silencio de la lista, aunque la
-- invitación (el POST /api/admin/judges, que sí usa service_role) se
-- había guardado correctamente en tenant_judges.
-- Idempotente.
-- =====================================================================

drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
    or (
      (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'race_manager'))
      and exists (
        select 1 from public.tenant_judges tj
        where tj.user_id = profiles.id
          and tj.tenant_id = public.current_tenant_id()
      )
    )
  );
