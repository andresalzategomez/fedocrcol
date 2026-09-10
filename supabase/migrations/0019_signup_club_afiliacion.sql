-- =====================================================================
-- 0019 — Fase C: afiliación a club opcional en el registro de atleta.
-- Idempotente.
--
-- El atleta NO requiere aprobación (a diferencia de liga/club): si elige
-- un club al registrarse, queda afiliado de una vez (affiliations en
-- status 'active', no 'pending'). Como el registro de atleta sigue
-- siendo un supabase.auth.signUp() normal desde el cliente (sin server
-- route), la única forma de crear esa fila con privilegios suficientes
-- es extender el trigger handle_new_user() -- corre security definer,
-- así que no depende de que RLS deje al atleta insertar directamente
-- (affiliations_insert_self de hecho exige status='pending', que no es
-- lo que queremos aquí).
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_club_id uuid;
begin
  v_tenant_id := nullif(new.raw_user_meta_data->>'tenant_id','')::uuid;

  insert into public.profiles (id, full_name, tenant_id, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    v_tenant_id,
    'athlete'
  )
  on conflict (id) do nothing;

  v_club_id := nullif(new.raw_user_meta_data->>'club_id','')::uuid;
  if v_club_id is not null and v_tenant_id is not null then
    insert into public.affiliations (tenant_id, athlete_id, club_id, season, type, status)
    values (v_tenant_id, new.id, v_club_id, extract(year from now())::int, 'club', 'active')
    on conflict (athlete_id, season, tenant_id) do nothing;
  end if;

  return new;
end; $$;
