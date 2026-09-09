-- =====================================================================
-- 0015 — Jueces por checkpoint
-- Idempotente.
--
-- Un admin de liga puede crear cuentas de "juez" (nuevo rol) por cada
-- carrera y asignarlas a uno o varios checkpoints. El mismo juez puede
-- quedar asignado a varios checkpoints (incluso de carreras distintas).
-- El juez inicia sesión en FedOCR Timer con esa cuenta; el Timer decide
-- qué mostrarle según lo que le devuelva GET /races/:id/splits (filtrado
-- server-side para el rol judge — ver ese endpoint).
-- =====================================================================

-- Nuevo valor de enum: no se puede envolver en una transacción junto con
-- su uso inmediato, así que va solo en su propio statement (Postgres 12+
-- permite IF NOT EXISTS, idempotente).
alter type public.app_role add value if not exists 'judge';

-- profiles no tenía email propio (vive en auth.users, no expuesto al
-- cliente vía RLS) — se denormaliza para poder listar jueces con su
-- correo desde el panel sin un endpoint aparte.
alter table public.profiles add column if not exists email text;

create table if not exists public.checkpoint_judges (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  judge_id      uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (checkpoint_id, judge_id)
);
create index if not exists idx_checkpoint_judges_judge on public.checkpoint_judges(judge_id);
create index if not exists idx_checkpoint_judges_checkpoint on public.checkpoint_judges(checkpoint_id);

grant select, insert, update, delete on public.checkpoint_judges to authenticated;
grant all on public.checkpoint_judges to service_role;
alter table public.checkpoint_judges enable row level security;

-- El juez lee sus propias asignaciones (así el Timer puede resolver "qué
-- checkpoints tengo" si alguna vez hace falta consultarlo directo).
drop policy if exists "checkpoint_judges_read_own" on public.checkpoint_judges;
create policy "checkpoint_judges_read_own" on public.checkpoint_judges for select to authenticated
  using (judge_id = auth.uid());

-- Gestionar asignaciones: solo admin/superadmin, y solo si pueden
-- gestionar el evento dueño del checkpoint (misma regla de congelamiento
-- que checkpoints/oleadas/categorías — in_progress/finished bloquea).
-- Nota: a diferencia de otras políticas de este esquema, aquí SÍ se exige
-- el rol admin/superadmin explícitamente (no solo "mismo tenant"), porque
-- ahora puede haber jueces en el mismo tenant y no deben poder
-- reasignarse a sí mismos ni a otros.
drop policy if exists "checkpoint_judges_manage" on public.checkpoint_judges;
create policy "checkpoint_judges_manage" on public.checkpoint_judges for all to authenticated
  using (
    (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'superadmin'))
    and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and public.can_manage_event(c.event_id))
  )
  with check (
    (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'superadmin'))
    and exists (select 1 from public.checkpoints c where c.id = checkpoint_id and public.can_manage_event(c.event_id))
  );
