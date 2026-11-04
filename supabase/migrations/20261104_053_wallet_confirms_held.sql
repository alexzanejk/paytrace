-- 053: a payment the wallet itself confirms is never left held (owner 2026-11-04: "if a payment really happened there is
-- no reason to hold it, it can check the bKash/Nagad statement").
--
-- WHY: the balance-chain check holds a Cash Out whenever the printed balance does not follow the previous message. On an
-- agent wallet money also leaves through cash-ins and B2B sends that Nagad never texts about, so the chain broke on real
-- payments almost every time (769BDUZI and 769BZUGV on 2026-11-04: Tk 8,142 and Tk 4,858 left the Vivo's Nagad wallet
-- between two receipts with no SMS). The check is kept, because a forged SMS cannot know the balance, but a hold is now
-- a question PayTrace puts to the phone itself:
--   step 1, balance: the phone reads the wallet's live balance (the dashboard's own balance command). If it equals the
--     balance printed in the held SMS, and that SMS is the wallet's newest message, the SMS is genuine.
--   step 2, statement: otherwise the phone fetches the wallet's own statement; an entry on the same day for the same
--     amount, money IN, proves it. The count must cover every stored payment of that amount that day on that wallet,
--     so one real entry cannot vouch for two SMS.
-- A confirmed payment is released (confirmed_by says how) and goes through reconcile_payment like any other, which also
-- pays the order that was moved to review when the payment was held. Nothing here credits an order by itself.
-- The ingest function starts step 1 the moment it holds a payment, judges each answer when the phone reports it
-- (command_result), and messages the owner on Telegram either way. The Review page shows the state and has a button
-- to ask again. Phones must allow balance checks (devices.allow_balance), have the PIN saved and the screen unlocked.

alter table public.payments add column if not exists confirmed_by text
  check (confirmed_by is null or confirmed_by in ('balance', 'statement', 'owner'));
comment on column public.payments.confirmed_by is 'Set when a payment held for a balance-chain mismatch was proven real: by the wallet''s live balance, by its statement, or by the owner.';

create table if not exists public.payment_checks (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  step text not null check (step in ('balance', 'statement')),
  command_id uuid references public.phone_commands(id),
  status text not null default 'queued' check (status in ('queued', 'confirmed', 'not_confirmed', 'failed')),
  detail text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists payment_checks_payment_idx on public.payment_checks (payment_id, created_at desc);
create index if not exists payment_checks_command_idx on public.payment_checks (command_id);
alter table public.payment_checks enable row level security;
create policy payment_checks_read on public.payment_checks for select to authenticated using (is_admin());
grant select on public.payment_checks to authenticated;

-- ---------- start a step: queue the phone command and remember why ----------
create or replace function public.payment_check_start(p_payment uuid, p_step text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.payments; d public.devices; cmd uuid; chk uuid;
begin
  if p_step not in ('balance', 'statement') then return jsonb_build_object('error', 'bad_step'); end if;
  select * into p from public.payments where id = p_payment;
  if p.id is null then return jsonb_build_object('error', 'no_payment'); end if;
  if p.status <> 'review' or coalesce(p.review_reason, '') <> 'balance_chain_mismatch' then
    return jsonb_build_object('error', 'not_a_chain_hold');
  end if;
  if p.device_id is null then return jsonb_build_object('error', 'no_phone'); end if;
  if p.provider not in ('nagad', 'bkash') then return jsonb_build_object('error', 'no_flow'); end if; -- Rocket's menu is not known yet
  select * into d from public.devices where id = p.device_id;
  if d.id is null or d.status <> 'approved' then return jsonb_build_object('error', 'phone_not_approved'); end if;
  if d.allow_balance = false then return jsonb_build_object('error', 'balance_checks_off'); end if;
  perform public.phone_commands_tidy(p.device_id);
  begin
    insert into public.phone_commands (device_id, kind, provider) values (p.device_id, p_step, p.provider) returning id into cmd;
  exception when unique_violation then
    -- A command of that kind is already live on this phone (the owner's own, or another held payment's). Recorded, so
    -- Review can say so and offer "Check with the wallet" again once the phone is free.
    insert into public.payment_checks (payment_id, step, status, finished_at, detail)
      values (p.id, p_step, 'failed', now(), 'The phone was busy with another command. Ask again in a minute.');
    return jsonb_build_object('error', 'busy');
  end;
  insert into public.payment_checks (payment_id, step, command_id) values (p.id, p_step, cmd) returning id into chk;
  insert into public.events (kind, provider, payment_id, detail)
    values ('payment_check_started', p.provider, p.id, jsonb_build_object('step', p_step, 'command', cmd, 'device_id', p.device_id));
  return jsonb_build_object('check_id', chk, 'command_id', cmd, 'device_id', p.device_id, 'step', p_step);
end $$;
revoke all on function public.payment_check_start(uuid, text) from public, anon, authenticated;
grant execute on function public.payment_check_start(uuid, text) to service_role;

-- ---------- release a held payment the wallet confirmed, and match it ----------
create or replace function public.payment_check_confirm(p_payment uuid, p_how text, p_detail text)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if p_how not in ('balance', 'statement', 'owner') then raise exception 'bad how'; end if;
  select * into p from public.payments where id = p_payment for update;
  if p.id is null then return 'no_payment'; end if;
  if p.status <> 'review' or coalesce(p.review_reason, '') <> 'balance_chain_mismatch' then return p.status; end if;
  update public.payments
     set confirmed_by = p_how, review_reason = null,
         status = case when txn_type = 'cash_out' then 'tracked_only' else 'unmatched' end
   where id = p.id;
  update public.payment_checks set status = 'confirmed', finished_at = now(), detail = coalesce(detail, p_detail)
   where payment_id = p.id and status = 'queued';
  insert into public.events (kind, provider, payment_id, detail)
    values ('confirmed_by_wallet', p.provider, p.id, jsonb_build_object('how', p_how, 'detail', left(coalesce(p_detail, ''), 200)));
  return public.reconcile_payment(p.id);
end $$;
revoke all on function public.payment_check_start(uuid, text) from public, anon, authenticated;
revoke all on function public.payment_check_confirm(uuid, text, text) from public, anon, authenticated;
grant execute on function public.payment_check_confirm(uuid, text, text) to service_role;

-- ---------- step 1 judged: the live balance ----------
create or replace function public.payment_check_judge_balance(p_command uuid, p_ok boolean, p_balance numeric, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.payment_checks; p public.payments; newer int; why text; r text;
begin
  select * into c from public.payment_checks where command_id = p_command and status = 'queued' and step = 'balance' for update;
  if c.id is null then return jsonb_build_object('error', 'no_check'); end if;
  select * into p from public.payments where id = c.payment_id;
  if p_ok and p_balance is not null then
    select count(*) into newer from public.payments x
     where x.device_id = p.device_id and x.provider = p.provider and x.balance is not null and x.id <> p.id
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
  -- Not settled by the balance: ask for the statement.
  return jsonb_build_object('confirmed', false, 'detail', why, 'next', public.payment_check_start(p.id, 'statement'));
end $$;
revoke all on function public.payment_check_judge_balance(uuid, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.payment_check_judge_balance(uuid, boolean, numeric, text) to service_role;

-- ---------- step 2 judged: the statement ----------
-- p_lines: the entries the ingest function read from the screens, [{"day":"2026-11-04","amount":500.00,"in":true,"type":"Cash Out"}].
create or replace function public.payment_check_judge_statement(p_command uuid, p_ok boolean, p_lines jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.payment_checks; p public.payments; pday date; matches int := 0; stored int; why text; r text; n_lines int := 0;
begin
  select * into c from public.payment_checks where command_id = p_command and status = 'queued' and step = 'statement' for update;
  if c.id is null then return jsonb_build_object('error', 'no_check'); end if;
  select * into p from public.payments where id = c.payment_id;
  if not p_ok then
    why := 'The statement could not be fetched: ' || coalesce(nullif(p_error, ''), 'failed');
    update public.payment_checks set status = 'failed', finished_at = now(), detail = why where id = c.id;
    return jsonb_build_object('confirmed', false, 'detail', why);
  end if;
  pday := (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date;
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    select count(*), count(*) filter (where (l->>'in')::boolean and (l->>'day')::date = pday and abs((l->>'amount')::numeric - p.amount) < 0.005)
      into n_lines, matches
      from jsonb_array_elements(p_lines) l
     where l ? 'day' and l ? 'amount' and l ? 'in' and (l->>'day') ~ '^\d{4}-\d{2}-\d{2}$';
  end if;
  -- Every stored payment of that amount, that day, on that wallet needs its own statement entry (this one included).
  select count(*) into stored from public.payments x
   where x.device_id = p.device_id and x.provider = p.provider and x.status <> 'ignored'
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

-- ---------- the owner asks again from the Review page ----------
create or replace function public.recheck_payment(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return public.payment_check_start(p_payment, 'balance');
end $$;
revoke all on function public.recheck_payment(uuid) from public, anon;
grant execute on function public.recheck_payment(uuid) to authenticated;

-- ---------- reconcile_payment: a confirmed receipt passes the chain rule, and an order already moved to review is matched ----------
create or replace function public.reconcile_payment(p_payment_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  p public.payments; o public.orders;
  pay_digits text; ord_digits text; k int; ptime timestamptz; reason text;
begin
  select * into p from public.payments where id = p_payment_id;
  if not found then return 'no_payment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.provider || ':' || p.trx_id, 0));
  select * into p from public.payments where id = p_payment_id for update;
  if p.status not in ('unmatched','tracked_only') then return p.status; end if;

  -- The order that claimed this TrxID: open, moved to review when the payment was held, or closed by the clock less than a day ago.
  select * into o from public.orders
   where claimed_provider = p.provider and claimed_trx_id = p.trx_id
     and (status in ('pending', 'review') or (status = 'expired' and expires_at > now() - interval '24 hours'))
   order by (status = 'pending') desc, (status = 'review') desc, created_at limit 1 for update;
  if not found then return case when p.status = 'unmatched' then 'no_claim' else p.status end; end if;

  if p.txn_type = 'cash_out' and coalesce(o.wallet_method, '') <> 'cash_out' then return p.status; end if;

  ptime := coalesce(p.occurred_at, p.received_at);
  if p.txn_type = 'cash_out' then
    null;
  elsif p.txn_type not in ('payment_received','send_money_received') or coalesce(o.wallet_method, 'send_money') = 'cash_out' then
    reason := 'unsupported_type';
  end if;
  -- A broken chain holds a receipt unless the wallet itself (or the owner) has since confirmed it.
  if reason is null and p.txn_type = 'cash_out' and p.chain_status = 'mismatch' and p.confirmed_by is null then
    reason := 'balance_chain_mismatch';
  end if;
  if reason is null and p.amount <> o.expected_amount then
    reason := format('amount_mismatch: received %s expected %s', p.amount, o.expected_amount);
  end if;
  if reason is null and ptime > o.expires_at then
    reason := 'order_expired_before_payment';
  end if;
  if reason is null and p.occurred_at is not null and p.occurred_at < o.created_at - interval '5 minutes' then
    reason := 'paid_before_order';
  end if;
  if reason is null and o.device_id is not null and p.device_id is not null and p.device_id <> o.device_id then
    reason := 'wrong_phone';
  end if;
  if reason is null and o.customer_phone is not null and p.counterparty is not null then
    pay_digits := substring(p.counterparty from '(\d+)$');
    ord_digits := regexp_replace(o.customer_phone, '\D', '', 'g');
    k := least(coalesce(length(pay_digits), 0), 4);
    if k >= 3 and right(pay_digits, k) <> right(ord_digits, k) then
      reason := 'phone_mismatch';
    end if;
  end if;

  if reason is not null then
    update public.payments set status = 'review', review_reason = reason, order_id = null where id = p.id;
    update public.orders set status = 'review', notes = coalesce(notes || E'\n', '') || 'Held: ' || reason where id = o.id;
    insert into public.events(kind, provider, payment_id, order_id, detail)
      values ('review', p.provider, p.id, o.id, jsonb_build_object('reason', reason, 'was', o.status));
    return 'review';
  end if;

  update public.orders set status = 'paid', payment_id = p.id, paid_at = now() where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('matched', p.provider, p.id, o.id, jsonb_build_object('amount', p.amount, 'late', o.status = 'expired', 'confirmed_by', p.confirmed_by));
  return 'matched';
end $$;
revoke all on function public.reconcile_payment(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_payment(uuid) to service_role;
