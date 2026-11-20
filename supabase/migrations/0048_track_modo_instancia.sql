-- =====================================================================
-- 0048 — Track: modo de cada instancia (por tiempo o muerte súbita).
-- Idempotente.
--
--  * 'time': clasifican los N mejores tiempos de la instancia (valor por defecto).
--  * 'duel': muerte súbita; pasa el ganador de cada oleada (menor tiempo), aunque un perdedor
--            tenga mejor tiempo que el ganador de otra oleada. Solo en instancias de 1 salida.
-- El servidor lo entrega al motor de reglas (engine-v0.3.0) y a Timer_track en el paquete.
-- =====================================================================

alter table public.track_stages add column if not exists mode text not null default 'time';

alter table public.track_stages drop constraint if exists track_stages_mode_check;
alter table public.track_stages add constraint track_stages_mode_check check (mode in ('time', 'duel'));
