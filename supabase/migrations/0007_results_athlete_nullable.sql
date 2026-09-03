-- =====================================================================
-- 0007_results_athlete_nullable
-- Un resultado puede pertenecer a una inscripción de invitado (sin perfil
-- de usuario), así que athlete_id deja de ser obligatorio.
-- Idempotente.
-- =====================================================================

alter table public.results alter column athlete_id drop not null;
