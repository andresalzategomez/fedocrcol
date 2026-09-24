-- =====================================================================
-- 0022 — Datos de seguridad y camiseta del atleta
-- Idempotente.
--
-- El formulario de inscripción a carrera ahora pide también: redes
-- sociales (opcional), EPS, RH, contacto de emergencia (nombre y
-- celular), y nombre/talla para camiseta. Todos se guardan en profiles
-- para poder precargarlos en la siguiente inscripción, y se copian a
-- registrations como snapshot histórico de esa inscripción puntual
-- (mismo patrón que athlete_document/athlete_gender/etc).
-- =====================================================================

alter table public.profiles add column if not exists social_media text;
alter table public.profiles add column if not exists eps text;
alter table public.profiles add column if not exists blood_type text;
alter table public.profiles add column if not exists emergency_contact_name text;
alter table public.profiles add column if not exists emergency_contact_phone text;
alter table public.profiles add column if not exists shirt_name text;
alter table public.profiles add column if not exists shirt_size text;

alter table public.profiles drop constraint if exists profiles_blood_type_check;
alter table public.profiles add constraint profiles_blood_type_check
  check (blood_type is null or blood_type in ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'));

alter table public.profiles drop constraint if exists profiles_shirt_size_check;
alter table public.profiles add constraint profiles_shirt_size_check
  check (shirt_size is null or shirt_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL'));

alter table public.registrations add column if not exists athlete_social_media text;
alter table public.registrations add column if not exists athlete_eps text;
alter table public.registrations add column if not exists athlete_blood_type text;
alter table public.registrations add column if not exists athlete_emergency_contact_name text;
alter table public.registrations add column if not exists athlete_emergency_contact_phone text;
alter table public.registrations add column if not exists athlete_shirt_name text;
alter table public.registrations add column if not exists athlete_shirt_size text;
