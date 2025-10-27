create extension if not exists "pgcrypto";

-- Generic 'touch' trigger function (used by multiple tables)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Forbid delete helper (ledger semantics)
create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'delete is forbidden to preserve the ledger';
end $$;


-- Contract_refs
create table if not exists public.contract_refs (
  ref_code   text primary key,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
<<<<<<< HEAD
  status     text not null default 'active' check (status in ('active', 'used', 'expired')),
=======
  status     text not null default 'active',  -- active | used | expired
>>>>>>> f3f3211 (update fixes)
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contract_refs enable row level security;

drop policy if exists "contract_refs: read" on public.contract_refs;
create policy "contract_refs: read" on public.contract_refs
for select using (true);

drop trigger if exists trg_contract_refs_touch on public.contract_refs;
create trigger trg_contract_refs_touch
before update on public.contract_refs
for each row execute function public.touch_updated_at();

<<<<<<< HEAD
-- Indexes for contract_refs
create index if not exists idx_contract_refs_user     on public.contract_refs(user_id);
create index if not exists idx_contract_refs_contract on public.contract_refs(contract_id);
create index if not exists idx_contract_refs_status   on public.contract_refs(status) where status = 'active';

-- Prevent duplicate active refs per user+contract combination
create unique index if not exists ux_contract_refs_user_contract_active
  on public.contract_refs(user_id, contract_id)
  where status = 'active';


-- App_settings
=======
create index if not exists idx_contract_refs_user     on public.contract_refs(user_id);
create index if not exists idx_contract_refs_contract on public.contract_refs(contract_id);

>>>>>>> f3f3211 (update fixes)
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings: read" on public.app_settings;
create policy "app_settings: read" on public.app_settings
for select using (true);


-- Deposit_cursors
create table if not exists public.deposit_cursors (
  address text primary key,
  last_seen_sig text,
  updated_at timestamptz not null default now()
);

alter table public.deposit_cursors enable row level security;

drop policy if exists "deposit_cursors: read" on public.deposit_cursors;
create policy "deposit_cursors: read" on public.deposit_cursors
for select using (true);

drop trigger if exists trg_deposit_cursors_touch on public.deposit_cursors;
create trigger trg_deposit_cursors_touch
before update on public.deposit_cursors
for each row execute function public.touch_updated_at();

<<<<<<< HEAD

-- Deposits (main ledger table)
=======
-- Deposits
>>>>>>> f3f3211 (update fixes)
create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),

  -- May be null at ingest time; can be set later once we can attribute
  user_id uuid references public.users(id) on delete set null,

  -- Treasury and (best-effort) sender
  to_address   text not null,
  from_address text,

  -- On-chain identity
  tx_sig    text not null,
  slot      bigint not null,
  block_time timestamptz,

  -- Asset identity and amounts
  mint                text,                          -- NULL => native SOL
  amount_base_units   numeric not null,              -- lamports or SPL base units
  decimals            int not null,                  -- 9 for SOL
  ui_amount           numeric not null,              -- amount_base_units / 10^decimals

  -- Lifecycle
  status text not null check (status in ('processed','confirmed','finalized')),
<<<<<<< HEAD
  source text not null default 'rpc' check (source in ('rpc','webhook','backfill')),
=======
  source text not null default 'rpc',
>>>>>>> f3f3211 (update fixes)
  memo   text,

  -- Linking & audit
  reference_code text,
  contract_id    uuid references public.contracts(id) on delete set null,

  -- Derived for uniqueness (SOL vs SPL)
  asset_key text generated always as (coalesce(mint, 'SOL')) stored,

  created_at timestamptz not null default now(),
<<<<<<< HEAD
  updated_at timestamptz not null default now(),

  -- Ensure asset_key consistency
  constraint deposits_asset_key_chk check (asset_key = coalesce(mint, 'SOL'))
);

=======
  updated_at timestamptz not null default now()
);

-- Enforce allowed sources
alter table public.deposits
  add constraint deposits_source_chk
  check (source in ('rpc','webhook','backfill'));

>>>>>>> f3f3211 (update fixes)
-- Uniqueness: one row per (tx, treasury, asset). We aggregate per asset in code.
create unique index if not exists ux_deposits_tx_addr_asset
  on public.deposits (tx_sig, to_address, asset_key);

<<<<<<< HEAD
-- Helpful indexes for queries
=======
-- Helpful indexes
>>>>>>> f3f3211 (update fixes)
create index if not exists idx_deposits_user_id     on public.deposits (user_id);
create index if not exists idx_deposits_to_address  on public.deposits (to_address);
create index if not exists idx_deposits_tx_sig      on public.deposits (tx_sig);
create index if not exists idx_deposits_contract_id on public.deposits (contract_id);
create index if not exists idx_deposits_reference   on public.deposits (reference_code);
create index if not exists idx_deposits_addr_slot   on public.deposits (to_address, slot desc);

<<<<<<< HEAD
-- Frontend query optimizations
create index if not exists idx_deposits_user_created
  on public.deposits(user_id, created_at desc);

create index if not exists idx_deposits_contract_created
  on public.deposits(contract_id, created_at desc)
  where contract_id is not null;

-- Enable RLS
alter table public.deposits enable row level security;

-- RLS: Users can read their own deposits (by user_id OR by from_address)
=======
alter table public.deposits enable row level security;

-- RLS
>>>>>>> f3f3211 (update fixes)
drop policy if exists "deposits: users read own" on public.deposits;
create policy "deposits: users read own"
on public.deposits for select
using (
  exists (
    select 1
    from public.users u
<<<<<<< HEAD
    where (
      -- Match by user_id (for attributed deposits)
      (u.id = public.deposits.user_id)
      -- OR match by from_address (for unattributed deposits from their wallet)
      or (u.wallet_address = public.deposits.from_address)
    )
    and u.wallet_address = coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'wallet',
      ''
    )
  )
);

-- Touch trigger for updated_at
=======
    where u.id = public.deposits.user_id
      and u.wallet_address = coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'wallet',
        ''
      )
  )
);

>>>>>>> f3f3211 (update fixes)
drop trigger if exists trg_deposits_touch on public.deposits;
create trigger trg_deposits_touch
before update on public.deposits
for each row execute function public.touch_updated_at();

-- Forbid deletes (append-only ledger)
drop trigger if exists trg_deposits_no_delete on public.deposits;
create trigger trg_deposits_no_delete
before delete on public.deposits
for each row execute function public.forbid_delete();

-- Status guard: only service_role can update, and only certain transitions allowed
create or replace function public.deposits_status_guard()
returns trigger language plpgsql as $$
declare
  claims text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), null);
  is_sr boolean := false;
  old_status text := coalesce(old.status, 'processed');
  new_status text := new.status;
  allowed_same_row boolean := false;
begin
  if claims is not null then
    is_sr := ((claims::jsonb ->> 'role') = 'service_role');
  end if;

  if not is_sr then
    raise exception 'updates to deposits are not permitted';
  end if;

  -- Allow one-time set of these nullable link fields
  allowed_same_row :=
       ((old.user_id is null and new.user_id is not null) or (new.user_id = old.user_id))
   and ((old.contract_id is null and new.contract_id is not null) or (new.contract_id = old.contract_id))
   and ((old.memo is null and new.memo is not null) or (new.memo = old.memo))
   and ((old.reference_code is null and new.reference_code is not null) or (new.reference_code = old.reference_code));

  if not allowed_same_row then
    if (row_to_json(new)
          - 'status' - 'updated_at' - 'user_id' - 'contract_id' - 'memo' - 'reference_code')
       <>
       (row_to_json(old)
          - 'status' - 'updated_at' - 'user_id' - 'contract_id' - 'memo' - 'reference_code') then
      raise exception 'only status plus one-time user_id/contract_id/memo/reference_code is allowed';
    end if;
  end if;

  -- Status transition validation
  if old_status = new_status then return new; end if;
  if old_status = 'processed' and new_status in ('confirmed','finalized') then return new; end if;
  if old_status = 'confirmed' and new_status = 'finalized' then return new; end if;

  raise exception 'invalid status transition: % -> %', old_status, new_status;
end $$;

drop trigger if exists trg_deposits_status_guard on public.deposits;
create trigger trg_deposits_status_guard
before update on public.deposits
<<<<<<< HEAD
for each row execute function public.deposits_status_guard();


-- Optional: Auto-expire old refs (run periodically via cron job)
create or replace function public.expire_old_contract_refs()
returns void language plpgsql as $$
begin
  update public.contract_refs
  set status = 'expired'
  where status = 'active'
    and expires_at is not null
    and expires_at < now();
end $$;

-- Optional: Helper view for aggregated deposit totals per contract
create or replace view public.contract_deposit_totals as
select
  contract_id,
  asset_key,
  mint,
  decimals,
  sum(amount_base_units) as total_base_units,
  sum(ui_amount) as total_ui_amount,
  count(*) as deposit_count,
  count(distinct user_id) as unique_depositors
from public.deposits
where contract_id is not null
  and status = 'finalized'
group by contract_id, asset_key, mint, decimals;

-- Optional: Helper view for user deposit history
create or replace view public.user_deposit_history as
select
  d.id,
  d.user_id,
  d.contract_id,
  c.title as contract_title,
  d.tx_sig,
  d.block_time,
  d.asset_key,
  d.ui_amount,
  d.status,
  d.reference_code,
  d.created_at
from public.deposits d
left join public.contracts c on c.id = d.contract_id
where d.user_id is not null
order by d.created_at desc;
=======
for each row execute function public.deposits_status_guard();
>>>>>>> f3f3211 (update fixes)
