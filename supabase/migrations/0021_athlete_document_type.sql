-- =====================================================================
-- 0021 — Tipo de documento del atleta
-- Idempotente.
--
-- El registro de atleta ahora pide tipo/número de documento, fecha de
-- nacimiento, celular y género de una vez (antes solo se pedían al
-- inscribirse a una carrera). document_id/birth_date/phone/gender ya
-- existían en profiles; solo faltaba el tipo de documento.
-- =====================================================================

alter table public.profiles add column if not exists document_type text;

alter table public.profiles drop constraint if exists profiles_document_type_check;
alter table public.profiles add constraint profiles_document_type_check
  check (document_type is null or document_type in ('CC', 'TI', 'CE', 'PA'));
