-- =====================================================================
-- 0043 — Formato de carrera: estándar (OCR) o track.
-- Idempotente.
--
-- events.race_format distingue las carreras OCR normales ('standard', las que
-- cronometra FedOCR Timer por /api/v1) de las carreras tipo TRACK ('track',
-- las que cronometra Timer_track por /api/track/v1). Las carreras track no
-- las ve ni las puede operar /api/v1.
-- =====================================================================

alter table public.events add column if not exists race_format text not null default 'standard';

alter table public.events drop constraint if exists events_race_format_check;
alter table public.events
  add constraint events_race_format_check check (race_format in ('standard', 'track'));

create index if not exists idx_events_race_format on public.events(race_format);
