-- =====================================================================
-- 0040 — Cierre de seguridad: roles en las reglas de la base de datos.
-- Idempotente.
--
-- Auditoría (probada con una sesión real de atleta): varias políticas solo
-- comparaban la liga ("tenant_id = current_tenant_id()") sin mirar el rol,
-- y la de perfiles no impedía cambiar el propio rol. Hallazgos:
--   * profiles: un usuario podía ponerse role = 'superadmin' y cambiarse de liga.
--   * results / timing_reads: cualquier usuario de la liga (un atleta) podía
--     insertar, alterar y borrar resultados y lecturas de tiempo.
--   * clubs: un atleta podía aprobar, crear y borrar clubes de su liga, y el
--     dueño de un club podía aprobarse solo. Además el correo, teléfono y NIT
--     de los clubes se leían sin sesión.
--   * affiliations: un atleta podía pedir afiliación en cualquier liga.
--   * tenant_judges / payments: lectura más amplia de lo necesario.
--
-- Roles que escriben tiempos tras esta migración:
--   - administrador de la liga dueña de la carrera y superadmin: todo
--     (incluye correcciones y borrado);
--   - juez asignado a un checkpoint de la carrera: solo registra lecturas de
--     SU checkpoint y resultados, y solo mientras la carrera está en curso.
-- Atletas, clubes y gestores quedan en solo lectura.
-- =====================================================================

-- ---------- Funciones de apoyo (security definer: no dependen del RLS del que llama) ----------
create or replace function public.is_event_admin(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (
        public.has_role(auth.uid(), 'superadmin')
        or (public.has_role(auth.uid(), 'admin') and e.tenant_id = public.current_tenant_id())
      )
  );
$$;

create or replace function public.is_checkpoint_judge(p_checkpoint_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.checkpoint_judges cj
    where cj.checkpoint_id = p_checkpoint_id and cj.judge_id = auth.uid()
  );
$$;

create or replace function public.is_event_judge(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.checkpoint_judges cj
    join public.checkpoints c on c.id = cj.checkpoint_id
    where c.event_id = p_event_id and cj.judge_id = auth.uid()
  );
$$;

create or replace function public.event_in_progress(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events e where e.id = p_event_id and e.status = 'in_progress');
$$;

-- El tenant_id de la fila debe ser el de la liga dueña de la carrera (no se confía en lo que mande el cliente).
create or replace function public.event_tenant_is(p_event_id uuid, p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events e where e.id = p_event_id and e.tenant_id = p_tenant_id);
$$;

-- La inscripción y el checkpoint pertenecen a la carrera indicada.
create or replace function public.reading_matches_event(p_event_id uuid, p_registration_id uuid, p_checkpoint_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (p_registration_id is null or exists (select 1 from public.registrations r where r.id = p_registration_id and r.event_id = p_event_id))
    and (p_checkpoint_id is null or exists (select 1 from public.checkpoints c where c.id = p_checkpoint_id and c.event_id = p_event_id));
$$;

-- ---------- 1) profiles: nadie cambia su propio rol ni su liga ----------
create or replace function public.enforce_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sin usuario autenticado (service_role desde el servidor, SQL Editor): lo hace el sistema.
  if auth.uid() is null then
    return new;
  end if;
  if public.has_role(auth.uid(), 'superadmin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role is distinct from 'athlete' then
      raise exception 'Solo la federación puede asignar roles';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role or new.tenant_id is distinct from old.tenant_id then
    raise exception 'No puedes cambiar tu rol ni tu liga; pídelo a la federación o a tu liga';
  end if;
  return new;
end; $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before insert or update on public.profiles
  for each row execute function public.enforce_profile_update();

-- ---------- 2) clubs ----------
-- Solo el admin de la liga y la federación gestionan los clubes (antes: cualquier usuario de la liga).
drop policy if exists "clubs_tenant_manage" on public.clubs;
create policy "clubs_tenant_manage" on public.clubs for all to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  )
  with check (
    public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and tenant_id = public.current_tenant_id())
  );

-- El dueño del club solo edita los datos del club y puede volver a solicitar uno rechazado:
-- no puede aprobarse, cambiar de liga ni de dueño.
create or replace function public.enforce_club_owner_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  editable text[] := array['name', 'nit', 'city', 'department', 'logo_url', 'contact_email', 'contact_phone', 'updated_at', 'approval_status'];
begin
  if auth.uid() is null then return new; end if;
  if public.has_role(auth.uid(), 'superadmin') then return new; end if;
  if public.has_role(auth.uid(), 'admin') and old.tenant_id = public.current_tenant_id() then return new; end if;

  if old.owner_id is distinct from auth.uid() then
    raise exception 'No tienes permiso para modificar este club';
  end if;
  if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'Solo puedes editar los datos de tu club';
  end if;
  if new.approval_status is distinct from old.approval_status
     and not (old.approval_status::text = 'rejected' and new.approval_status::text = 'pending') then
    raise exception 'La aprobación del club la decide tu liga';
  end if;
  return new;
end; $$;

drop trigger if exists trg_clubs_owner_guard on public.clubs;
create trigger trg_clubs_owner_guard before update on public.clubs
  for each row execute function public.enforce_club_owner_update();

-- Sin sesión solo se leen los datos públicos del club (no correo, teléfono ni NIT).
revoke select on public.clubs from anon;
grant select (id, tenant_id, name, city, department, logo_url, status, approval_status, created_at) on public.clubs to anon;

-- ---------- 3) results ----------
drop policy if exists "results_tenant_manage" on public.results;
drop policy if exists "results_admin_manage" on public.results;
drop policy if exists "results_judge_insert" on public.results;
drop policy if exists "results_judge_update" on public.results;

create policy "results_admin_manage" on public.results for all to authenticated
  using (public.is_event_admin(event_id))
  with check (public.is_event_admin(event_id) and public.event_tenant_is(event_id, tenant_id));

create policy "results_judge_insert" on public.results for insert to authenticated
  with check (
    public.is_event_judge(event_id) and public.event_in_progress(event_id)
    and public.event_tenant_is(event_id, tenant_id)
    and public.reading_matches_event(event_id, registration_id, null)
  );

create policy "results_judge_update" on public.results for update to authenticated
  using (public.is_event_judge(event_id) and public.event_in_progress(event_id))
  with check (
    public.is_event_judge(event_id) and public.event_in_progress(event_id)
    and public.event_tenant_is(event_id, tenant_id)
  );

-- ---------- 4) timing_reads ----------
drop policy if exists "timing_reads_read_scoped" on public.timing_reads;
create policy "timing_reads_read_scoped" on public.timing_reads for select to authenticated
  using (
    public.is_event_admin(event_id)
    or public.is_checkpoint_judge(checkpoint_id)
    or public.is_event_manager(event_id)
  );

drop policy if exists "timing_reads_insert_scoped" on public.timing_reads;
create policy "timing_reads_insert_scoped" on public.timing_reads for insert to authenticated
  with check (
    public.event_tenant_is(event_id, tenant_id)
    and public.reading_matches_event(event_id, registration_id, checkpoint_id)
    and (
      public.is_event_admin(event_id)
      or (public.is_checkpoint_judge(checkpoint_id) and public.event_in_progress(event_id))
    )
  );

-- ---------- 5) affiliations: el atleta solo pide afiliación en su propia liga ----------
drop policy if exists "affiliations_insert_self" on public.affiliations;
create policy "affiliations_insert_self" on public.affiliations for insert to authenticated
  with check (athlete_id = auth.uid() and status = 'pending' and tenant_id = public.current_tenant_id());

-- ---------- 6) tenant_judges: la lista de jueces la ven la liga (admin/gestor), la federación y el propio juez ----------
drop policy if exists "tenant_judges_read_scoped" on public.tenant_judges;
create policy "tenant_judges_read_scoped" on public.tenant_judges for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or user_id = auth.uid()
    or (
      tenant_id = public.current_tenant_id()
      and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'race_manager'))
    )
  );

-- ---------- 7) payments: explícito (antes dependía por accidente del RLS de registrations) ----------
create or replace function public.can_read_payment(p_registration_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.has_role(auth.uid(), 'superadmin')
    or exists (
      select 1 from public.registrations r
      where r.id = p_registration_id
        and (
          r.athlete_id = auth.uid()
          or (public.has_role(auth.uid(), 'admin') and r.tenant_id = public.current_tenant_id())
        )
    );
$$;

drop policy if exists "payments_read_scoped" on public.payments;
create policy "payments_read_scoped" on public.payments for select to authenticated
  using (public.can_read_payment(registration_id));
