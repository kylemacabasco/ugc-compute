-- ============================================================================
-- 007_withdrawal_monitoring.sql
-- Views and helper functions for monitoring withdrawals and payouts
-- Run this THIRD (after 005 and 006)
-- ============================================================================

-- ============================================================================
-- VIEW: Contract Payout Summary
-- Shows deposit vs payout status for each contract
-- ============================================================================

create or replace view public.contract_payout_summary as
select
  c.id as contract_id,
  c.title,
  c.status as contract_status,
  c.contract_amount as budgeted_amount,
  u.wallet_address as creator_wallet,
  u.username as creator_username,
  
  -- Deposits from creator (finalized only)
  coalesce(sum(d.amount_base_units) filter (where d.status = 'finalized') / 1e9, 0) as total_deposited_sol,
  
  -- Payout requests
  (select count(*) from withdrawal_requests wr where wr.contract_id = c.id) as total_payout_requests,
  (select count(*) from withdrawal_requests wr where wr.contract_id = c.id and wr.status = 'requested') as pending_requests,
  coalesce((select sum(wr2.amount_base_units) from withdrawal_requests wr2 where wr2.contract_id = c.id) / 1e9, 0) as total_requested_sol,
  
  -- Completed payouts (finalized withdrawals)
  coalesce((select count(*) from withdrawals w where w.contract_id = c.id and w.status = 'finalized'), 0) as completed_payouts,
  coalesce((select sum(w.amount_base_units) from withdrawals w where w.contract_id = c.id and w.status = 'finalized') / 1e9, 0) as total_paid_sol,
  
  -- In-progress withdrawals
  coalesce((select count(*) from withdrawals w where w.contract_id = c.id and w.status in ('approved', 'broadcast', 'confirmed')), 0) as in_progress_withdrawals,
  
  -- Remaining balance
  coalesce(sum(d.amount_base_units) filter (where d.status = 'finalized') / 1e9, 0) - 
  coalesce((select sum(w2.amount_base_units) from withdrawals w2 where w2.contract_id = c.id and w2.status = 'finalized') / 1e9, 0) as remaining_balance_sol,
  
  -- Timestamps
  c.created_at as contract_created,
  max(d.created_at) as last_deposit_at,
  (select max(wr.created_at) from withdrawal_requests wr where wr.contract_id = c.id) as last_request_at,
  (select max(w.created_at) from withdrawals w where w.contract_id = c.id and w.status = 'finalized') as last_payout_at

from contracts c
join users u on u.id = c.creator_id
left join deposits d on d.contract_id = c.id and d.user_id = c.creator_id and d.mint is null
group by c.id, c.title, c.status, c.contract_amount, c.created_at, u.wallet_address, u.username
order by c.created_at desc;

-- ============================================================================
-- VIEW: Pending Withdrawals (for processing script)
-- Shows all withdrawals ready to be sent
-- ============================================================================

create or replace view public.pending_withdrawals as
select
  w.id as withdrawal_id,
  w.user_id,
  u.wallet_address as to_address,
  u.username,
  w.contract_id,
  c.title as contract_title,
  w.submission_id,
  w.from_address,
  w.ui_amount as amount_sol,
  w.amount_base_units as amount_lamports,
  w.status,
  w.tx_sig,
  w.created_at,
  now() - w.created_at as pending_duration
from withdrawals w
join users u on u.id = w.user_id
left join contracts c on c.id = w.contract_id
where w.status in ('approved', 'broadcast', 'confirmed')
order by w.created_at asc;

-- ============================================================================
-- VIEW: User Payout History
-- Shows all payouts received by each user
-- ============================================================================

create or replace view public.user_payout_history as
select
  u.id as user_id,
  u.username,
  u.wallet_address,
  w.id as withdrawal_id,
  w.contract_id,
  c.title as contract_title,
  w.submission_id,
  s.video_url,
  s.view_count,
  w.ui_amount as payout_sol,
  w.status,
  w.tx_sig,
  w.created_at as payout_created,
  w.block_time as payout_finalized,
  concat('https://explorer.solana.com/tx/', w.tx_sig, '?cluster=mainnet') as explorer_link
from users u
join withdrawals w on w.user_id = u.id
left join contracts c on c.id = w.contract_id
left join submissions s on s.id = w.submission_id
where w.mint is null  -- SOL only
order by w.created_at desc;

-- ============================================================================
-- VIEW: Withdrawal Request Details
-- Full details for admin review
-- ============================================================================

create or replace view public.withdrawal_request_details as
select
  wr.id as request_id,
  wr.status as request_status,
  u.username,
  u.wallet_address as user_wallet,
  wr.to_address as destination_wallet,
  c.title as contract_title,
  s.video_url,
  s.view_count,
  wr.amount_base_units / 1e9 as requested_sol,
  wr.created_at as requested_at,
  wr.updated_at as last_updated,
  wr.reject_reason,
  w.id as withdrawal_id,
  w.status as withdrawal_status,
  w.tx_sig,
  w.block_time as completed_at
from withdrawal_requests wr
join users u on u.id = wr.user_id
left join contracts c on c.id = wr.contract_id
left join submissions s on s.id = wr.submission_id
left join withdrawals w on w.request_id = wr.id
order by wr.created_at desc;

-- ============================================================================
-- HELPER FUNCTION: Get user's withdrawable balance
-- Calculates available balance for manual withdrawals (not contract payouts)
-- ============================================================================

create or replace function public.get_user_withdrawable_balance(
  p_user_id uuid,
  p_contract_id uuid default null,
  p_mint text default null
)
returns table(
  total_deposited_sol numeric,
  total_withdrawn_sol numeric,
  withdrawable_sol numeric
) language plpgsql as $$
declare
  v_deposited numeric;
  v_withdrawn numeric;
  v_available numeric;
begin
  -- Sum finalized deposits
  select coalesce(sum(d.amount_base_units) / 1e9, 0)
  into v_deposited
  from deposits d
  where d.user_id = p_user_id
    and (p_contract_id is null or d.contract_id = p_contract_id)
    and coalesce(d.mint, 'SOL') = coalesce(p_mint, 'SOL')
    and d.status = 'finalized';

  -- Sum finalized/confirmed withdrawals
  select coalesce(sum(w.amount_base_units) / 1e9, 0)
  into v_withdrawn
  from withdrawals w
  where w.user_id = p_user_id
    and (p_contract_id is null or w.contract_id = p_contract_id)
    and coalesce(w.mint, 'SOL') = coalesce(p_mint, 'SOL')
    and w.status in ('finalized', 'confirmed');

  v_available := v_deposited - v_withdrawn;

  return query select v_deposited, v_withdrawn, v_available;
end $$;

-- ============================================================================
-- MONITORING QUERIES (for admin dashboards)
-- ============================================================================

-- Query 1: Check for stuck withdrawals (>30 min without progress)
create or replace view public.stuck_withdrawals as
select
  w.id,
  u.username,
  w.status,
  w.ui_amount as amount_sol,
  w.created_at,
  now() - w.created_at as stuck_duration
from withdrawals w
join users u on u.id = w.user_id
where w.status in ('approved', 'broadcast', 'confirmed')
  and w.created_at < now() - interval '30 minutes'
order by w.created_at asc;

-- Query 2: Daily payout statistics
create or replace view public.daily_payout_stats as
select
  date(w.created_at) as payout_date,
  count(*) as total_payouts,
  count(distinct w.user_id) as unique_recipients,
  count(distinct w.contract_id) as contracts_paid_out,
  sum(w.ui_amount) as total_sol_paid,
  avg(w.ui_amount) as avg_payout_sol,
  count(*) filter (where w.status = 'finalized') as successful_payouts,
  count(*) filter (where w.status = 'failed') as failed_payouts
from withdrawals w
where w.mint is null  -- SOL only
  and w.created_at > now() - interval '30 days'
group by date(w.created_at)
order by payout_date desc;

-- Query 3: Top earners
create or replace view public.top_earners as
select
  u.username,
  u.wallet_address,
  count(distinct w.contract_id) as contracts_participated,
  sum(s.view_count) as total_views,
  sum(w.ui_amount) filter (where w.status = 'finalized') as total_earned_sol,
  max(w.block_time) as last_payout
from users u
join withdrawals w on w.user_id = u.id
left join submissions s on s.id = w.submission_id
where w.mint is null
group by u.id, u.username, u.wallet_address
order by total_earned_sol desc nulls last
limit 50;