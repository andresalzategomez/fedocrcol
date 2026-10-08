-- =====================================================================
-- 0032 — Registro de los avisos (webhook) que llegan de Bold.
--
-- Bold no muestra historial de envíos y no hay forma de ver los logs del
-- servidor, así que sin esto no se puede saber si un aviso llegó, si la
-- firma fue válida ni qué respondió la app. Guarda un resumen SIN datos
-- personales (no se guardan correo del pagador ni datos de tarjeta).
-- Solo el servidor (service_role) escribe; la federación (superadmin) lee.
-- Idempotente.
-- =====================================================================

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  signature_valid boolean,
  event_type text,
  reference text,
  payment_id text,
  payment_method text,
  amount numeric,
  http_status integer,
  outcome text,
  user_agent text,
  summary jsonb
);

create index if not exists idx_payment_webhook_events_received on public.payment_webhook_events(received_at desc);

grant select on public.payment_webhook_events to authenticated;
grant all on public.payment_webhook_events to service_role;
alter table public.payment_webhook_events enable row level security;

drop policy if exists "payment_webhook_events_read" on public.payment_webhook_events;
create policy "payment_webhook_events_read" on public.payment_webhook_events for select to authenticated
  using (public.has_role(auth.uid(), 'superadmin'));
