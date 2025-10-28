-- ============================================================================
-- 006_withdrawal_payouts.sql
-- Contract payout calculation and automated distribution
-- Run this SECOND (after 005_withdrawal_core.sql)
-- ============================================================================

-- ============================================================================
-- PAYOUT VALIDATION: Prevent over-withdrawal
-- ============================================================================

-- Ensure payout requests don't exceed what creator deposited
create or replace function public.validate_payout_amount()
returns trigger language plpgsql as $$
declare
  v_total_deposited numeric;
  v_total_requested numeric;
  v_contract_creator uuid;
begin
  -- Skip validation if no contract linked (manual withdrawal)
  if new.contract_id is null then
    return new;
  end if;

  -- Get contract creator
  select creator_id into v_contract_creator
  from contracts
  where id = new.contract_id;

  if not found then
    raise exception 'Contract not found: %', new.contract_id;
  end if;

  -- Get total deposited by creator (finalized only)
  select coalesce(sum(amount_base_units), 0)
  into v_total_deposited
  from deposits
  where contract_id = new.contract_id
    and user_id = v_contract_creator
    and mint is null  -- SOL only
    and status = 'finalized';

  -- Get total requested (including this new request)
  select coalesce(sum(amount_base_units), 0) + new.amount_base_units
  into v_total_requested
  from withdrawal_requests
  where contract_id = new.contract_id
    and status in ('requested', 'approved', 'fulfilled')
    and id != coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- Reject if total requests exceed deposits
  if v_total_requested > v_total_deposited then
    raise exception 'Total withdrawal requests (% SOL) exceed deposited amount (% SOL) for contract %',
      round(v_total_requested / 1e9, 4), 
      round(v_total_deposited / 1e9, 4), 
      new.contract_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_validate_payout_amount on public.withdrawal_requests;
create trigger trg_validate_payout_amount
before insert or update on public.withdrawal_requests
for each row execute function public.validate_payout_amount();

-- ============================================================================
-- PAYOUT CALCULATION: View-based proportional distribution
-- ============================================================================

-- Calculate how much each user should receive from a completed contract
-- Payouts are proportional to views: (user_views / total_views) * contract_amount
create or replace function public.calculate_contract_payouts(p_contract_id uuid)
returns table(
  submission_id bigint,
  user_id uuid,
  user_wallet text,
  view_count int,
  payout_amount numeric,
  payout_percentage numeric
) language plpgsql as $$
declare
  v_contract record;
  v_total_views int;
  v_min_views int;
begin
  -- Get contract details
  select 
    c.id,
    c.contract_amount,
    c.rate_per_1k_views,
    c.metadata->>'min_views' as min_views_str
  into v_contract
  from contracts c
  where c.id = p_contract_id;

  if not found then
    raise exception 'Contract not found: %', p_contract_id;
  end if;

  -- Parse minimum views requirement (default to 0 if not set)
  v_min_views := coalesce((v_contract.min_views_str)::int, 0);

  -- Get total views from approved submissions that meet minimum
  select sum(s.view_count)
  into v_total_views
  from submissions s
  where s.contract_id = p_contract_id
    and s.status = 'approved'
    and s.view_count >= v_min_views;

  -- Validate we have eligible submissions
  if v_total_views is null or v_total_views = 0 then
    raise exception 'No approved submissions with sufficient views for contract %. Min views required: %', 
      p_contract_id, v_min_views;
  end if;

  -- Calculate proportional payout for each eligible submission
  return query
  select
    s.id as submission_id,
    s.user_id,
    u.wallet_address as user_wallet,
    s.view_count,
    -- Payout = (user_views / total_views) * contract_amount
    round((s.view_count::numeric / v_total_views::numeric) * v_contract.contract_amount, 9) as payout_amount,
    -- Percentage of total
    round((s.view_count::numeric / v_total_views::numeric) * 100, 2) as payout_percentage
  from submissions s
  join users u on u.id = s.user_id
  where s.contract_id = p_contract_id
    and s.status = 'approved'
    and s.view_count >= v_min_views
  order by s.view_count desc;
end $$;

-- ============================================================================
-- AUTOMATED DISTRIBUTION: Create withdrawal requests for all eligible users
-- ============================================================================

-- Creates withdrawal_requests for everyone who earned a payout
-- Called when "Distribute Funds" button is clicked
create or replace function public.create_contract_payout_requests(
  p_contract_id uuid,
  p_treasury_address text
)
returns table(
  submission_id bigint,
  user_id uuid,
  request_id uuid,
  amount_sol numeric,
  view_count int,
  percentage numeric
) language plpgsql security definer as $$
declare
  v_payout record;
  v_request_id uuid;
  v_contract_creator uuid;
  v_contract_status text;
  v_total_deposited numeric;
  v_total_payout numeric := 0;
begin
  -- Verify contract exists and is completed
  select creator_id, status 
  into v_contract_creator, v_contract_status
  from contracts
  where id = p_contract_id;

  if not found then
    raise exception 'Contract not found: %', p_contract_id;
  end if;

  if v_contract_status != 'completed' then
    raise exception 'Contract must be completed before distributing funds. Current status: %', v_contract_status;
  end if;

  -- Get total deposited for this contract (from creator, finalized only)
  select coalesce(sum(amount_base_units), 0) / 1e9
  into v_total_deposited
  from deposits
  where contract_id = p_contract_id
    and user_id = v_contract_creator
    and mint is null  -- SOL only
    and status = 'finalized';

  if v_total_deposited <= 0 then
    raise exception 'No finalized deposits found for contract %. Creator must deposit funds first.', p_contract_id;
  end if;

  -- Check if payout requests already exist
  if exists (
    select 1 from withdrawal_requests
    where contract_id = p_contract_id
    and status in ('requested', 'approved', 'fulfilled')
  ) then
    raise exception 'Payout requests already exist for contract %. Cannot distribute twice.', p_contract_id;
  end if;

  -- Create withdrawal request for each eligible user
  for v_payout in
    select * from calculate_contract_payouts(p_contract_id)
  loop
    -- Safety check: ensure we don't exceed total deposited
    if v_total_payout + v_payout.payout_amount > v_total_deposited then
      raise exception 'Total payout (% SOL) would exceed deposited amount (% SOL). Calculation error.',
        round(v_total_payout + v_payout.payout_amount, 4), 
        round(v_total_deposited, 4);
    end if;

    -- Create withdrawal request
    insert into withdrawal_requests (
      user_id,
      contract_id,
      submission_id,
      from_address,
      to_address,
      mint,
      amount_base_units,
      decimals,
      status
    ) values (
      v_payout.user_id,
      p_contract_id,
      v_payout.submission_id,
      p_treasury_address,
      v_payout.user_wallet,
      null,  -- SOL
      (v_payout.payout_amount * 1e9)::bigint,  -- Convert SOL to lamports
      9,  -- SOL decimals
      'requested'
    )
    returning id into v_request_id;

    v_total_payout := v_total_payout + v_payout.payout_amount;

    -- Return row for this payout
    return query select
      v_payout.submission_id,
      v_payout.user_id,
      v_request_id,
      v_payout.payout_amount,
      v_payout.view_count,
      v_payout.payout_percentage;
  end loop;

  -- Log summary
  raise notice 'Created % payout requests totaling % SOL for contract %', 
    (select count(*) from withdrawal_requests where contract_id = p_contract_id and status = 'requested'),
    round(v_total_payout, 4),
    p_contract_id;
end $$;