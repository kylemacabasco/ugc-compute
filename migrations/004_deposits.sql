create extension if not exists pgcrypto;

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  to_address text not null,                   -- treasury address (recipient)
  from_address text,                          -- best-effort sender
  tx_sig text not null,                       -- on-chain signature
  slot bigint not null,
  block_time timestamptz,
  mint text,                                  -- NULL => native SOL
  amount_base_units numeric not null,         -- lamports or SPL base units
  decimals int not null,                      -- 9 for SOL
  ui_amount numeric not null,                 -- amount_base_units / 10^decimals
  status text not null check (status in ('processed','confirmed','finalized')),
  source text not null default 'rpc',         -- 'rpc' | 'webhook' | 'backfill'
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deposits
  add column if not exists reference_code text,
  add column if not exists contract_id text;

alter table public.deposits
  add column if not exists asset_key text
  generated always as (coalesce(mint, 'SOL')) stored;

create unique index if not exists ux_deposits_tx_addr_asset
  on public.deposits (tx_sig, to_address, asset_key);
create index if not exists idx_deposits_user_id on public.deposits (user_id);
create index if not exists idx_deposits_to_address on public.deposits (to_address);
create index if not exists idx_deposits_tx_sig on public.deposits (tx_sig);
create index if not exists idx_deposits_contract_id on public.deposits (contract_id);
create index if not exists idx_deposits_reference_code on public.deposits (reference_code);

create table if not exists public.deposit_cursors (
  address text primary key,
  last_seen_sig text,
  updated_at timestamptz not null default now()
);

alter table public.deposits enable row level security;
alter table public.deposit_cursors enable row level security;

drop policy if exists "deposits: users read own" on public.deposits;
create policy "deposits: users read own"
on public.deposits for select
using (user_id = auth.uid());

drop policy if exists "deposit_cursors: read" on public.deposit_cursors;
create policy "deposit_cursors: read"
on public.deposit_cursors for select using (true);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_deposits_touch on public.deposits;
create trigger trg_deposits_touch
before update on public.deposits
for each row execute function public.touch_updated_at();

create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'delete is forbidden to preserve the ledger';
end $$;

drop trigger if exists trg_deposits_no_delete on public.deposits;
create trigger trg_deposits_no_delete
before delete on public.deposits
for each row execute function public.forbid_delete();

create or replace function public.deposits_status_guard()
returns trigger language plpgsql as $$
declare
  old_status text := coalesce(old.status, 'processed');
  new_status text := new.status;
  claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), NULL);
  is_sr boolean := false;
  allowed_same_row boolean := false;
begin
  if claims is not null then
    is_sr := ((claims::jsonb ->> 'role') = 'service_role');
  end if;

  if not is_sr then
    raise exception 'updates to deposits are not permitted';
  end if;

  -- allow one-time set of user_id/contract_id/memo/reference_code (NULL -> value), plus normal status update
  allowed_same_row :=
      ( (old.user_id is null and new.user_id is not null) or (new.user_id = old.user_id) )
  and ( (old.contract_id is null and new.contract_id is not null) or (new.contract_id = old.contract_id) )
  and ( (old.memo is null and new.memo is not null) or (new.memo = old.memo) )
  and ( (old.reference_code is null and new.reference_code is not null) or (new.reference_code = old.reference_code) );

  if not allowed_same_row then
    if (row_to_json(new)
          - 'status' - 'updated_at' - 'user_id' - 'contract_id' - 'memo' - 'reference_code')
       <>
       (row_to_json(old)
          - 'status' - 'updated_at' - 'user_id' - 'contract_id' - 'memo' - 'reference_code') then
      raise exception 'only status plus one-time user_id/contract_id/memo/reference_code is allowed';
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

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "app_settings: read" on public.app_settings;
create policy "app_settings: read" on public.app_settings for select using (true);

create table if not exists public.contract_refs (
  ref_code text primary key,
  contract_id text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active',  -- active | used | expired
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.contract_refs enable row level security;
drop policy if exists "contract_refs: read" on public.contract_refs;
create policy "contract_refs: read" on public.contract_refs for select using (true);

create index if not exists idx_contract_refs_user on public.contract_refs(user_id);
create index if not exists idx_contract_refs_contract on public.contract_refs(contract_id);
