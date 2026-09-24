-- =====================================================================
-- 0023 — Evitar que un mismo atleta se inscriba varias veces al
-- mismo evento.
-- Idempotente.
--
-- El documento (athlete_document) es la clave real de identidad del
-- atleta -- se guarda tanto en inscripciones de usuarios logueados
-- como anónimas, a diferencia de athlete_id que solo existe si hay
-- sesión. El índice único es parcial: ignora inscripciones canceladas,
-- para permitir reinscribirse si la anterior fue cancelada.
-- =====================================================================

drop index if exists public.registrations_event_athlete_unique;
create unique index registrations_event_athlete_unique
  on public.registrations (event_id, athlete_document)
  where status <> 'cancelled' and athlete_document is not null;
