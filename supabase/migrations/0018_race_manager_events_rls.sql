-- =====================================================================
-- 0018 — Fase B: permisos de events para el rol race_manager.
-- Idempotente.
--
-- events_tenant_manage dejaba escribir en `events` a CUALQUIER usuario
-- autenticado del mismo tenant (sin chequear rol) — funcionaba porque
-- hasta ahora solo admin/superadmin usaban esa vía desde el panel. Con
-- race_manager como rol deliberadamente limitado ("solo crea/edita
-- carreras, no aprueba, no borra"), esa laxitud ya no sirve: se
-- restringe events_tenant_manage a admin/superadmin, y se agregan
-- políticas propias para race_manager (insert libre dentro de su liga;
-- update solo mientras el evento no esté aprobado/en curso/finalizado/
-- cancelado, y sin poder mover el estado a esos valores -- así no se
-- puede auto-aprobar ni arrancar/cerrar su propia carrera).
--
-- Nota: event_categories/waves/checkpoints/registrations siguen con el
-- mismo patrón laxo de "cualquier rol del mismo tenant" (deuda técnica
-- ya señalada y aceptada antes, no se toca en esta fase) -- así que
-- race_manager, igual que hoy cualquier atleta/juez, técnicamente aún
-- podría escribir ahí. Pendiente de decidir si se endurece.
-- =====================================================================

drop policy if exists "events_tenant_manage" on public.events;
create policy "events_tenant_manage" on public.events for all to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(), 'admin'))
  )
  with check (
    public.has_role(auth.uid(), 'superadmin')
    or (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(), 'admin'))
  );

drop policy if exists "events_race_manager_read" on public.events;
create policy "events_race_manager_read" on public.events for select to authenticated
  using (public.has_role(auth.uid(), 'race_manager') and tenant_id = public.current_tenant_id());

drop policy if exists "events_race_manager_insert" on public.events;
create policy "events_race_manager_insert" on public.events for insert to authenticated
  with check (public.has_role(auth.uid(), 'race_manager') and tenant_id = public.current_tenant_id());

drop policy if exists "events_race_manager_update" on public.events;
create policy "events_race_manager_update" on public.events for update to authenticated
  using (
    public.has_role(auth.uid(), 'race_manager')
    and tenant_id = public.current_tenant_id()
    and status not in ('approved', 'in_progress', 'finished', 'cancelled')
  )
  with check (
    public.has_role(auth.uid(), 'race_manager')
    and tenant_id = public.current_tenant_id()
    and status not in ('approved', 'in_progress', 'finished', 'cancelled')
  );
