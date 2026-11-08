-- 066: personal Send Money for payouts (owner 2026-11-08, from their recording of the personal bKash menu).
--
-- bKash personal menu (recorded): *247# -> "1.Send Money 2.Send Money to Non-bKash User ... 5.Cash Out ... 9.My bKash" -> 1
--   -> "Enter Receiver bKash Account No:" -> "... Enter Amount:" -> "... Enter Reference:"
--   -> "Send Money. To: 017XXXXXXXX Amount: Tk 850 Reference: a Enter Menu PIN to confirm:"
--   -> "Send Money Tk 850.00 to 017XXXXXXXX successful. Ref a. Fee Tk 10.00. Balance Tk ... TrxID ..."
-- A new command kind 'sendmoney' (the phone walks that menu from its PERSONAL account, its own SIM and PIN). Payouts from a
-- personal bKash account now go through it; Nagad personal still waits for a recording. Personal Send Money keeps the daily
-- limit (cashin_limits, 0 = off); an agent Cash In has none.
--
-- The two CHECK constraints on phone_commands that name the kinds are swapped in 066a, which the OWNER pastes into the SQL
-- editor (the MCP hangs on any statement that removes something). Until 066a is in, a personal payout is refused by the
-- database with a constraint error and nothing is sent.

insert into public.phone_command_kinds (kind, needs_wallet) values ('sendmoney', true) on conflict do nothing;

-- Phone answers that mean nothing was sent: free the transactions.
create or replace function public.payout_safe_error(p_error text) returns boolean language sql immutable as $$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused', 'personal_off', 'no_personal');
$$;

create or replace function public.create_payout(
  p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric,
  p_from_account text default 'agent', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices; v_num text; v_total numeric := 0; v_keep numeric; v_send numeric; v_why text; pid uuid;
  v_cmd uuid; v_payout uuid; n int; v_limit numeric; v_today numeric; v_kind text; v_method text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  n := coalesce(array_length(p_payments, 1), 0);
  if n = 0 then raise exception 'tick at least one transaction'; end if;
  if n > 200 then raise exception 'at most 200 transactions in one payout'; end if;
  if (select count(distinct x) from unnest(p_payments) x) <> n then raise exception 'a transaction is ticked twice'; end if;
  if p_keep_pct is null or p_keep_pct < 0 or p_keep_pct > 100 then raise exception 'the share you keep must be 0 to 100 percent'; end if;
  v_num := public.bd_number(p_to_number);
  if v_num is null then raise exception 'the receiving number must be a Bangladesh mobile number (11 digits starting 01)'; end if;
  if p_from_account not in ('agent', 'personal') then raise exception 'bad account'; end if;
  if p_from_account = 'personal' and p_provider <> 'bkash' then
    raise exception 'send_money_not_ready: sending from a personal % account is not built yet (it needs a recording of its Send Money menu)', p_provider;
  end if;
  if p_provider not in ('bkash', 'nagad') then raise exception 'only bKash and Nagad wallets can send'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'unknown phone'; end if;
  if not d.allow_cashin then raise exception 'sending money is switched off for that phone (Phones page, "What the dashboard may do")'; end if;
  if p_from_account = 'personal' then
    if not coalesce(d.allow_personal, false) then raise exception 'personal accounts are switched off for that phone (Phones page)'; end if;
    if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
                    where w->>'provider' = p_provider and w->>'kind' = 'personal') then
      raise exception 'that phone has no personal % account saved in its app yet', p_provider;
    end if;
  end if;
  v_kind := case when p_from_account = 'personal' then 'sendmoney' else 'cashin' end;
  v_method := case when p_from_account = 'personal' then 'send_money' else 'cash_in' end;

  -- One payout at a time, so two clicks cannot both take the same transaction.
  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  foreach pid in array p_payments loop
    v_why := public.payout_refusal(pid);
    if v_why is not null then raise exception 'transaction % cannot be paid out: %', (select trx_id from public.payments where id = pid), v_why; end if;
  end loop;
  select sum(amount) into v_total from public.payments where id = any(p_payments);
  select s.keep_amount, s.send_amount into v_keep, v_send from public.payout_split(v_total, p_keep_pct) s;
  if v_send < 100 then raise exception 'Tk % is under the Tk 100 one send can carry; tick more transactions together', v_send; end if;
  if v_send > 50000 then raise exception 'Tk % is over the Tk 50,000 one send can carry; tick fewer transactions', v_send; end if;
  -- Personal Send Money keeps a daily limit per phone (owner 2026-11-08); an agent Cash In has none.
  if v_kind = 'sendmoney' then
    select coalesce(daily_limit, 0) into v_limit from public.cashin_limits limit 1;
    if coalesce(v_limit, 0) <= 0 then raise exception 'personal Send Money is off: set its daily limit on the Jobs page first'; end if;
    select coalesce(sum(send_amount), 0) into v_today from public.payouts
     where device_id = p_device and method = 'send_money' and status in ('sending', 'paid', 'unsure')
       and (created_at at time zone 'Asia/Dhaka')::date = (now() at time zone 'Asia/Dhaka')::date;
    if v_today + v_send > v_limit then
      raise exception 'that would make Tk % sent by personal Send Money from this phone today, over the daily limit of Tk %', v_today + v_send, v_limit;
    end if;
  end if;

  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by)
    values (p_device, v_kind, p_provider, v_send, v_num, auth.uid()) returning id into v_cmd;
  exception when unique_violation then
    raise exception 'that phone is already sending from this wallet; wait for it to finish';
  end;
  insert into public.payouts (method, status, device_id, provider, from_account, to_number, total_amount, keep_pct, keep_amount, send_amount, command_id, note, created_by)
  values (v_method, 'sending', p_device, p_provider, p_from_account, v_num, v_total, round(p_keep_pct, 2), v_keep, v_send, v_cmd, left(p_note, 200), auth.uid())
  returning id into v_payout;
  insert into public.payout_items (payout_id, payment_id, amount)
  select v_payout, p.id, p.amount from public.payments p where p.id = any(p_payments);
  insert into public.events (kind, provider, detail) values ('payout_created', p_provider,
    jsonb_build_object('payout_id', v_payout, 'device_id', p_device, 'to', v_num, 'total', v_total, 'keep', v_keep, 'send', v_send, 'count', n, 'method', v_method, 'by', auth.uid()));
  return jsonb_build_object('payout_id', v_payout, 'command_id', v_cmd, 'device_id', p_device, 'total', v_total, 'keep', v_keep, 'send', v_send);
end $$;
revoke all on function public.create_payout(uuid[], uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.create_payout(uuid[], uuid, text, text, numeric, text, text) to authenticated;

-- bKash texts "Cash In Tk X to ... successful" for an agent cash-in and "Send Money Tk X to ... successful" for a personal
-- send: either settles a payout still sending or unsure.
create or replace function public.payouts_follow_sms() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_method text;
begin
  v_method := case coalesce(new.review_reason, '') when 'cash_in_sent' then 'cash_in' when 'send_money_sent' then 'send_money' else null end;
  if v_method is null or new.device_id is null then return new; end if;
  begin
    select o.id into v_id from public.payouts o
     where o.method = v_method and o.status in ('sending', 'unsure') and o.device_id = new.device_id and o.provider = new.provider
       and o.send_amount = new.amount and o.created_at > new.received_at - interval '30 minutes' and o.created_at <= new.received_at
     order by o.created_at limit 1;
    if v_id is not null then
      update public.payouts set status = 'paid', trx_id = coalesce(trx_id, left(new.trx_id, 24)), balance_after = coalesce(balance_after, new.balance), paid_at = coalesce(paid_at, now())
       where id = v_id;
      insert into public.events (kind, provider, detail, payment_id) values ('payout_paid_by_sms', new.provider, jsonb_build_object('payout_id', v_id), new.id);
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

create or replace function public.device_day_money(p_day date)
returns table (
  device_id uuid, provider text, account text, sim_slot smallint,
  cash_out_n int, cash_out numeric, cash_in_n int, cash_in numeric,
  b2b_in_n int, b2b_in numeric, b2b_out_n int, b2b_out numeric,
  received_n int, received numeric, sent_n int, sent numeric,
  held_n int, held numeric, unknown_sim_n int,
  from_sms int, from_statement int, from_paytrace int,
  gap_open_n int, gap_open numeric, checked boolean
) language sql stable security definer set search_path = public as $$
  with dev as (select id from public.devices where status = 'approved' and public.is_admin()),
  sms as (
    select p.device_id, p.provider, coalesce(public.wallet_account_of(p.device_id, p.provider, p.sim_slot), 'unknown') as account,
           public.payment_ledger_kind(p.txn_type, p.review_reason) as kind, p.amount as amt,
           (p.status = 'review' and not public.payment_counted(p.status, p.chain_status, p.txn_type, p.review_reason)) as held
      from public.payments p join dev on dev.id = p.device_id
     where p.source = 'app' and coalesce(p.review_reason, '') <> 'not_ours'
       and (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date = p_day
  ),
  sms_keys as (
    select device_id, provider, account, kind, amt, count(*)::int as n from sms where not held group by 1, 2, 3, 4, 5
  ),
  stmt as (
    select l.device_id, l.provider, 'agent'::text as account, public.ledger_kind(l.type, l.amount > 0) as kind, abs(l.amount) as amt, count(*)::int as n
      from public.statement_lines l join dev on dev.id = l.device_id
     where l.day = p_day group by 1, 2, 3, 4, 5
  ),
  cmd as (
    select c.device_id, c.provider,
           case when c.kind = 'sendmoney' then 'personal' else 'agent' end::text as account,
           case when c.kind = 'sendmoney' then 'send_money_out' else 'cash_in_sent' end::text as kind,
           c.amount as amt, count(*)::int as n
      from public.phone_commands c join dev on dev.id = c.device_id
     where c.kind in ('cashin', 'sendmoney') and c.status = 'done' and (c.finished_at at time zone 'Asia/Dhaka')::date = p_day
       and (c.trx_id is null or not exists (select 1 from public.payments x where x.provider = c.provider and x.trx_id = upper(c.trx_id)))
     group by 1, 2, 3, 4, 5
  ),
  keys as (
    select device_id, provider, account, kind, amt from sms_keys
    union select device_id, provider, account, kind, amt from stmt
    union select device_id, provider, account, kind, amt from cmd
  ),
  units as (
    select k.device_id, k.provider, k.account, k.kind, k.amt,
           coalesce(s.n, 0) as n_sms, coalesce(c.n, 0) as n_cmd,
           greatest(coalesce(t.n, 0) - coalesce(s.n, 0) - coalesce(c.n, 0), 0) as n_stmt
      from keys k
      left join sms_keys s on s.device_id = k.device_id and s.provider = k.provider and s.account = k.account and s.kind = k.kind and s.amt = k.amt
      left join stmt t on t.device_id = k.device_id and t.provider = k.provider and t.account = k.account and t.kind = k.kind and t.amt = k.amt
      left join cmd c on c.device_id = k.device_id and c.provider = k.provider and c.account = k.account and c.kind = k.kind and c.amt = k.amt
  ),
  agg as (
    select device_id, provider, account,
      sum(n_sms + n_cmd + n_stmt) filter (where kind = 'cash_out')::int as cash_out_n,
      sum((n_sms + n_cmd + n_stmt) * amt) filter (where kind = 'cash_out') as cash_out,
      sum(n_sms + n_cmd + n_stmt) filter (where kind = 'cash_in_sent')::int as cash_in_n,
      sum((n_sms + n_cmd + n_stmt) * amt) filter (where kind = 'cash_in_sent') as cash_in,
      sum(n_sms + n_cmd + n_stmt) filter (where kind = 'b2b_in')::int as b2b_in_n,
      sum((n_sms + n_cmd + n_stmt) * amt) filter (where kind = 'b2b_in') as b2b_in,
      sum(n_sms + n_cmd + n_stmt) filter (where kind = 'b2b_out')::int as b2b_out_n,
      sum((n_sms + n_cmd + n_stmt) * amt) filter (where kind = 'b2b_out') as b2b_out,
      sum(n_sms + n_cmd + n_stmt) filter (where kind in ('send_money_in', 'payment_in', 'cash_in_received'))::int as received_n,
      sum((n_sms + n_cmd + n_stmt) * amt) filter (where kind in ('send_money_in', 'payment_in', 'cash_in_received')) as received,
      sum(n_sms + n_cmd + n_stmt) filter (where kind in ('send_money_out', 'cash_out_sent', 'payment_sent', 'bill_paid', 'loan_repaid'))::int as sent_n,
      sum((n_sms + n_cmd + n_stmt) * amt) filter (where kind in ('send_money_out', 'cash_out_sent', 'payment_sent', 'bill_paid', 'loan_repaid')) as sent,
      sum(n_sms)::int as from_sms, sum(n_stmt)::int as from_statement, sum(n_cmd)::int as from_paytrace
      from units group by 1, 2, 3
  ),
  hold as (
    select device_id, provider, account, count(*)::int as held_n, sum(amt) as held from sms where held group by 1, 2, 3
  ),
  unk as (
    select device_id, provider, count(*)::int as n from sms where account = 'unknown' group by 1, 2
  ),
  gaps as (
    select g.device_id, g.provider, coalesce(public.wallet_account_of(g.device_id, g.provider, g.sim_slot), 'unknown') as account,
           count(*)::int as n, sum(g.amount) as amt
      from public.balance_gaps g join dev on dev.id = g.device_id
     where g.explained_by is null and (g.at at time zone 'Asia/Dhaka')::date = p_day
     group by 1, 2, 3
  ),
  rows_ as (
    select device_id, provider, account from agg
    union select device_id, provider, account from hold
    union select device_id, provider, account from gaps
  )
  select r.device_id, r.provider, r.account,
         (select (w->>'slot')::smallint from public.devices d2, jsonb_array_elements(case when jsonb_typeof(d2.info->'wallets') = 'array' then d2.info->'wallets' else '[]'::jsonb end) w
           where d2.id = r.device_id and w->>'provider' = r.provider and (w->>'slot') ~ '^[01]$'
             and (case when w->>'kind' = 'personal' then 'personal' else 'agent' end) = r.account limit 1),
         coalesce(a.cash_out_n, 0), coalesce(a.cash_out, 0), coalesce(a.cash_in_n, 0), coalesce(a.cash_in, 0),
         coalesce(a.b2b_in_n, 0), coalesce(a.b2b_in, 0), coalesce(a.b2b_out_n, 0), coalesce(a.b2b_out, 0),
         coalesce(a.received_n, 0), coalesce(a.received, 0), coalesce(a.sent_n, 0), coalesce(a.sent, 0),
         coalesce(h.held_n, 0), coalesce(h.held, 0),
         case when r.account = 'unknown' then coalesce(u.n, 0) else 0 end,
         coalesce(a.from_sms, 0), coalesce(a.from_statement, 0), coalesce(a.from_paytrace, 0),
         coalesce(g.n, 0), coalesce(g.amt, 0),
         p_day >= date '2026-11-08'
    from rows_ r
    left join agg a on a.device_id = r.device_id and a.provider = r.provider and a.account = r.account
    left join hold h on h.device_id = r.device_id and h.provider = r.provider and h.account = r.account
    left join unk u on u.device_id = r.device_id and u.provider = r.provider
    left join gaps g on g.device_id = r.device_id and g.provider = r.provider and g.account = r.account
   order by r.device_id, r.provider, r.account;
$$;
revoke all on function public.device_day_money(date) from public, anon;
grant execute on function public.device_day_money(date) to authenticated;
