-- =====================================================================
-- 0030 — Cuota de afiliación de una liga nueva, cobrada con un Link de
-- Pagos de Bold.
--
-- Flujo: la liga solicita (pending) -> la federación aprueba definiendo el
-- monto (awaiting_payment, se crea el link en Bold) -> Bold notifica el
-- pago por webhook (o la federación pulsa "verificar pago") -> active.
--
-- El link y el monto viven en una tabla aparte, NO en tenants: tenants es
-- de lectura pública (anon) y no hay motivo para exponer ahí el cobro.
-- Solo el servidor (service_role) escribe en league_affiliation_payments.
-- Idempotente.
-- =====================================================================

alter type public.tenant_status add value if not exists 'awaiting_payment';

create table if not exists public.league_affiliation_payments (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  bold_link_id text not null,
  payment_url text not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  bold_payment_id text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

grant select on public.league_affiliation_payments to authenticated;
grant all on public.league_affiliation_payments to service_role;
alter table public.league_affiliation_payments enable row level security;

drop policy if exists "league_affiliation_payments_read" on public.league_affiliation_payments;
create policy "league_affiliation_payments_read" on public.league_affiliation_payments for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  );
