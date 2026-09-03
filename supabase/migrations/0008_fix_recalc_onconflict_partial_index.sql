-- =====================================================================
-- 0008 — Fix: ON CONFLICT sobre índice único PARCIAL debe repetir el predicado.
-- El índice uq_results_registration es `... where registration_id is not null`,
-- así que recalculate_result() debe usar
--   on conflict (registration_id) where registration_id is not null
-- de lo contrario Postgres devuelve 42P10 al dispararse el trigger de recálculo
-- desde una lectura en un checkpoint intermedio.
-- Idempotente.
-- =====================================================================

create or replace function public.recalculate_result(p_registration_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_reg        public.registrations%rowtype;
  v_start_ts   timestamptz;
  v_finish_ts  timestamptz;
  v_athlete    uuid;
begin
  if exists (select 1 from public.results
             where registration_id = p_registration_id and source = 'timer') then
    return;
  end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then return; end if;

  select min(tr.read_at) into v_start_ts
  from public.timing_reads tr
  join public.checkpoints c on c.id = tr.checkpoint_id
  where tr.registration_id = p_registration_id and c.is_start;

  if v_start_ts is null then
    select w.started_at into v_start_ts from public.waves w where w.id = v_reg.wave_id;
  end if;

  select max(tr.read_at) into v_finish_ts
  from public.timing_reads tr
  join public.checkpoints c on c.id = tr.checkpoint_id
  where tr.registration_id = p_registration_id and c.is_finish;

  v_athlete := v_reg.athlete_id;

  insert into public.results (event_id, tenant_id, registration_id, athlete_id,
                              start_time, finish_at, duration_ms, finish_time, status, source)
  values (
    v_reg.event_id, v_reg.tenant_id, p_registration_id, v_athlete,
    v_start_ts, v_finish_ts,
    case when v_start_ts is not null and v_finish_ts is not null
         then (extract(epoch from (v_finish_ts - v_start_ts)) * 1000)::bigint end,
    case when v_start_ts is not null and v_finish_ts is not null
         then (v_finish_ts - v_start_ts) end,
    case when v_finish_ts is not null then 'finished'::public.result_status
         else 'dnf'::public.result_status end,
    'computed'
  )
  on conflict (registration_id) where registration_id is not null do update set
    start_time  = excluded.start_time,
    finish_at   = excluded.finish_at,
    duration_ms = excluded.duration_ms,
    finish_time = excluded.finish_time,
    status      = excluded.status;
end; $$;

revoke execute on function public.recalculate_result(uuid) from anon, authenticated;
grant execute on function public.recalculate_result(uuid) to service_role;
