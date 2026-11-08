-- 067: the Send Money fee comes off the payout, not off the owner (owner 2026-11-08: "the sent money charge should not be
-- on us, we should take it from payout").
--
-- bKash charges the SENDER of a personal Send Money a fee (Tk 10 on Tk 850 in the owner's recording; free to "Priyo"
-- numbers up to a monthly total, Tk 5 or Tk 10 above it), and it cannot be known before sending. So a fixed amount is
-- set aside (payout_settings.send_money_fee, default 10, set by the owner) and taken off what is sent; the receipt's
-- real fee is recorded as payouts.fee_actual (from the bKash SMS), so any difference shows on the payout. An agent
-- Cash In costs the agent nothing, so it sets nothing aside.

alter table public.payout_settings add column if not exists send_money_fee numeric(10, 2) not null default 10
  check (send_money_fee >= 0 and send_money_fee <= 500);
alter table public.payouts add column if not exists fee_reserved numeric(10, 2) not null default 0;
alter table public.payouts add column if not exists fee_actual numeric(10, 2);

create or replace function public.set_payout_send_fee(p_fee numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 500 then raise exception 'the Send Money fee to set aside must be 0 to 500 taka'; end if;
  update public.payout_settings set send_money_fee = round(p_fee, 2), updated_at = now(), updated_by = auth.uid() where id;
end $$;
revoke all on function public.set_payout_send_fee(numeric) from public, anon;
grant execute on function public.set_payout_send_fee(numeric) to authenticated;

create or replace function public.create_payout(
  p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric,
  p_from_account text default 'agent', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices; v_num text; v_total numeric := 0; v_keep numeric; v_send numeric; v_why text; pid uuid;
  v_cmd uuid; v_payout uuid; n int; v_limit numeric; v_today numeric; v_kind text; v_method text; v_fee numeric := 0;
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
  -- Personal Send Money: bKash charges the SENDER a fee, so it comes off what is sent, never off the owner's share
  -- (owner 2026-11-08). The real fee is only known from the receipt; this is the amount set aside for it.
  if v_kind = 'sendmoney' then
    select coalesce(send_money_fee, 0) into v_fee from public.payout_settings limit 1;
    v_send := floor(v_total - round(v_total * p_keep_pct / 100, 2) - v_fee);
    v_keep := round(v_total - v_send - v_fee, 2);
  end if;
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
  insert into public.payouts (method, status, device_id, provider, from_account, to_number, total_amount, keep_pct, keep_amount, send_amount, fee_reserved, command_id, note, created_by)
  values (v_method, 'sending', p_device, p_provider, p_from_account, v_num, v_total, round(p_keep_pct, 2), v_keep, v_send, v_fee, v_cmd, left(p_note, 200), auth.uid())
  returning id into v_payout;
  insert into public.payout_items (payout_id, payment_id, amount)
  select v_payout, p.id, p.amount from public.payments p where p.id = any(p_payments);
  insert into public.events (kind, provider, detail) values ('payout_created', p_provider,
    jsonb_build_object('payout_id', v_payout, 'device_id', p_device, 'to', v_num, 'total', v_total, 'keep', v_keep, 'send', v_send, 'count', n, 'method', v_method, 'fee', v_fee, 'by', auth.uid()));
  return jsonb_build_object('payout_id', v_payout, 'command_id', v_cmd, 'device_id', p_device, 'total', v_total, 'keep', v_keep, 'send', v_send, 'fee', v_fee);
end $$;
revoke all on function public.create_payout(uuid[], uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.create_payout(uuid[], uuid, text, text, numeric, text, text) to authenticated;

-- The bKash receipt SMS settles a payout still sending or unsure (as before) and, for a personal send, records the fee
-- bKash really charged, also on a payout the phone's own answer already marked paid (matched by TrxID).
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
    if v_method = 'send_money' then
      update public.payouts set fee_actual = new.fee
       where method = 'send_money' and fee_actual is null and device_id = new.device_id
         and (id = v_id or upper(trx_id) = upper(new.trx_id));
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
