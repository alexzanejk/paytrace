-- 048: money that moved through each phone's wallets per Bangladesh day (12:00 AM to 11:59 PM Asia/Dhaka), per provider,
-- split into the three flows the owner asked to see side by side (2026-11-03): Cash Out (money that came IN to the agent
-- wallet, from a customer's SMS receipt), Cash In (money the agent SENT OUT to a personal number) and B2B (money the agent
-- sent to its distributor).
--
-- Where each comes from, honestly:
--   cash_out : payments.txn_type = 'cash_out' in a counted status (the same rows the dashboard totals count).
--   b2b_out  : payments.review_reason = 'b2b_transfer_out' (Rocket's "B2B: Cash-Out to A/C" receipt; stored ignored so no
--              total counts it as money received). bKash and Nagad B2B messages have never been seen, so they are not here.
--   cash_in  : a cash-in sends NO SMS, so only the cash-ins PayTrace itself knows about are counted: dashboard-told
--              cash-ins that finished (phone_commands kind cashin, status done) and partner-reported cash-ins that were
--              verified by the next Cash Out message or accepted by the owner (cashin_jobs status verified).
-- Reads only. security_invoker, so the admin policies of the three tables apply.
create or replace view public.device_day_flows with (security_invoker = true) as
select day, device_id, provider, kind, count(*)::int as n, sum(amount) as amount
  from (
    select (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date as day, device_id, provider,
           case when review_reason = 'b2b_transfer_out' then 'b2b_out' else 'cash_out' end as kind, amount
      from public.payments
     where source = 'app'
       and ((txn_type = 'cash_out' and status in ('unmatched', 'matched', 'tracked_only')) or review_reason = 'b2b_transfer_out')
    union all
    select (coalesce(finished_at, created_at) at time zone 'Asia/Dhaka')::date, device_id, provider, 'cash_in', amount
      from public.phone_commands
     where kind = 'cashin' and status = 'done' and amount is not null and provider is not null
    union all
    select (coalesce(submitted_at, checked_at, created_at) at time zone 'Asia/Dhaka')::date, device_id, provider, 'cash_in', amount
      from public.cashin_jobs
     where status = 'verified' and amount is not null
  ) x
 group by 1, 2, 3, 4;

revoke all on public.device_day_flows from anon;
grant select on public.device_day_flows to authenticated;
