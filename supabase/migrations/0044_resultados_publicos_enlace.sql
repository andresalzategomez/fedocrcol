-- =====================================================================
-- 0044 — Resultados públicos por enlace único y cierre de la lectura abierta.
-- Idempotente.
--
-- Hasta ahora la privacidad de una carrera solo se respetaba en la pantalla: la tabla
-- results se podía leer sin sesión aunque la carrera fuera privada, y la vista
-- registrations_public listaba nombre, dorsal y categoría de los inscritos. Ahora:
--
-- * results ya no es de lectura pública: la leen el administrador de la liga y la
--   federación (política results_admin_manage), los jueces asignados, los gestores
--   asignados y el propio atleta. El público ve los resultados de una carrera pública
--   SOLO por el enlace único (/resultados/<código>), que sirve el servidor con los
--   datos mínimos y solo hasta el final del día de la carrera.
-- * event_results_links: código secreto por carrera; solo el servidor lo escribe y lo
--   leen el administrador de la liga y la federación.
-- * registrations_public (con nombres) se cierra; lo público son solo CONTEOS por
--   carrera y categoría (registration_counts_public) para mostrar los cupos.
-- =====================================================================

create table if not exists public.event_results_links (
  event_id   uuid primary key references public.events(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

grant select on public.event_results_links to authenticated;
grant all on public.event_results_links to service_role;
alter table public.event_results_links enable row level security;

drop policy if exists "event_results_links_read" on public.event_results_links;
create policy "event_results_links_read" on public.event_results_links for select to authenticated
  using (public.is_event_admin(event_id));

-- ---------- results: fuera la lectura abierta ----------
drop policy if exists "results_public_read" on public.results;
revoke select on public.results from anon;

drop policy if exists "results_read_scoped" on public.results;
create policy "results_read_scoped" on public.results for select to authenticated
  using (
    public.is_event_judge(event_id)
    or public.is_event_manager(event_id)
    or athlete_id = auth.uid()
  );

-- ---------- inscritos: solo conteos públicos ----------
create or replace view public.registration_counts_public as
select r.event_id, r.category_id, count(*)::int as registered
from public.registrations r
where r.status <> 'cancelled'
group by r.event_id, r.category_id;

grant select on public.registration_counts_public to anon, authenticated;
grant all on public.registration_counts_public to service_role;

revoke select on public.registrations_public from anon, authenticated;
