-- =====================================================================
-- 0042 — Afiliación del atleta a su liga por temporada (Bold) y acuerdo de
-- porcentaje entre la federación y cada liga.
-- Idempotente.
--
-- * athlete_season_memberships: pago anual del atleta a SU liga. Sirve para
--   "pertenecer" a la liga en la temporada; NO es requisito para inscribirse a
--   una carrera (cualquier atleta se inscribe a cualquier carrera). Solo el
--   servidor escribe aquí (Bold / exoneración de la liga).
-- * league_agreements: porcentaje de la afiliación de atletas que la federación
--   le liquida a cada liga (la federación recauda por Bold y liquida a mano).
--   Solo la federación lo escribe; la liga ve el suyo.
-- =====================================================================

create table if not exists public.athlete_season_memberships (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references public.profiles(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  season          int  not null,
  amount          numeric(12,2) not null check (amount >= 0),
  status          text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'exempt')),
  exempt_reason   text,
  bold_link_id    text,
  payment_url     text,
  reference       text,
  bold_payment_id text,
  expires_at      timestamptz,
  paid_at         timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (athlete_id, tenant_id, season)
);
create unique index if not exists uq_athlete_memberships_reference on public.athlete_season_memberships(reference) where reference is not null;
create index if not exists idx_athlete_memberships_tenant_season on public.athlete_season_memberships(tenant_id, season, status);

grant select on public.athlete_season_memberships to authenticated;
grant all on public.athlete_season_memberships to service_role;
alter table public.athlete_season_memberships enable row level security;

drop policy if exists "athlete_memberships_read" on public.athlete_season_memberships;
create policy "athlete_memberships_read" on public.athlete_season_memberships for select to authenticated
  using (
    athlete_id = auth.uid()
    or public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  );

-- ---------- Acuerdo federación - liga ----------
create table if not exists public.league_agreements (
  tenant_id                uuid primary key references public.tenants(id) on delete cascade,
  athlete_fee_league_pct   numeric(5,2) check (athlete_fee_league_pct is null or (athlete_fee_league_pct >= 0 and athlete_fee_league_pct <= 100)),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.profiles(id) on delete set null
);

grant select, insert, update on public.league_agreements to authenticated;
grant all on public.league_agreements to service_role;
alter table public.league_agreements enable row level security;

drop policy if exists "league_agreements_read" on public.league_agreements;
create policy "league_agreements_read" on public.league_agreements for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  );

drop policy if exists "league_agreements_write" on public.league_agreements;
create policy "league_agreements_write" on public.league_agreements for insert to authenticated
  with check (public.has_role(auth.uid(), 'superadmin'));

drop policy if exists "league_agreements_update" on public.league_agreements;
create policy "league_agreements_update" on public.league_agreements for update to authenticated
  using (public.has_role(auth.uid(), 'superadmin'))
  with check (public.has_role(auth.uid(), 'superadmin'));
