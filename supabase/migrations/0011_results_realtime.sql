-- =====================================================================
-- 0011 — Habilitar Realtime en `results`
-- La vista de "Resultados en vivo" del panel (Fase 4) se suscribe a
-- postgres_changes sobre public.results filtrando por event_id. Supabase
-- solo emite esos cambios si la tabla está en la publicación
-- `supabase_realtime`. Idempotente: no falla si ya estaba agregada.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'results'
  ) then
    alter publication supabase_realtime add table public.results;
  end if;
end $$;
