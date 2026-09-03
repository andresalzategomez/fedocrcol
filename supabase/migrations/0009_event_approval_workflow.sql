-- =====================================================================
-- 0009 — Flujo de aprobación / ciclo de vida de eventos
-- Estados: draft → pending_federation → approved → in_progress → finished
--          (o cancelled). La liga envía; la federación aprueba/rechaza.
-- Idempotente.
-- =====================================================================

do $$ begin
  create type public.event_status as enum
    ('draft','pending_federation','approved','in_progress','finished','cancelled');
exception when duplicate_object then null; end $$;

alter table public.events add column if not exists status public.event_status not null default 'draft';
alter table public.events add column if not exists league_approved boolean not null default false;
alter table public.events add column if not exists federation_approved boolean not null default false;
alter table public.events add column if not exists submitted_at timestamptz;
alter table public.events add column if not exists approved_at timestamptz;

-- Los eventos ya publicados quedan aprobados (compatibilidad hacia atrás).
update public.events
   set status = 'approved', league_approved = true, federation_approved = true, approved_at = now()
 where published = true and status = 'draft';
