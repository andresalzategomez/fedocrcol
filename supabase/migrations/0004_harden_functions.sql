-- =====================================================================
-- 0004_harden_functions — refuerzo de seguridad de funciones (0002)
-- ---------------------------------------------------------------------
-- Resuelve avisos del linter de Supabase:
--  * search_path mutable en set_updated_at()
--  * funciones internas de consolidación expuestas por RPC a anon/authenticated
-- Idempotente.
-- =====================================================================

alter function public.set_updated_at() set search_path = public;

revoke execute on function public.recalculate_result(uuid) from anon, authenticated;
revoke execute on function public.recalculate_event_positions(uuid) from anon, authenticated;
revoke execute on function public.on_timing_read_insert() from anon, authenticated;

grant execute on function public.recalculate_result(uuid) to service_role;
grant execute on function public.recalculate_event_positions(uuid) to service_role;
