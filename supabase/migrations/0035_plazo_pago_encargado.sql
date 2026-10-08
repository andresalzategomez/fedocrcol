-- =====================================================================
-- 0035 — Cualquier encargado de la carrera puede extender la fecha límite
-- de pago (admin de la liga, gestor de carreras, o la federación sobre sus
-- carreras), no solo el director. Reemplaza la función de la 0033: se quita
-- la restricción de rol; siguen el tope de la fecha de la carrera y el
-- registro de quién y cuándo extendió. Quién puede editar la carrera ya lo
-- decide RLS. Idempotente.
-- =====================================================================

create or replace function public.enforce_payment_deadline_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role (API del servidor) o conexión administrativa: sin restricción.
  if auth.uid() is null then
    return new;
  end if;

  if new.payment_deadline is not null and new.payment_deadline > new.date then
    raise exception 'La fecha límite de pago no puede ser posterior a la fecha de la carrera';
  end if;

  -- Extender = posponer o quitar un plazo ya fijado: queda registrado quién y cuándo.
  if tg_op = 'UPDATE' and old.payment_deadline is not null
     and (new.payment_deadline is null or new.payment_deadline > old.payment_deadline) then
    new.payment_deadline_extended_at := now();
    new.payment_deadline_extended_by := auth.uid();
  end if;

  return new;
end; $$;
