-- Extensions
create extension if not exists "pgcrypto";

-- Helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin raise exception 'delete is forbidden to preserve the ledger'; end $$;

-- Indexer cursor
create table if not exists public.deposit_cursors (
  address text primary key,
  last_seen_sig text,
  updated_at timestamptz not null default now()
);
alter table public.deposit_cursors enable row level security;
drop policy if exists "deposit_cursors: read" on public.deposit_cursors;
create policy "deposit_cursors: read" on public.deposit_cursors for select using (true);
drop trigger if exists trg_deposit_cursors_touch on public.deposit_cursors;
create trigger trg_deposit_cursors_touch before update on public.deposit_cursors
for each row execute function public.touch_updated_at();

-- Deposits (tracks contract via contract_id only - no reference_code needed)
create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references public.users(id) on delete set null,

  to_address   text not null,
  from_address text,

  tx_sig     text not null,
  slot       bigint,  -- Nullable: will be set by indexer later
  block_time timestamptz,

  mint               text,             -- NULL => SOL
  amount_base_units  numeric not null, -- lamports / SPL base units > 0
  decimals           int not null,     -- 0..12 (9 for SOL)
  ui_amount          numeric not null, -- amount_base_units / 10^decimals

  status text not null check (status in ('processed','confirmed','finalized')),
  source text not null default 'rpc' check (source in ('rpc','webhook','backfill')),
  memo   text,

  contract_id uuid references public.contracts(id) on delete set null,

  asset_key text generated always as (coalesce(mint, 'SOL')) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deposits_asset_key_chk check (asset_key = coalesce(mint, 'SOL')),
  constraint deposits_amount_pos_chk check (amount_base_units > 0 and ui_amount > 0),
  constraint deposits_decimals_range_chk check (decimals between 0 and 12),
  constraint deposits_ui_matches_base_chk
    check (ui_amount = amount_base_units / power(10::numeric, decimals))
);

-- Uniqueness + indexes
create unique index if not exists ux_deposits_tx_addr_asset
  on public.deposits (tx_sig, to_address, asset_key);
create index if not exists idx_deposits_user_id        on public.deposits (user_id);
create index if not exists idx_deposits_to_address     on public.deposits (to_address);
create index if not exists idx_deposits_tx_sig         on public.deposits (tx_sig);
create index if not exists idx_deposits_contract_id    on public.deposits (contract_id);
create index if not exists idx_deposits_addr_slot_desc on public.deposits (to_address, slot desc);
create index if not exists idx_deposits_user_created   on public.deposits(user_id, created_at desc);
create index if not exists idx_deposits_contract_created
  on public.deposits(contract_id, created_at desc) where contract_id is not null;
create index if not exists idx_deposits_contract_finalized
  on public.deposits(contract_id) where status = 'finalized';

-- RLS (wallet-based read of own deposits)
alter table public.deposits enable row level security;
drop policy if exists "deposits: users read own" on public.deposits;
create policy "deposits: users read own" on public.deposits for select using (
  exists (
    select 1 from public.users u
    where (u.id = public.deposits.user_id or u.wallet_address = public.deposits.from_address)
      and u.wallet_address = coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'wallet', ''
      )
  )
);

-- Triggers
drop trigger if exists trg_deposits_touch on public.deposits;
create trigger trg_deposits_touch before update on public.deposits
for each row execute function public.touch_updated_at();

drop trigger if exists trg_deposits_no_delete on public.deposits;
create trigger trg_deposits_no_delete before delete on public.deposits
for each row execute function public.forbid_delete();

-- Update/status guard (service_role only)
create or replace function public.deposits_status_guard()
returns trigger language plpgsql as $$
declare
  claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
  is_sr boolean := false;
  old_status text := coalesce(old.status, 'processed');
  new_status text := new.status;
  allowed_same_row boolean := false;
begin
  if claims is not null then is_sr := ((claims::jsonb ->> 'role') = 'service_role'); end if;
  if not is_sr then raise exception 'updates to deposits are not permitted'; end if;

  allowed_same_row :=
       ((old.user_id is null and new.user_id is not null) or (new.user_id = old.user_id))
   and ((old.contract_id is null and new.contract_id is not null) or (new.contract_id = old.contract_id))
   and ((old.memo is null and new.memo is not null) or (new.memo = old.memo));

  if not allowed_same_row then
    if (row_to_json(new) - 'status' - 'updated_at' - 'user_id' - 'contract_id' - 'memo')
       <> (row_to_json(old) - 'status' - 'updated_at' - 'user_id' - 'contract_id' - 'memo')
    then
      raise exception 'only status plus one-time user_id/contract_id/memo is allowed';
    end if;
  end if;

  if old_status = new_status then return new; end if;
  if old_status = 'processed' and new_status in ('confirmed','finalized') then return new; end if;
  if old_status = 'confirmed' and new_status = 'finalized' then return new; end if;
  raise exception 'invalid status transition: % -> %', old_status, new_status;
end $$;

drop trigger if exists trg_deposits_status_guard on public.deposits;
create trigger trg_deposits_status_guard
before update on public.deposits
for each row execute function public.deposits_status_guard();

-- Comments
COMMENT ON TABLE deposits IS 'Tracks incoming SOL/token deposits to treasury, linked to contracts via contract_id';
COMMENT ON COLUMN deposits.contract_id IS 'Direct link to the contract being funded';
COMMENT ON COLUMN deposits.memo IS 'Optional memo from transaction or system note';