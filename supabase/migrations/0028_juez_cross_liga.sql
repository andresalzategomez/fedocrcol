-- =====================================================================
-- 0028 — Un juez (o admin marcado como juez adicional, ver 0026) puede
-- registrar y leer tiempos de un checkpoint de OTRA liga, si tiene una
-- fila en checkpoint_judges para ese checkpoint puntual.
-- Idempotente.
--
-- Antes, timing_reads_insert_scoped/read_scoped solo comparaban
-- tenant_id = current_tenant_id(): un juez SOLO podía operar en la
-- liga de su propio profiles.tenant_id, sin importar si lo habían
-- asignado a un checkpoint de otra liga (ver checkpoint_judges_manage,
-- que ya permitía esa asignación -- el hueco estaba solo en la
-- escritura/lectura de timing_reads, no en poder asignarlo).
--
-- La condición nueva NO confía en el tenant_id que venga en la fila
-- (el cliente lo manda, no se deriva del servidor): valida que
-- checkpoint_id, event_id y tenant_id sean mutuamente consistentes
-- con la asignación real en checkpoint_judges/checkpoints/events,
-- para que nadie pueda "colar" un tenant_id o event_id que no le
-- corresponda a ese checkpoint aunque sí esté asignado a él.
--
-- No cambia el camino ya existente (tenant_id = current_tenant_id()):
-- ese solo cubre la liga propia de cada quien, como siempre.
-- =====================================================================

drop policy if exists "timing_reads_read_scoped" on public.timing_reads;
create policy "timing_reads_read_scoped" on public.timing_reads for select to authenticated
  using (
    public.has_role(auth.uid(),'superadmin')
    or tenant_id = public.current_tenant_id()
    or exists (
      select 1
      from public.checkpoint_judges cj
      join public.checkpoints c on c.id = cj.checkpoint_id
      join public.events e on e.id = c.event_id
      where cj.judge_id = auth.uid()
        and cj.checkpoint_id = timing_reads.checkpoint_id
        and c.event_id = timing_reads.event_id
        and e.tenant_id = timing_reads.tenant_id
    )
  );

drop policy if exists "timing_reads_insert_scoped" on public.timing_reads;
create policy "timing_reads_insert_scoped" on public.timing_reads for insert to authenticated
  with check (
    public.has_role(auth.uid(),'superadmin')
    or tenant_id = public.current_tenant_id()
    or exists (
      select 1
      from public.checkpoint_judges cj
      join public.checkpoints c on c.id = cj.checkpoint_id
      join public.events e on e.id = c.event_id
      where cj.judge_id = auth.uid()
        and cj.checkpoint_id = timing_reads.checkpoint_id
        and c.event_id = timing_reads.event_id
        and e.tenant_id = timing_reads.tenant_id
    )
  );
