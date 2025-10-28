create extension if not exists "pgcrypto";

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin raise exception 'delete is forbidden to preserve the ledger'; end $$;

-- // tables
create table if not exists public.withdrawal_requests (id uuid primary key default gen_random_uuid());
create table if not exists public.withdrawals         (id uuid primary key default gen_random_uuid());
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

-- // columns: withdrawal_requests
alter table public.withdrawal_requests add column if not exists user_id uuid;
alter table public.withdrawal_requests add column if not exists contract_id uuid;
alter table public.withdrawal_requests add column if not exists from_address text;
alter table public.withdrawal_requests add column if not exists to_address text;
alter table public.withdrawal_requests add column if not exists mint text;
alter table public.withdrawal_requests add column if not exists amount_base_units numeric;
alter table public.withdrawal_requests add column if not exists decimals int;
alter table public.withdrawal_requests add column if not exists status text;
alter table public.withdrawal_requests add column if not exists reject_reason text;
alter table public.withdrawal_requests add column if not exists fulfilled_withdrawal_id uuid;
alter table public.withdrawal_requests add column if not exists created_at timestamptz not null default now();
alter table public.withdrawal_requests add column if not exists updated_at timestamptz not null default now();

-- // req FKs + checks
do $$ begin
  begin
    alter table public.withdrawal_requests
      add constraint wreq_user_fk foreign key (user_id) references public.users(id) on delete cascade;
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawal_requests
      add constraint wreq_contract_fk foreign key (contract_id) references public.contracts(id) on delete cascade;
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawal_requests
      add constraint wreq_addr_chk check (length(trim(from_address)) > 0 and length(trim(to_address)) > 0);
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawal_requests
      add constraint wreq_status_chk check (status in ('requested','approved','rejected','canceled','fulfilled'));
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_wreq_user_id     on public.withdrawal_requests(user_id);
create index if not exists idx_wreq_contract_id on public.withdrawal_requests(contract_id);
create index if not exists idx_wreq_status      on public.withdrawal_requests(status);
alter table public.withdrawal_requests enable row level security;

-- // RLS: withdrawal_requests
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

-- // touch + guard (requests)
drop trigger if exists trg_wreq_touch on public.withdrawal_requests;
create trigger trg_wreq_touch before update on public.withdrawal_requests
for each row execute function public.touch_updated_at();

create or replace function public.withdrawal_requests_guard()
returns trigger language plpgsql as $$
declare claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
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
      if new.user_id <> old.user_id
         or new.contract_id <> old.contract_id
         or new.from_address <> old.from_address
         or new.to_address <> old.to_address
         or coalesce(new.mint,'') <> coalesce(old.mint,'')
         or new.amount_base_units <> old.amount_base_units
         or new.decimals <> old.decimals then
        raise exception 'immutable fields cannot be changed';
      end if;
      return new;
    else
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

-- // columns: withdrawals
alter table public.withdrawals add column if not exists user_id uuid;
alter table public.withdrawals add column if not exists contract_id uuid;
alter table public.withdrawals add column if not exists from_address text;
alter table public.withdrawals add column if not exists to_address text;
alter table public.withdrawals add column if not exists tx_sig text;
alter table public.withdrawals add column if not exists slot bigint;
alter table public.withdrawals add column if not exists block_time timestamptz;
alter table public.withdrawals add column if not exists mint text;
alter table public.withdrawals add column if not exists amount_base_units numeric;
alter table public.withdrawals add column if not exists decimals int;
alter table public.withdrawals add column if not exists ui_amount numeric;
alter table public.withdrawals add column if not exists status text;
alter table public.withdrawals add column if not exists request_id uuid;
alter table public.withdrawals add column if not exists fail_reason text;
alter table public.withdrawals add column if not exists created_at timestamptz not null default now();
alter table public.withdrawals add column if not exists updated_at timestamptz not null default now();
alter table public.withdrawals add column if not exists asset_key text generated always as (coalesce(mint, 'SOL')) stored;

-- // wdrl FKs + checks
do $$ begin
  begin
    alter table public.withdrawals
      add constraint wdrl_user_fk foreign key (user_id) references public.users(id) on delete cascade;
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawals
      add constraint wdrl_contract_fk foreign key (contract_id) references public.contracts(id) on delete cascade;
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawals
      add constraint wdrl_addr_chk check (length(trim(from_address)) > 0 and length(trim(to_address)) > 0);
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawals
      add constraint wdrl_status_chk check (status in ('approved','broadcast','confirmed','finalized','failed'));
  exception when duplicate_object then null; end;
end $$;

create unique index if not exists ux_withdrawals_tx_sig     on public.withdrawals(tx_sig);
create unique index if not exists ux_withdrawals_request_id on public.withdrawals(request_id) where request_id is not null;
create index if not exists idx_withdrawals_user_id     on public.withdrawals(user_id);
create index if not exists idx_withdrawals_contract_id on public.withdrawals(contract_id);
create index if not exists idx_withdrawals_status      on public.withdrawals(status);
alter table public.withdrawals enable row level security;

-- // RLS: withdrawals (read own)
drop policy if exists "wdrl: read own" on public.withdrawals;
create policy "wdrl: read own"
on public.withdrawals for select using (user_id = auth.uid());

-- // touch + no-delete
drop trigger if exists trg_wdrl_touch on public.withdrawals;
create trigger trg_wdrl_touch before update on public.withdrawals
for each row execute function public.touch_updated_at();

drop trigger if exists trg_wdrl_no_delete on public.withdrawals;
create trigger trg_wdrl_no_delete before delete on public.withdrawals
for each row execute function public.forbid_delete();

-- // SR-only writes + transitions
create or replace function public.withdrawals_guard()
returns trigger language plpgsql as $$
declare claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
        is_sr boolean := false;
        old_status text := coalesce(old.status, 'approved');
        new_status text := new.status;
begin
  if claims is not null then is_sr := ((claims::jsonb ->> 'role') = 'service_role'); end if;
  if not is_sr then raise exception 'writes to withdrawals are not permitted'; end if;

  if tg_op = 'INSERT' then return new; end if;

  if (row_to_json(new)::jsonb
        - 'status' - 'tx_sig' - 'slot' - 'block_time' - 'fail_reason' - 'request_id' - 'updated_at')
     <>
     (row_to_json(old)::jsonb
        - 'status' - 'tx_sig' - 'slot' - 'block_time' - 'fail_reason' - 'request_id' - 'updated_at') then
    raise exception 'immutable fields cannot be changed';
  end if;

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

-- // link requests <-> withdrawals
do $$ begin
  begin
    alter table public.withdrawals
      add constraint fk_withdrawals_request foreign key (request_id)
      references public.withdrawal_requests(id) on delete set null;
  exception when duplicate_object then null; end;

  begin
    alter table public.withdrawal_requests
      add constraint fk_wreq_fulfilled_withdrawal foreign key (fulfilled_withdrawal_id)
      references public.withdrawals(id) on delete set null;
  exception when duplicate_object then null; end;
end $$;

-- // events indexes
create index if not exists idx_we_req on public.withdrawal_events(request_id, created_at desc);
create index if not exists idx_we_wd  on public.withdrawal_events(withdrawal_id, created_at desc);

-- // small event helper
create or replace function public._log_withdrawal_event(p_req uuid, p_wd uuid, p_type text, p_actor text, p_details jsonb)
returns void language sql as $$
  insert into public.withdrawal_events(request_id, withdrawal_id, event_type, actor, details)
  values (p_req, p_wd, p_type, p_actor, coalesce(p_details, '{}'::jsonb));
$$;

-- // finalize hook
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

-- // approval proc (SR). creates withdrawals(approved) + logs events
create or replace function public.approve_withdrawal_request(p_request_id uuid)
returns uuid
language plpgsql as $$
declare
  claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
  is_sr boolean := false;
  r record;
  w_id uuid;
begin
  if claims is not null then is_sr := ((claims::jsonb ->> 'role') = 'service_role'); end if;
  if not is_sr then raise exception 'service_role required'; end if;

  select * into r from public.withdrawal_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'requested' then raise exception 'cannot approve status=%', r.status; end if;

  insert into public.withdrawals
    (user_id, contract_id, from_address, to_address, mint, amount_base_units, decimals, ui_amount, status, request_id)
  values
    (r.user_id, r.contract_id, r.from_address, r.to_address, r.mint, r.amount_base_units, r.decimals,
     case when r.decimals is null then null else (r.amount_base_units / (10 ^ r.decimals))::numeric end,
     'approved', r.id)
  returning id into w_id;

  update public.withdrawal_requests
    set status = 'approved', updated_at = now()
    where id = r.id;

  perform public._log_withdrawal_event(r.id, null,  'request_approved',    'service_role', '{}'::jsonb);
  perform public._log_withdrawal_event(r.id, w_id, 'withdrawal_created',   'service_role', '{}'::jsonb);

  return w_id;
end $$;

-- // event hooks: create/cancel/broadcast/confirm/failed
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
