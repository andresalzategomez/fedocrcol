-- =====================================================================
-- 0038 — Camiseta por carrera y liga eximida del pago de afiliación.
-- Idempotente.
--
-- 1) events.includes_shirt: no todas las carreras llevan camiseta; el
--    formulario de inscripción solo pide nombre y talla si está activo. Las
--    carreras que ya existían quedan en true (hoy ya piden esos datos).
-- 2) league_affiliation_payments.exempt: la federación puede aprobar una liga
--    sin cobro. Ese registro queda con monto 0, sin link de Bold y con estado
--    'exempt' (sirve para el reporte de cobros: aparece como "exonerada").
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'includes_shirt'
  ) then
    alter table public.events add column includes_shirt boolean not null default false;
    update public.events set includes_shirt = true;
  end if;
end $$;

alter table public.league_affiliation_payments add column if not exists exempt boolean not null default false;
alter table public.league_affiliation_payments alter column bold_link_id drop not null;
alter table public.league_affiliation_payments alter column payment_url drop not null;

alter table public.league_affiliation_payments drop constraint if exists league_affiliation_payments_amount_check;
alter table public.league_affiliation_payments
  add constraint league_affiliation_payments_amount_check check (amount >= 0 and (exempt or amount > 0));

alter table public.league_affiliation_payments drop constraint if exists league_affiliation_payments_status_check;
alter table public.league_affiliation_payments
  add constraint league_affiliation_payments_status_check check (status in ('pending', 'paid', 'exempt'));
