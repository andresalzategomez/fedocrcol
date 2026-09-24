-- =====================================================================
-- 0027 — profiles.email siempre se guarda al crear la cuenta.
-- Idempotente.
--
-- handle_new_user() nunca copiaba auth.users.email a profiles.email --
-- solo quedaba seteado en los flujos que lo hacían a mano (invitar
-- juez/gestor, registrar liga), no en el registro de atleta normal.
-- Cualquier búsqueda por correo (recuperar contraseña, invitar juez,
-- reenviar invitación) fallaba en silencio para esas cuentas porque
-- comparaba contra un profiles.email que nunca se llenó.
-- =====================================================================

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null and u.email is not null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_club_id uuid;
begin
  v_tenant_id := nullif(new.raw_user_meta_data->>'tenant_id','')::uuid;

  insert into public.profiles (id, full_name, tenant_id, role, email)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    v_tenant_id,
    'athlete',
    new.email
  )
  on conflict (id) do update set email = coalesce(public.profiles.email, excluded.email);

  v_club_id := nullif(new.raw_user_meta_data->>'club_id','')::uuid;
  if v_club_id is not null and v_tenant_id is not null then
    insert into public.affiliations (tenant_id, athlete_id, club_id, season, type, status)
    values (v_tenant_id, new.id, v_club_id, extract(year from now())::int, 'club', 'active')
    on conflict (athlete_id, season, tenant_id) do nothing;
  end if;

  return new;
end; $$;
