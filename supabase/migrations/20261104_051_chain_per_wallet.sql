-- 051: the balance chain is judged per WALLET (phone + provider), not per provider across every phone (owner 2026-11-04).
-- WHY: balance_chain_check compared a new Nagad SMS with the previous Nagad SMS from ANY phone. With one phone that was
-- the same thing; with three phones holding Nagad wallets it compared different wallets, so 15 of the last 17 Cash Out
-- receipts read "mismatch" and a real Tk 500 payment (769BDUZI, 777bajii) was held for review instead of credited.
-- A new 7-argument overload takes the phone; ingest passes it. The 6-argument one is left as it was. Also: the commission
-- ceiling used 0.02 * p_amount, which for an OUTGOING message (negative amount) was 1 taka; now abs().
create or replace function public.balance_chain_check(
  p_provider text, p_at timestamptz, p_balance numeric, p_amount numeric, p_fee numeric, p_commission numeric, p_device uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  prev_balance numeric;
  delta numeric;
  residual numeric;
  tolerance numeric := 0.01;
  max_commission numeric;
begin
  if p_balance is null then
    return jsonb_build_object('status', 'unverified', 'reason', 'message states no balance');
  end if;

  select balance into prev_balance
  from public.payments
  where provider = p_provider
    and source = 'app'
    and balance is not null
    and (p_device is null or device_id = p_device)
    and coalesce(occurred_at, received_at) <= p_at
  order by coalesce(occurred_at, received_at) desc, received_at desc
  limit 1;

  if prev_balance is null then
    return jsonb_build_object('status', 'unverified', 'reason',
      case when p_device is null then 'first message from this provider' else 'first message from this wallet' end);
  end if;

  delta := p_balance - prev_balance;
  residual := delta - (p_amount - coalesce(p_fee, 0));
  max_commission := greatest(0.02 * abs(p_amount), 1);

  if coalesce(p_commission, 0) > 0 then
    if abs(residual - p_commission) <= tolerance then
      return jsonb_build_object('status', 'ok', 'delta', delta, 'commission', p_commission);
    end if;
    return jsonb_build_object('status', 'mismatch', 'delta', delta, 'expected', p_amount - coalesce(p_fee, 0) + p_commission);
  end if;

  if residual >= -tolerance and residual <= max_commission then
    return jsonb_build_object('status', 'ok', 'delta', delta, 'commission', round(greatest(residual, 0), 2));
  end if;

  return jsonb_build_object('status', 'mismatch', 'delta', delta, 'expected', p_amount - coalesce(p_fee, 0));
end $function$;

-- Re-judge the last 14 days per wallet. Only rows that read "mismatch" can improve; statuses (review etc.) are NOT
-- touched: a payment already held stays for a person to decide. bKash rows that now add up get their recovered
-- commission, as ingest would have stored it.
with ranked as (
  select p.id, p.balance, p.amount, p.fee, p.commission, p.provider,
         case when p.review_reason in ('b2b_transfer_out', 'cash_in_sent') then -p.amount else p.amount end as eff_amount,
         lag(p.balance) over (partition by p.device_id, p.provider
                              order by coalesce(p.occurred_at, p.received_at), p.received_at) as prev_balance
    from public.payments p
   where p.source = 'app' and p.balance is not null and p.device_id is not null
),
judged as (
  select id, provider, commission,
         (balance - prev_balance) as delta,
         (balance - prev_balance) - (eff_amount - coalesce(fee, 0)) as residual,
         greatest(0.02 * abs(eff_amount), 1) as max_commission
    from ranked
   where prev_balance is not null
)
update public.payments p
   set chain_status = case
         when coalesce(j.commission, 0) > 0 and abs(j.residual - j.commission) <= 0.01 then 'ok'
         when coalesce(j.commission, 0) > 0 then 'mismatch'
         when j.residual >= -0.01 and j.residual <= j.max_commission then 'ok'
         else 'mismatch' end,
       balance_delta = j.delta,
       commission = case
         when coalesce(j.commission, 0) = 0 and j.provider = 'bkash' and j.residual >= -0.01 and j.residual <= j.max_commission
           then round(greatest(j.residual, 0), 2)
         else p.commission end
  from judged j
 where j.id = p.id and p.chain_status = 'mismatch' and p.received_at > now() - interval '14 days';

-- bKash DOES send an SMS for an agent's cash-in ("Cash In Tk 200.00 to 0161XXXX190 successful. Fee Tk 0.00. Balance Tk
-- 6,806.69. TrxID ... at ..."; seen 2026-11-04). ingest now stores it like the Rocket B2B message (txn_type unknown,
-- status ignored, review_reason cash_in_sent, balance judged as money leaving). The Cash In column counts it.
create or replace view public.device_day_flows with (security_invoker = true) as
select day, device_id, provider, kind, count(*)::int as n, sum(amount) as amount
  from (
    select (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date as day, device_id, provider,
           case when review_reason = 'b2b_transfer_out' then 'b2b_out'
                when review_reason = 'cash_in_sent' then 'cash_in'
                else 'cash_out' end as kind, amount
      from public.payments
     where source = 'app'
       and ((txn_type = 'cash_out' and status in ('unmatched', 'matched', 'tracked_only'))
            or review_reason in ('b2b_transfer_out', 'cash_in_sent'))
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
