-- =====================================================================
-- 0047 — Track: ajustes de las tablas para el motor de reglas v0.2.0.
-- Idempotente.
--
--  * Los identificadores de oleada y de desempate son TEXTO LIBRE: el motor crea oleadas con ids derivados
--    (<stage_id>-r1-h1, <stage_id>-r1b-h1, <desempate>-h1...). Dejan de ser uuid.
--  * Las oleadas de desempate pertenecen a la "salida 0" (run_number = 0).
--  * Las oleadas que se crean al reiniciar una salida por lluvia llevan pairing_source = 'restart'.
-- =====================================================================

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'track_heats' and column_name = 'id') = 'uuid' then
    alter table public.track_heat_lanes drop constraint if exists track_heat_lanes_heat_id_fkey;
    alter table public.track_heats alter column id type text using id::text;
    alter table public.track_heat_lanes alter column heat_id type text using heat_id::text;
    alter table public.track_heat_lanes
      add constraint track_heat_lanes_heat_id_fkey foreign key (heat_id) references public.track_heats(id) on delete cascade;
  end if;

  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'track_heats' and column_name = 'tiebreak_id') = 'uuid' then
    alter table public.track_heats alter column tiebreak_id type text using tiebreak_id::text;
  end if;

  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'track_withdrawals' and column_name = 'heat_id') = 'uuid' then
    alter table public.track_withdrawals alter column heat_id type text using heat_id::text;
  end if;

  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'track_tiebreaks' and column_name = 'id') = 'uuid' then
    alter table public.track_tiebreaks alter column id drop default;
    alter table public.track_tiebreaks alter column id type text using id::text;
    alter table public.track_tiebreaks alter column id set default gen_random_uuid()::text;
  end if;
end $$;

alter table public.track_heats drop constraint if exists track_heats_run_number_check;
alter table public.track_heats add constraint track_heats_run_number_check check (run_number >= 0);

alter table public.track_heats drop constraint if exists track_heats_pairing_source_check;
alter table public.track_heats add constraint track_heats_pairing_source_check
  check (pairing_source in ('fedocr', 'same_as_previous', 'random', 'manual', 'seeded', 'restart'));
