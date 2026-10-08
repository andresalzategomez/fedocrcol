-- =====================================================================
-- 0036 — Referencia única por link de pago de una inscripción.
--
-- Bold no acepta reutilizar una referencia ("has been used before"), así
-- que cada link nuevo de una misma inscripción (porque venció a los 7 días
-- o cambió el monto) lleva la suya: <código de inscripción>-<sufijo>. El
-- webhook la usa para volver a encontrar la inscripción. Idempotente.
-- =====================================================================

alter table public.registration_payment_links add column if not exists reference text;
create unique index if not exists idx_registration_payment_links_reference on public.registration_payment_links(reference);
