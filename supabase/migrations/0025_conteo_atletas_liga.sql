-- =====================================================================
-- 0025 — Conteo público de atletas por liga.
-- Idempotente.
--
-- profiles no tiene grant de select para anon (correcto, tiene datos
-- personales), así que para mostrar "N atletas" en las tarjetas de
-- liga (home y /ligas) se expone una vista agregada sin PII -- solo
-- tenant_id y el conteo. Mismo patrón que v_athlete_ranking y
-- registrations_public.
-- =====================================================================

create or replace view public.league_athlete_counts as
select tenant_id, count(*) as athlete_count
from public.profiles
where role = 'athlete' and tenant_id is not null
group by tenant_id;

grant select on public.league_athlete_counts to anon, authenticated;
grant all on public.league_athlete_counts to service_role;
