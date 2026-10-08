-- =====================================================================
-- 0033 — Fecha límite de pago de una carrera, que solo el director de la
-- liga puede extender.
--
-- * events.payment_deadline: último día (inclusive, hora de Colombia) para
--   pagar la inscripción. null = sin fecha límite. Aplica a toda la carrera.
-- * Extender el plazo = posponerlo o quitarlo cuando ya estaba fijado. Eso
--   lo hace el director de la liga (admin) o la federación (superadmin); un
--   gestor de carreras puede fijarlo si no existe, o acortarlo, pero no
--   extenderlo. Quien extiende y cuándo quedan en payment_deadline_extended_*.
-- * El plazo no puede ser posterior a la fecha de la carrera.
-- Idempotente.
-- =====================================================================

alter table public.events add column if not exists payment_deadline date;
alter table public.events add column if not exists payment_deadline_extended_at timestamptz;
alter table public.events add column if not exists payment_deadline_extended_by uuid references public.profiles(id) on delete set null;

create or replace function public.enforce_payment_deadline_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  can_extend boolean;
begin
  -- service_role (API del servidor) o conexión administrativa: sin restricción.
  -- (events no admite escritura anónima, así que auth.uid() null no es un anónimo.)
  if auth.uid() is null then
    return new;
  end if;

  if new.payment_deadline is not null and new.payment_deadline > new.date then
    raise exception 'La fecha límite de pago no puede ser posterior a la fecha de la carrera';
  end if;

  if tg_op = 'UPDATE' and old.payment_deadline is not null
     and (new.payment_deadline is null or new.payment_deadline > old.payment_deadline) then
    can_extend := public.has_role(auth.uid(), 'superadmin')
      or (public.has_role(auth.uid(), 'admin') and new.tenant_id = public.current_tenant_id());
    if not can_extend then
      raise exception 'Solo el director de la liga puede extender o quitar la fecha límite de pago';
    end if;
    new.payment_deadline_extended_at := now();
    new.payment_deadline_extended_by := auth.uid();
  end if;

  return new;
end; $$;

drop trigger if exists trg_events_payment_deadline on public.events;
create trigger trg_events_payment_deadline before insert or update on public.events
  for each row execute function public.enforce_payment_deadline_rules();
