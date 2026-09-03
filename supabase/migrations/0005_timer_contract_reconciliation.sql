-- =====================================================================
-- 0005_timer_contract_reconciliation
-- Ajusta el esquema para calzar el contrato del FedOCR Timer.
-- Idempotente.
-- =====================================================================

do $$ begin
  create type public.wave_status as enum ('pending','started','completed');
exception when duplicate_object then null; end $$;

alter table public.waves add column if not exists wave_number int;
alter table public.waves add column if not exists status public.wave_status not null default 'pending';

-- Penalización (segundos) que el Timer ya sumó al net_time.
alter table public.results add column if not exists penalty_seconds int not null default 0;

-- Id del registro en el cliente (Timer) para idempotencia en el push.
alter table public.timing_reads add column if not exists client_record_id uuid;
create unique index if not exists uq_timing_reads_client
  on public.timing_reads(client_record_id) where client_record_id is not null;
