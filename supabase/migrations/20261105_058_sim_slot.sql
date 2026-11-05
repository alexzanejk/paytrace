-- 058: one wallet per SIM, not per phone (2026-11-05).
--
-- WHY: a phone can hold two wallets of the same kind (the owner's Redmi: an agent bKash on SIM 1, a personal bKash on
-- SIM 2). Both text from the sender ID "bKash" and the SMS never names the account, so PayTrace filed them under one
-- "bKash on this phone" and judged one account's balance against the other's: almost every real payment on that phone
-- read "can't tell" and was held. The app now sends which SIM each SMS arrived on (sim_slot: 0 = SIM 1, 1 = SIM 2; an
-- old build sends nothing = unknown, which keeps today's behaviour), and everything that compares one message with the
-- wallet's previous ones now stays inside the same SIM. No DROP, no DELETE (the MCP hangs on both).

alter table public.payments add column if not exists sim_slot smallint;
alter table public.payments add constraint payments_sim_slot_chk check (sim_slot is null or sim_slot in (0, 1));
comment on column public.payments.sim_slot is 'Which SIM the SMS arrived on: 0 = SIM 1, 1 = SIM 2, null = the app did not say (old build). Two wallets of the same kind on one phone are told apart only by this.';

-- ---------- the balance chain stays inside one SIM ----------
-- The previous message is the newest one from the same phone and wallet type on the SAME SIM. Rows stored before the app
-- said the SIM (sim_slot null) still count, so the chain is not broken on the day of the update; a row from the OTHER SIM
-- never does. An untagged message (old build) is judged as before, against any SIM.
create or replace function public.balance_chain_check(
  p_provider text, p_at timestamptz, p_balance numeric, p_amount numeric, p_fee numeric, p_commission numeric, p_device uuid, p_sim smallint)
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
  select balance into prev_balance
  from public.payments
  where provider = p_provider
    and source = 'app'
    and balance is not null
    and (p_device is null or device_id = p_device)
    and (p_sim is null or sim_slot is null or sim_slot = p_sim)
    and coalesce(occurred_at, received_at) <= p_at
  order by coalesce(occurred_at, received_at) desc, received_at desc
  limit 1;

  if p_balance is null then
    if prev_balance is not null and p_device is not null then
      return jsonb_build_object('status', 'mismatch', 'reason', 'message states no balance');
    end if;
    return jsonb_build_object('status', 'unverified', 'reason', 'message states no balance');
  end if;

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

-- The 7-argument form (ingest before v42, and any script) is the same rule with the SIM unknown.
create or replace function public.balance_chain_check(
  p_provider text, p_at timestamptz, p_balance numeric, p_amount numeric, p_fee numeric, p_commission numeric, p_device uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select public.balance_chain_check(p_provider, p_at, p_balance, p_amount, p_fee, p_commission, p_device, null::smallint);
$$;
revoke all on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric, uuid, smallint) from public, anon, authenticated;
grant execute on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric, uuid, smallint) to service_role;
revoke all on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric, uuid) to service_role;

-- ---------- balances: one per phone, wallet type and SIM; and the phone's "main" balance follows its saved wallet's SIM ----------
create or replace view public.device_sim_balances with (security_invoker = true) as
select distinct on (device_id, provider, sim_slot) device_id, provider, sim_slot, balance, coalesce(occurred_at, received_at) as at
from public.payments
where source = 'app' and balance is not null and device_id is not null
order by device_id, provider, sim_slot, coalesce(occurred_at, received_at) desc, received_at desc;
grant select on public.device_sim_balances to authenticated;

-- device_balances keeps its one row per phone and wallet type (jobs, cash-in jobs and the sent-money check read it), but
-- that row is now the newest message from the SIM the phone's saved wallet number lives in (the heartbeat's wallets[]),
-- so a personal account on the other SIM can no longer masquerade as the agent wallet's balance. A phone that has not
-- said which SIM its wallet is on, or whose messages carry no SIM yet, behaves exactly as before.
create or replace view public.device_balances as
select distinct on (p.device_id, p.provider) p.device_id, p.provider, p.balance, coalesce(p.occurred_at, p.received_at) as at
from public.payments p
left join public.devices d on d.id = p.device_id
where p.source = 'app' and p.balance is not null and p.device_id is not null
order by p.device_id, p.provider,
  (p.sim_slot is not null and exists (
     select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
      where w->>'provider' = p.provider and (w->>'slot') ~ '^[01]$' and (w->>'slot')::int = p.sim_slot)) desc,
  coalesce(p.occurred_at, p.received_at) desc, p.received_at desc;

-- ---------- the wallet check judges a held payment against its own SIM ----------
-- Both judges: "newer messages" and "stored payments of that amount" count only the same SIM, and when the SMS came from
-- a SIM other than the one the phone's wallet menu is set up on, the phone's balance or statement is another account's
-- and cannot vouch for it: the owner is told exactly that instead of "the statement shows no such entry".
create or replace function public.sim_of_wallet(p_device uuid, p_provider text)
returns smallint language sql stable security definer set search_path = public as $$
  select (w->>'slot')::smallint
    from public.devices d, jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
   where d.id = p_device and w->>'provider' = p_provider and (w->>'slot') ~ '^[01]$'
   limit 1;
$$;
revoke all on function public.sim_of_wallet(uuid, text) from public, anon, authenticated;
grant execute on function public.sim_of_wallet(uuid, text) to service_role;

create or replace function public.payment_check_judge_balance(p_command uuid, p_ok boolean, p_balance numeric, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.payment_checks; p public.payments; newer int; why text; r text; wsim smallint;
begin
  select * into c from public.payment_checks where command_id = p_command and status = 'queued' and step = 'balance' for update;
  if c.id is null then return jsonb_build_object('error', 'no_check'); end if;
  select * into p from public.payments where id = c.payment_id;
  wsim := public.sim_of_wallet(p.device_id, p.provider);
  if p.sim_slot is not null and wsim is not null and wsim <> p.sim_slot then
    why := format('This SMS arrived on SIM %s, but the phone''s %s menu is set up on SIM %s: the live balance is another account''s and cannot vouch for it.', p.sim_slot + 1, p.provider, wsim + 1);
    update public.payment_checks set status = 'not_confirmed', finished_at = now(), detail = why where id = c.id;
    return jsonb_build_object('confirmed', false, 'detail', why);
  end if;
  if p_ok and p_balance is not null then
    select count(*) into newer from public.payments x
     where x.device_id = p.device_id and x.provider = p.provider and x.balance is not null and x.id <> p.id
       and (p.sim_slot is null or x.sim_slot is null or x.sim_slot = p.sim_slot)
       and coalesce(x.occurred_at, x.received_at) > coalesce(p.occurred_at, p.received_at);
    if newer = 0 and abs(p_balance - coalesce(p.balance, -1)) <= 0.01 then
      why := format('The wallet''s live balance is Tk %s, the same as the SMS printed.', p_balance);
      update public.payment_checks set status = 'confirmed', finished_at = now(), detail = why where id = c.id;
      r := public.payment_check_confirm(p.id, 'balance', why);
      return jsonb_build_object('confirmed', true, 'result', r, 'detail', why);
    end if;
    why := case when newer > 0 then format('The wallet has had %s newer message(s) since, so the live balance (Tk %s) cannot vouch for this SMS.', newer, p_balance)
                else format('The wallet''s live balance is Tk %s, the SMS printed Tk %s: money has moved since.', p_balance, p.balance) end;
    update public.payment_checks set status = 'not_confirmed', finished_at = now(), detail = why where id = c.id;
  else
    why := 'The balance check did not run: ' || coalesce(nullif(p_error, ''), 'failed');
    update public.payment_checks set status = 'failed', finished_at = now(), detail = why where id = c.id;
  end if;
  return jsonb_build_object('confirmed', false, 'detail', why, 'next', public.payment_check_start(p.id, 'statement'));
end $$;
revoke all on function public.payment_check_judge_balance(uuid, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.payment_check_judge_balance(uuid, boolean, numeric, text) to service_role;

create or replace function public.payment_check_judge_statement(p_command uuid, p_ok boolean, p_lines jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.payment_checks; p public.payments; pday date; matches int := 0; stored int; why text; r text; n_lines int := 0; wsim smallint;
begin
  select * into c from public.payment_checks where command_id = p_command and status = 'queued' and step = 'statement' for update;
  if c.id is null then return jsonb_build_object('error', 'no_check'); end if;
  select * into p from public.payments where id = c.payment_id;
  if not p_ok then
    why := 'The statement could not be fetched: ' || coalesce(nullif(p_error, ''), 'failed');
    update public.payment_checks set status = 'failed', finished_at = now(), detail = why where id = c.id;
    return jsonb_build_object('confirmed', false, 'detail', why);
  end if;
  wsim := public.sim_of_wallet(p.device_id, p.provider);
  if p.sim_slot is not null and wsim is not null and wsim <> p.sim_slot then
    why := format('This SMS arrived on SIM %s, but the phone''s %s menu is set up on SIM %s: the statement is another account''s and cannot vouch for it.', p.sim_slot + 1, p.provider, wsim + 1);
    update public.payment_checks set status = 'not_confirmed', finished_at = now(), detail = why where id = c.id;
    return jsonb_build_object('confirmed', false, 'detail', why);
  end if;
  pday := (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date;
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    select count(*), count(*) filter (where (l->>'in')::boolean and (l->>'day')::date = pday and abs((l->>'amount')::numeric - p.amount) < 0.005)
      into n_lines, matches
      from jsonb_array_elements(p_lines) l
     where l ? 'day' and l ? 'amount' and l ? 'in' and (l->>'day') ~ '^\d{4}-\d{2}-\d{2}$';
  end if;
  -- Every stored payment of that amount, that day, on that wallet (same SIM) needs its own statement entry (this one included).
  select count(*) into stored from public.payments x
   where x.device_id = p.device_id and x.provider = p.provider and x.status <> 'ignored'
     and (p.sim_slot is null or x.sim_slot is null or x.sim_slot = p.sim_slot)
     and abs(x.amount - p.amount) < 0.005 and (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date = pday;
  if n_lines = 0 then
    why := 'PayTrace could not read any entry in the statement the phone sent.';
  elsif matches >= greatest(stored, 1) then
    why := format('The wallet''s statement lists %s entr%s of Tk %s coming in on %s.', matches, case when matches = 1 then 'y' else 'ies' end, p.amount, to_char(pday, 'DD Mon'));
    update public.payment_checks set status = 'confirmed', finished_at = now(), detail = why where id = c.id;
    r := public.payment_check_confirm(p.id, 'statement', why);
    return jsonb_build_object('confirmed', true, 'result', r, 'detail', why);
  elsif matches = 0 then
    why := format('The wallet''s statement (%s entries read) shows no Tk %s coming in on %s.', n_lines, p.amount, to_char(pday, 'DD Mon'));
  else
    why := format('The statement shows %s entr%s of Tk %s on %s but PayTrace holds %s payments of that amount that day, so one of them is not in the wallet.', matches, case when matches = 1 then 'y' else 'ies' end, p.amount, to_char(pday, 'DD Mon'), stored);
  end if;
  update public.payment_checks set status = 'not_confirmed', finished_at = now(), detail = why where id = c.id;
  return jsonb_build_object('confirmed', false, 'detail', why);
end $$;
revoke all on function public.payment_check_judge_statement(uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.payment_check_judge_statement(uuid, boolean, jsonb, text) to service_role;
