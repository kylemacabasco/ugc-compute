-- ============================================================================
-- 005_withdrawal_core.sql
-- Core withdrawal system: tables, indexes, RLS, guards
-- Run this FIRST
-- ============================================================================

create extension if not exists "pgcrypto";

-- Reuse helper functions from deposits
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin raise exception 'delete is forbidden to preserve the ledger'; end $$;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Withdrawal Requests (user-initiated or system-generated payouts)
create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  submission_id bigint references public.submissions(id) on delete cascade,
  from_address text not null,
  to_address text not null,
  mint text,  -- null = SOL
  amount_base_units numeric not null,
  decimals int not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','canceled','fulfilled')),
  reject_reason text,
  fulfilled_withdrawal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint wreq_addr_chk check (length(trim(from_address)) > 0 and length(trim(to_address)) > 0)
);

-- Withdrawals (actual on-chain transactions)
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  submission_id bigint references public.submissions(id) on delete cascade,
  from_address text not null,
  to_address text not null,
  tx_sig text,
  slot bigint,
  block_time timestamptz,
  mint text,  -- null = SOL
  amount_base_units numeric not null,
  decimals int not null,
  ui_amount numeric not null,
  status text not null default 'approved' check (status in ('approved','broadcast','confirmed','finalized','failed')),
  request_id uuid,
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  asset_key text generated always as (coalesce(mint, 'SOL')) stored,
  
  constraint wdrl_addr_chk check (length(trim(from_address)) > 0 and length(trim(to_address)) > 0)
);

-- Withdrawal Events (audit log)
create table if not exists public.withdrawal_events (
  id bigserial primary key,
  request_id uuid references public.withdrawal_requests(id) on delete cascade,
  withdrawal_id uuid references public.withdrawals(id) on delete cascade,
  event_type text not null check (event_type in (
    'request_created','request_canceled','request_approved','request_rejected',
    'withdrawal_created','withdrawal_broadcast','withdrawal_confirmed',
    'withdrawal_finalized','withdrawal_failed','manual_note'
  )),
  actor text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Withdrawal Requests
create index if not exists idx_wreq_user_id on public.withdrawal_requests(user_id);
create index if not exists idx_wreq_contract_id on public.withdrawal_requests(contract_id);
create index if not exists idx_wreq_submission_id on public.withdrawal_requests(submission_id);
create index if not exists idx_wreq_status on public.withdrawal_requests(status);

-- Withdrawals
create unique index if not exists ux_withdrawals_tx_sig on public.withdrawals(tx_sig) where tx_sig is not null;
create unique index if not exists ux_withdrawals_request_id on public.withdrawals(request_id) where request_id is not null;
create index if not exists idx_withdrawals_user_id on public.withdrawals(user_id);
create index if not exists idx_withdrawals_contract_id on public.withdrawals(contract_id);
create index if not exists idx_withdrawals_submission_id on public.withdrawals(submission_id);
create index if not exists idx_withdrawals_status on public.withdrawals(status);

-- Withdrawal Events
create index if not exists idx_we_req on public.withdrawal_events(request_id, created_at desc);
create index if not exists idx_we_wd on public.withdrawal_events(withdrawal_id, created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.withdrawal_requests enable row level security;
alter table public.withdrawals enable row level security;

-- Withdrawal Requests: Users can read, create, and cancel their own
drop policy if exists "wreq: read own" on public.withdrawal_requests;
create policy "wreq: read own"
on public.withdrawal_requests for select using (user_id = auth.uid());

drop policy if exists "wreq: create own" on public.withdrawal_requests;
create policy "wreq: create own"
on public.withdrawal_requests for insert
with check (user_id = auth.uid() and status = 'requested');

drop policy if exists "wreq: cancel own requested" on public.withdrawal_requests;
create policy "wreq: cancel own requested"
on public.withdrawal_requests for update
using (user_id = auth.uid() and status = 'requested')
with check (user_id = auth.uid() and status = 'canceled');

-- Withdrawals: Users can only read their own
drop policy if exists "wdrl: read own" on public.withdrawals;
create policy "wdrl: read own"
on public.withdrawals for select using (user_id = auth.uid());

-- ============================================================================
-- TRIGGERS: Touch & Delete Prevention
-- ============================================================================

drop trigger if exists trg_wreq_touch on public.withdrawal_requests;
create trigger trg_wreq_touch before update on public.withdrawal_requests
for each row execute function public.touch_updated_at();

drop trigger if exists trg_wdrl_touch on public.withdrawals;
create trigger trg_wdrl_touch before update on public.withdrawals
for each row execute function public.touch_updated_at();

drop trigger if exists trg_wdrl_no_delete on public.withdrawals;
create trigger trg_wdrl_no_delete before delete on public.withdrawals
for each row execute function public.forbid_delete();

-- ============================================================================
-- TRIGGERS: Validation Guards
-- ============================================================================

-- Withdrawal Requests Guard (enforce permissions & immutability)
create or replace function public.withdrawal_requests_guard()
returns trigger language plpgsql as $$
declare 
  claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
  is_sr boolean := false;
begin
  if claims is not null then is_sr := ((claims::jsonb ->> 'role') = 'service_role'); end if;

  if tg_op = 'INSERT' then
    if not is_sr and new.status <> 'requested' then
      raise exception 'only status=requested is allowed on creation';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if is_sr then
      -- Service role can update, but immutable fields cannot change
      if new.user_id <> old.user_id
         or coalesce(new.contract_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(old.contract_id, '00000000-0000-0000-0000-000000000000'::uuid)
         or new.from_address <> old.from_address
         or new.to_address <> old.to_address
         or coalesce(new.mint,'') <> coalesce(old.mint,'')
         or new.amount_base_units <> old.amount_base_units
         or new.decimals <> old.decimals then
        raise exception 'immutable fields cannot be changed';
      end if;
      return new;
    else
      -- End users can only cancel their own requested withdrawals
      if old.status = 'requested' and new.status = 'canceled' then
        if (row_to_json(new)::jsonb - 'status' - 'updated_at') <> (row_to_json(old)::jsonb - 'status' - 'updated_at') then
          raise exception 'only status may be changed by end users';
        end if;
        return new;
      end if;
      raise exception 'update not permitted';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_wreq_guard on public.withdrawal_requests;
create trigger trg_wreq_guard
before insert or update on public.withdrawal_requests
for each row execute function public.withdrawal_requests_guard();

-- Withdrawals Guard (service role only, enforce status transitions)
create or replace function public.withdrawals_guard()
returns trigger language plpgsql as $$
declare 
  claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
  is_sr boolean := false;
  old_status text := coalesce(old.status, 'approved');
  new_status text := new.status;
begin
  if claims is not null then is_sr := ((claims::jsonb ->> 'role') = 'service_role'); end if;
  if not is_sr then raise exception 'writes to withdrawals are not permitted'; end if;

  if tg_op = 'INSERT' then return new; end if;

  -- Immutable fields check
  if (row_to_json(new)::jsonb
        - 'status' - 'tx_sig' - 'slot' - 'block_time' - 'fail_reason' - 'request_id' - 'updated_at')
     <>
     (row_to_json(old)::jsonb
        - 'status' - 'tx_sig' - 'slot' - 'block_time' - 'fail_reason' - 'request_id' - 'updated_at') then
    raise exception 'immutable fields cannot be changed';
  end if;

  -- Status transition validation
  if old_status = new_status then return new; end if;
  if old_status = 'approved'  and new_status in ('broadcast','failed') then return new; end if;
  if old_status = 'broadcast' and new_status in ('confirmed','failed') then return new; end if;
  if old_status = 'confirmed' and new_status in ('finalized','failed') then return new; end if;
  if old_status in ('failed','finalized') then raise exception 'cannot transition from %', old_status; end if;
  raise exception 'invalid status transition: % -> %', old_status, new_status;
end $$;

drop trigger if exists trg_wdrl_guard on public.withdrawals;
create trigger trg_wdrl_guard
before insert or update on public.withdrawals
for each row execute function public.withdrawals_guard();

-- ============================================================================
-- TRIGGERS: Event Logging
-- ============================================================================

-- Event logging helper
create or replace function public._log_withdrawal_event(p_req uuid, p_wd uuid, p_type text, p_actor text, p_details jsonb)
returns void language sql as $$
  insert into public.withdrawal_events(request_id, withdrawal_id, event_type, actor, details)
  values (p_req, p_wd, p_type, p_actor, coalesce(p_details, '{}'::jsonb));
$$;

-- Auto-log important events
create or replace function public.withdrawal_events_hooks()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'withdrawal_requests' then
    if tg_op = 'INSERT' then
      perform public._log_withdrawal_event(new.id, null, 'request_created', 'user_or_service', '{}'::jsonb);
    elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'canceled' then
      perform public._log_withdrawal_event(new.id, null, 'request_canceled', 'user', '{}'::jsonb);
    elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'rejected' then
      perform public._log_withdrawal_event(new.id, null, 'request_rejected', 'service_role', jsonb_build_object('reason', new.reject_reason));
    end if;
  elsif tg_table_name = 'withdrawals' then
    if tg_op = 'UPDATE' then
      if old.status <> new.status then
        if new.status = 'broadcast' then
          perform public._log_withdrawal_event(new.request_id, new.id, 'withdrawal_broadcast', 'service_role', jsonb_build_object('tx_sig', new.tx_sig));
        elsif new.status = 'confirmed' then
          perform public._log_withdrawal_event(new.request_id, new.id, 'withdrawal_confirmed', 'service_role', '{}'::jsonb);
        elsif new.status = 'failed' then
          perform public._log_withdrawal_event(new.request_id, new.id, 'withdrawal_failed', 'service_role', jsonb_build_object('reason', new.fail_reason));
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_wreq_events on public.withdrawal_requests;
create trigger trg_wreq_events
after insert or update on public.withdrawal_requests
for each row execute function public.withdrawal_events_hooks();

drop trigger if exists trg_wdrl_events on public.withdrawals;
create trigger trg_wdrl_events
after update on public.withdrawals
for each row execute function public.withdrawal_events_hooks();

-- ============================================================================
-- TRIGGERS: Finalization Hook
-- ============================================================================

-- When withdrawal finalized, mark request as fulfilled
create or replace function public.withdrawals_finalize_hook()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status = 'finalized' and new.request_id is not null then
    update public.withdrawal_requests
      set status = 'fulfilled',
          fulfilled_withdrawal_id = new.id,
          updated_at = now()
      where id = new.request_id
        and (new.contract_id is null or contract_id is null or contract_id = new.contract_id)
        and status in ('approved','requested');
    perform public._log_withdrawal_event(new.request_id, new.id, 'withdrawal_finalized', 'service_role', jsonb_build_object('tx_sig', new.tx_sig));
  end if;
  return new;
end $$;

drop trigger if exists trg_wdrl_finalize_hook on public.withdrawals;
create trigger trg_wdrl_finalize_hook
after update on public.withdrawals
for each row execute function public.withdrawals_finalize_hook();