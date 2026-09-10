-- =====================================================================
-- 0017 — Fase A: esquema base para Liga/Club con aprobación,
-- rol race_manager, y visibilidad pública/privada de carreras.
-- Idempotente. Solo esquema — sin UI ni flujos todavía (fases B-E).
--
-- Diseño (acordado con el usuario antes de implementar):
-- - Liga nueva: se registra en estado 'pending', el superadmin la aprueba.
-- - Club nuevo: si elige liga, la aprueba el admin de esa liga (tenant_id
--   ya queda apuntando a ella); si no elige liga, la aprueba el
--   superadmin y al aprobarla se le crea su propio tenant ("club
--   independiente") — de ahí que tenant_id deba ser nullable mientras
--   está pendiente sin liga.
-- - Rechazo (liga o club) no borra la cuenta: puede volver a solicitar
--   (se vuelve a poner en 'pending'), así no se pierde el correo usado.
-- - Cambio de liga de un club ya aprobado: se trata igual que una nueva
--   solicitud (tenant_id al valor pedido, approval_status='pending' hasta
--   que la liga nueva lo apruebe).
-- =====================================================================

-- Nuevos roles: no se pueden usar en la misma transacción en que se
-- crean (restricción de Postgres para ALTER TYPE ... ADD VALUE), así que
-- van solos, como ya se hizo para 'judge' en 0015.
alter type public.app_role add value if not exists 'club';
alter type public.app_role add value if not exists 'race_manager';

-- Nuevo estado de tenant para una liga que pidió registrarse y espera
-- aprobación del superadmin.
alter type public.tenant_status add value if not exists 'pending';

-- Quién solicitó la liga (útil para el panel de aprobación del
-- superadmin). Nullable: las ligas creadas antes de esto no tienen dueño.
alter table public.tenants add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Un club puede existir temporalmente sin liga (mientras se aprueba como
-- club independiente y se le crea su propio tenant), así que tenant_id
-- deja de ser obligatorio.
alter table public.clubs alter column tenant_id drop not null;

-- Dueño del club (la cuenta con role='club' que lo administra). Antes de
-- esta migración un club no tenía ningún usuario asociado.
alter table public.clubs add column if not exists owner_id uuid references public.profiles(id) on delete set null;

-- Reutilizamos affiliation_status (pending/active/rejected/expired): es
-- exactamente la semántica que necesita la aprobación de un club, no vale
-- la pena crear un enum casi idéntico.
alter table public.clubs add column if not exists approval_status public.affiliation_status not null default 'pending';
alter table public.clubs add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.clubs add column if not exists approved_at timestamptz;

-- Backfill: todo club que ya existía antes de este flujo de aprobación
-- se considera aprobado (si no, quedarían "pendientes" clubes reales que
-- llevan tiempo operando). Solo corre una vez: de aquí en adelante el
-- default 'pending' aplica a los clubes realmente nuevos.
update public.clubs set approval_status = 'active' where approval_status = 'pending';

-- El dueño de un club puede editar su propia fila (p. ej. reintentar tras
-- un rechazo, o pedir cambiarse de liga) sin depender de pertenecer ya al
-- tenant de esa liga -- justo lo que rompería la política existente
-- clubs_tenant_manage mientras el club está pendiente o sin liga.
drop policy if exists "clubs_owner_manage" on public.clubs;
create policy "clubs_owner_manage" on public.clubs for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Visibilidad de carrera: si es pública, se publican resultados en vivo
-- en el sitio (fase E). Default 'private' -- nada se expone de más por
-- accidente.
do $$ begin
  create type public.event_visibility as enum ('public', 'private');
exception when duplicate_object then null; end $$;

alter table public.events add column if not exists visibility public.event_visibility not null default 'private';
