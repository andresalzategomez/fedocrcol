-- =====================================================================
-- 0034 — Cobro de la inscripción del atleta con un Link de Pagos de Bold.
--
-- registration_payment_links guarda el link vigente de cada inscripción
-- (uno por inscripción: si vence o cambia el monto se reemplaza). Solo el
-- servidor (service_role) lo lee y escribe: RLS activado sin políticas.
-- El webhook y la verificación usan este link para consultar a Bold si de
-- verdad se pagó, en vez de confiar en el cuerpo del aviso.
-- Idempotente.
-- =====================================================================

create table if not exists public.registration_payment_links (
  registration_id uuid primary key references public.registrations(id) on delete cascade,
  bold_link_id text not null,
  payment_url text not null,
  amount numeric(12,2) not null check (amount > 0),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

grant all on public.registration_payment_links to service_role;
alter table public.registration_payment_links enable row level security;
