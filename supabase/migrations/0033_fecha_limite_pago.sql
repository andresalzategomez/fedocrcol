-- =====================================================================
-- 0033 — Fecha límite de pago de una carrera y permiso de pago
-- extemporáneo dado por el director de la liga.
--
-- * events.payment_deadline: último día (inclusive, hora de Colombia) para
--   pagar la inscripción. null = sin fecha límite.
-- * registrations.late_payment_granted_at / _by: el director de la liga
--   (admin) o la federación (superadmin) permite pagar a ESA inscripción
--   aunque el plazo haya vencido.
--
-- Un trigger impide que nadie más (ni el propio atleta, ni un anónimo que
-- inserta su inscripción) se dé el permiso: solo admin de la liga o
-- superadmin pueden otorgarlo o quitarlo, y quien lo otorga queda
-- registrado. Idempotente.
-- =====================================================================

alter table public.events add column if not exists payment_deadline date;

alter table public.registrations add column if not exists late_payment_granted_at timestamptz;
alter table public.registrations add column if not exists late_payment_granted_by uuid references public.profiles(id) on delete set null;

create or replace function public.enforce_late_payment_grant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  can_grant boolean;
begin
  -- service_role (API del servidor) o conexión administrativa directa: sin restricción.
  -- OJO: un anónimo (inscripción pública) tampoco tiene auth.uid(), pero su rol es 'anon'.
  if auth.uid() is null and jwt_role <> 'anon' then
    return new;
  end if;

  can_grant := public.has_role(auth.uid(), 'superadmin')
    or (public.has_role(auth.uid(), 'admin') and new.tenant_id = public.current_tenant_id());

  if tg_op = 'INSERT' then
    if (new.late_payment_granted_at is not null or new.late_payment_granted_by is not null) and not can_grant then
      raise exception 'Solo el director de la liga puede dar permiso de pago extemporáneo';
    end if;
    return new;
  end if;

  if new.late_payment_granted_at is distinct from old.late_payment_granted_at
     or new.late_payment_granted_by is distinct from old.late_payment_granted_by then
    if not can_grant then
      raise exception 'Solo el director de la liga puede dar permiso de pago extemporáneo';
    end if;
    if new.late_payment_granted_at is null then
      new.late_payment_granted_by := null;
    else
      new.late_payment_granted_at := coalesce(new.late_payment_granted_at, now());
      new.late_payment_granted_by := auth.uid();
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_registrations_late_payment on public.registrations;
create trigger trg_registrations_late_payment before insert or update on public.registrations
  for each row execute function public.enforce_late_payment_grant();
