-- =====================================================================
-- 0016 — Marca cuándo un juez terminó de crear su contraseña
-- Idempotente.
--
-- El juez acepta la invitación y define su contraseña en /set-password.
-- En ese momento (ya autenticado con la sesión que le dio el link de
-- invitación) actualiza su PROPIO profile — permitido por la política
-- existente `profiles_update_own` (id = auth.uid()), sin necesidad de
-- una política ni un endpoint nuevos.
-- =====================================================================

alter table public.profiles add column if not exists password_set_at timestamptz;
