-- =====================================================================
-- 0041 — Temporadas por liga y cuota anual de los clubes (Bold).
-- Idempotente.
--
-- * league_seasons: cada liga declara su TEMPORADA ACTUAL (año) y fija el valor
--   de la cuota de club y de la cuota de afiliación del atleta (esta última se
--   usa en la tanda 3b). Solo una temporada actual por liga. Se escribe con
--   save_league_season() (security definer, valida el rol).
-- * club_season_memberships: pago de cada club por temporada (Bold). Un club se
--   aprueba una sola vez, pero solo es "vigente" si pagó (o fue exonerado de)
--   la temporada actual de su liga. Solo el servidor escribe aquí.
-- * club_is_current() y la vista clubs_current: clubes vigentes con SOLO datos
--   públicos. Sin pago vigente el club no aparece en listas públicas, no se
--   puede elegir al registrar un atleta ni ser club responsable de una carrera.
-- * Los clubes que ya estaban activos quedan exentos de la temporada inicial.
-- =====================================================================

-- ---------- Temporadas por liga ----------
create table if not exists public.league_seasons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  season      int  not null check (season between 2000 and 2100),
  is_current  boolean not null default false,
  club_fee    numeric(12,2) check (club_fee is null or club_fee >= 0),
  athlete_fee numeric(12,2) check (athlete_fee is null or athlete_fee >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, season)
);
create unique index if not exists uq_league_seasons_current on public.league_seasons(tenant_id) where is_current;

drop trigger if exists trg_league_seasons_updated_at on public.league_seasons;
create trigger trg_league_seasons_updated_at before update on public.league_seasons
  for each row execute function public.set_updated_at();

grant select on public.league_seasons to authenticated;
grant all on public.league_seasons to service_role;
alter table public.league_seasons enable row level security;

drop policy if exists "league_seasons_read" on public.league_seasons;
create policy "league_seasons_read" on public.league_seasons for select to authenticated
  using (public.has_role(auth.uid(), 'superadmin') or tenant_id = public.current_tenant_id());

-- Guarda una temporada de la liga del que llama (administrador) y, si se pide, la deja como actual.
-- Devuelve si la temporada actual cambió, para avisar a los clubes.
create or replace function public.save_league_season(
  p_season int, p_club_fee numeric, p_athlete_fee numeric, p_make_current boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_prev int;
  v_changed boolean := false;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') or v_tenant is null then
    raise exception 'Solo el administrador de la liga puede definir la temporada';
  end if;
  if p_season is null or p_season < 2000 or p_season > 2100 then
    raise exception 'Temporada inválida';
  end if;
  if p_club_fee is not null and p_club_fee <> 0 and p_club_fee < 1000 then
    raise exception 'La cuota del club debe ser de al menos $1.000 (mínimo de Bold)';
  end if;
  if p_athlete_fee is not null and p_athlete_fee <> 0 and p_athlete_fee < 1000 then
    raise exception 'La cuota del atleta debe ser de al menos $1.000 (mínimo de Bold)';
  end if;

  select season into v_prev from public.league_seasons where tenant_id = v_tenant and is_current;

  if p_make_current then
    update public.league_seasons set is_current = false where tenant_id = v_tenant and is_current and season <> p_season;
  end if;

  insert into public.league_seasons (tenant_id, season, is_current, club_fee, athlete_fee)
  values (v_tenant, p_season, coalesce(p_make_current, false), p_club_fee, p_athlete_fee)
  on conflict (tenant_id, season) do update
    set club_fee = excluded.club_fee,
        athlete_fee = excluded.athlete_fee,
        is_current = case when p_make_current then true else public.league_seasons.is_current end;

  v_changed := coalesce(p_make_current, false) and v_prev is distinct from p_season;
  return jsonb_build_object('tenant_id', v_tenant, 'season', p_season, 'previous_season', v_prev, 'current_changed', v_changed);
end; $$;

revoke execute on function public.save_league_season(int, numeric, numeric, boolean) from anon;
grant execute on function public.save_league_season(int, numeric, numeric, boolean) to authenticated, service_role;

-- ---------- Pago anual de cada club ----------
create table if not exists public.club_season_memberships (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
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
  unique (club_id, season)
);
create unique index if not exists uq_club_memberships_reference on public.club_season_memberships(reference) where reference is not null;
create index if not exists idx_club_memberships_tenant_season on public.club_season_memberships(tenant_id, season, status);

grant select on public.club_season_memberships to authenticated;
grant all on public.club_season_memberships to service_role;
alter table public.club_season_memberships enable row level security;

drop policy if exists "club_memberships_read" on public.club_season_memberships;
create policy "club_memberships_read" on public.club_season_memberships for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
    or exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid())
  );

-- ---------- Club vigente = aprobado + temporada actual pagada (o exonerada) ----------
create or replace function public.club_is_current(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.clubs c
    join public.league_seasons ls on ls.tenant_id = c.tenant_id and ls.is_current
    join public.club_season_memberships m on m.club_id = c.id and m.season = ls.season and m.status in ('paid', 'exempt')
    where c.id = p_club_id and c.approval_status = 'active' and c.status = 'active'
  );
$$;

-- Vista pública: solo clubes vigentes y solo datos públicos.
create or replace view public.clubs_current as
select c.id, c.tenant_id, c.name, c.city, c.department, c.logo_url
from public.clubs c
join public.league_seasons ls on ls.tenant_id = c.tenant_id and ls.is_current
join public.club_season_memberships m on m.club_id = c.id and m.season = ls.season and m.status in ('paid', 'exempt')
where c.approval_status = 'active' and c.status = 'active';

grant select on public.clubs_current to anon, authenticated;
grant all on public.clubs_current to service_role;

-- El club responsable de una carrera debe estar vigente y ser de la liga de la carrera
-- (ya no existen clubes independientes que cubran carreras de otras ligas).
create or replace function public.enforce_event_club_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and exists (
    select 1 from public.tenants t where t.id = new.tenant_id and t.allows_events = false
  ) then
    raise exception 'Este club independiente no puede crear carreras';
  end if;

  if new.club_id is not null and (
    tg_op = 'INSERT' or new.club_id is distinct from old.club_id or new.is_official is distinct from old.is_official
  ) then
    if new.is_official is distinct from true then
      raise exception 'Solo una carrera oficial puede tener club responsable';
    end if;
    if not exists (
      select 1 from public.clubs c where c.id = new.club_id and c.tenant_id = new.tenant_id
    ) or not public.club_is_current(new.club_id) then
      raise exception 'El club responsable debe ser de la liga de la carrera y tener su cuota de la temporada al día';
    end if;
  end if;
  return new;
end; $$;

-- ---------- Datos iniciales ----------
-- Cada liga arranca con la temporada del año en curso y la cuota de club de $200.000 (la liga la puede cambiar).
insert into public.league_seasons (tenant_id, season, is_current, club_fee)
select t.id, extract(year from now())::int, true, 200000
from public.tenants t
where not exists (select 1 from public.league_seasons ls where ls.tenant_id = t.id);

-- Los clubes que ya estaban aprobados quedan exentos de la temporada inicial (no desaparecen).
insert into public.club_season_memberships (club_id, tenant_id, season, amount, status, exempt_reason, paid_at)
select c.id, c.tenant_id, ls.season, 0, 'exempt', 'Club existente: temporada inicial sin cobro', now()
from public.clubs c
join public.league_seasons ls on ls.tenant_id = c.tenant_id and ls.is_current
where c.approval_status = 'active' and c.tenant_id is not null
on conflict (club_id, season) do nothing;
