-- =====================================================================
-- 0024 — Vista pública de inscritos por carrera.
-- Idempotente.
--
-- La tabla registrations tiene RLS restringido a "solo mis propias
-- inscripciones" (ver registrations_read_scoped), así que para mostrar
-- la lista pública de inscritos de una carrera se expone una vista
-- con solo las columnas no sensibles (nombre, categoría, dorsal,
-- estado) -- nunca documento, email, teléfono, fecha de nacimiento,
-- EPS/RH ni contacto de emergencia. Mismo patrón que v_athlete_ranking.
-- =====================================================================

create or replace view public.registrations_public as
select
  r.id,
  r.event_id,
  r.tenant_id,
  r.category_id,
  ec.name as category_name,
  r.athlete_name,
  r.bib_number,
  r.status,
  r.created_at
from public.registrations r
join public.event_categories ec on ec.id = r.category_id
where r.status <> 'cancelled';

grant select on public.registrations_public to anon, authenticated;
grant all on public.registrations_public to service_role;
