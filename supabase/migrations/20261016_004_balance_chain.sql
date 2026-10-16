-- Fake-payment defence: every real provider SMS states the running account balance, so genuine
-- messages form a chain. A forged SMS cannot know the live balance, so it breaks the chain.
-- A break is held for a person to look at, never rejected outright: the chain also breaks
-- innocently when the phone was off and a real transaction was missed.
--
-- The same arithmetic recovers the agent commission bKash never states: whatever the balance rose
-- by beyond the amount is the commission.

alter table public.payments
  add column balance_delta numeric(14,2),
  add column chain_status text check (chain_status in ('ok', 'unverified', 'mismatch'));

comment on column public.payments.balance_delta is 'Observed change in account balance since the previous message from this provider.';
comment on column public.payments.chain_status is 'ok = balance follows the previous message; mismatch = it does not (held for review); unverified = could not be checked.';

create index payments_chain_idx on public.payments (provider, coalesce(occurred_at, received_at) desc)
  where source = 'app' and balance is not null;

-- Returns {status, delta, commission, expected}. `commission` is what the balance says the
-- commission was, which the caller uses when the message itself does not state one.
create or replace function public.balance_chain_check(
  p_provider text,
  p_at timestamptz,
  p_balance numeric,
  p_amount numeric,
  p_fee numeric,
  p_commission numeric
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  prev_balance numeric;
  delta numeric;
  residual numeric;
  tolerance numeric := 0.01;   -- a paisa of rounding slack
  max_commission numeric;      -- a plausible ceiling: agent commission is well under 2%
begin
  if p_balance is null then
    return jsonb_build_object('status', 'unverified', 'reason', 'message states no balance');
  end if;

  select balance into prev_balance
  from public.payments
  where provider = p_provider
    and source = 'app'
    and balance is not null
    and coalesce(occurred_at, received_at) <= p_at
  order by coalesce(occurred_at, received_at) desc, received_at desc
  limit 1;

  if prev_balance is null then
    return jsonb_build_object('status', 'unverified', 'reason', 'first message from this provider');
  end if;

  delta := p_balance - prev_balance;
  -- Money in raises the balance by the amount, less any fee, plus any commission earned.
  residual := delta - (p_amount - coalesce(p_fee, 0));
  max_commission := greatest(0.02 * p_amount, 1);

  if coalesce(p_commission, 0) > 0 then
    if abs(residual - p_commission) <= tolerance then
      return jsonb_build_object('status', 'ok', 'delta', delta, 'commission', p_commission);
    end if;
    return jsonb_build_object(
      'status', 'mismatch', 'delta', delta,
      'expected', p_amount - coalesce(p_fee, 0) + p_commission
    );
  end if;

  -- No commission stated (bKash): the leftover IS the commission, if it is a believable size.
  if residual >= -tolerance and residual <= max_commission then
    return jsonb_build_object(
      'status', 'ok', 'delta', delta, 'commission', round(greatest(residual, 0), 2)
    );
  end if;

  return jsonb_build_object(
    'status', 'mismatch', 'delta', delta, 'expected', p_amount - coalesce(p_fee, 0)
  );
end $$;

revoke all on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric)
  to service_role;

-- Call this BEFORE storing the new payment: it looks at every stored message up to p_at, so a row
-- that already exists would be compared against itself. Rows already in the table are judged by the
-- backfill below, which walks the history with a window function instead.

-- One-time backfill for payments stored before this check existed (a no-op on a fresh project).
with chain as (
  select id,
         balance - lag(balance) over w as delta,
         lag(balance) over w is null as no_previous,
         (balance - lag(balance) over w) - (amount - coalesce(fee, 0)) as residual,
         commission,
         greatest(0.02 * amount, 1) as max_commission
  from public.payments
  where source = 'app' and balance is not null
  window w as (partition by provider order by coalesce(occurred_at, received_at), received_at)
)
update public.payments p
   set balance_delta = chain.delta,
       chain_status = case
         when chain.no_previous then 'unverified'
         when chain.commission > 0 then
           case when abs(chain.residual - chain.commission) <= 0.01 then 'ok' else 'mismatch' end
         when chain.residual >= -0.01 and chain.residual <= chain.max_commission then 'ok'
         else 'mismatch'
       end
  from chain
 where p.id = chain.id and p.chain_status is null;
