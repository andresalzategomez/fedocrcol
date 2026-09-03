-- =====================================================================
-- 0010 — event_categories como MAESTRO de categorías por carrera
-- Añade género y rango de edad; el precio pasa a opcional (default 0).
-- Las oleadas ya referencian category_id (event_categories), así que la
-- generación de oleadas se hace por categoría de la carrera.
-- Idempotente.
-- =====================================================================

alter table public.event_categories add column if not exists gender text check (gender in ('F','M','X'));
alter table public.event_categories add column if not exists min_age int;
alter table public.event_categories add column if not exists max_age int;
alter table public.event_categories alter column price set default 0;
