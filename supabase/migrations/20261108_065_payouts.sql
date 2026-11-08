-- 065: payouts, personal accounts, and the phone card's day check (owner 2026-11-08).
--
-- 1. PAYOUTS. The owner ticks transactions on a new Payout page, keeps a share (20% by default, changeable each time),
--    and sends the rest to a number they TYPE or paste (not a saved list: owner's correction). An agent wallet sends by
--    Cash In, through the cash-in command that already works on real phones (7 real sends, Tk 89,300, before this).
--    A personal wallet will send by Send Money once that menu is recorded (refused for now, `send_money_not_ready`).
--    A transaction can be in only ONE live payout (unique index). A payout follows its phone command by trigger:
--    done = paid (with the wallet's TrxID), never-taken or a refusal known to happen before money moves = failed
--    (the transactions are free again), anything else (no answer after the PIN, a timeout while running) = UNSURE:
--    the transactions stay taken until the owner says whether the money went, or until the wallet's own "Cash In ...
--    successful" SMS (bKash) arrives and settles it by itself. That rule exists so nothing can be paid twice.
-- 2. LIMITS (owner's correction): agent Cash In has NO daily limit any more (queue_phone_command loses its check); the
--    daily limit (cashin_limits.daily_limit) is for personal Send Money only, checked when that is built.
-- 3. PERSONAL ACCOUNTS: devices.allow_personal (off by default), set on the dashboard; the phone shows its Personal
--    accounts section only while it is on, and reports each saved account with kind agent|personal. An agent and a
--    personal account of the same kind must be on different SIMs (the SMS never names the account).
--    wallet_account_of() tells which account an SMS belongs to; sim_of_wallet() and device_balances prefer the agent.
-- 4. THE DAY CHECK: device_day_money(day) = per phone, wallet and account, Cash Out / Cash In / B2B for an agent and
--    Received / Sent for a personal account, from the SMS, the wallet's statement and PayTrace's own cash-ins without
--    counting anything twice, plus the money the balance chain could not account for that day (open balance gaps).
--    balance_gap_record now counts PayTrace's own cash-ins (Nagad sends no SMS for them) before calling something a gap.
-- Nothing is removed here (the MCP hangs on removing statements).

-- ---------- 3. personal accounts ----------
alter table public.devices add column if not exists allow_personal boolean not null default false;

create or replace function public.set_device_personal(p_device uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.devices set allow_personal = coalesce(p_on, false) where id = p_device and status <> 'revoked';
  if not found then raise exception 'phone not found'; end if;
  insert into public.events (kind, detail) values ('phone_personal_set', jsonb_build_object('device_id', p_device, 'on', coalesce(p_on, false), 'by', auth.uid()));
end $$;
revoke all on function public.set_device_personal(uuid, boolean) from public, anon;
grant execute on function public.set_device_personal(uuid, boolean) to authenticated;

-- Which account of this phone an SMS belongs to: 'agent' | 'personal', or null when it cannot be told (two accounts of
-- that wallet on the phone and the SMS did not say which SIM). A phone with no wallet saved in the app counts as agent.
create or replace function public.wallet_account_of(p_device uuid, p_provider text, p_sim smallint)
returns text language sql stable security definer set search_path = public as $$
  with w as (
    select case when x->>'kind' = 'personal' then 'personal' else 'agent' end as kind, (x->>'slot')::smallint as slot
      from public.devices d,
           jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) x
     where d.id = p_device and x->>'provider' = p_provider and (x->>'slot') ~ '^[01]$'
  )
  select case
    when not exists (select 1 from w) then 'agent'
    when p_sim is not null then (select kind from w where slot = p_sim order by kind limit 1)
    when (select count(distinct kind) from w) = 1 then (select kind from w limit 1)
    else null end;
$$;
revoke all on function public.wallet_account_of(uuid, text, smallint) from public, anon;
grant execute on function public.wallet_account_of(uuid, text, smallint) to authenticated, service_role;

-- The agent's SIM first: statements, balance checks and jobs are the agent menu's.
create or replace function public.sim_of_wallet(p_device uuid, p_provider text)
returns smallint language sql stable security definer set search_path to 'public' as $$
  select (w->>'slot')::smallint
    from public.devices d, jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
   where d.id = p_device and w->>'provider' = p_provider and (w->>'slot') ~ '^[01]$'
   order by (w->>'kind' = 'personal') nulls first
   limit 1;
$$;

create or replace view public.device_balances as
select distinct on (p.device_id, p.provider) p.device_id, p.provider, p.balance, coalesce(p.occurred_at, p.received_at) as at
  from public.payments p
  left join public.devices d on d.id = p.device_id
 where p.source = 'app' and p.balance is not null and p.device_id is not null
   and coalesce(p.review_reason, '') <> 'not_ours'
 order by p.device_id, p.provider,
          (p.sim_slot is not null and exists (
             select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
              where w->>'provider' = p.provider and (w->>'slot') ~ '^[01]$' and (w->>'slot')::int = p.sim_slot
                and coalesce(w->>'kind', 'agent') <> 'personal')) desc,
          coalesce(p.occurred_at, p.received_at) desc, p.received_at desc;

-- A personal account's own Send Money (new SMS layout, ingest v48) is money out.
create or replace function public.payment_ledger_kind(p_txn_type text, p_reason text)
returns text language sql immutable as $$
  select case
    when p_txn_type = 'cash_out' then 'cash_out'
    when p_txn_type = 'send_money_received' then 'send_money_in'
    when p_txn_type = 'payment_received' then 'payment_in'
    when p_reason = 'b2b_received' then 'b2b_in'
    when p_reason = 'b2b_transfer_out' then 'b2b_out'
    when p_reason = 'cash_in_received' then 'cash_in_received'
    when p_reason = 'cash_in_sent' then 'cash_in_sent'
    when p_reason = 'cash_out_sent' then 'cash_out_sent'
    when p_reason = 'payment_sent' then 'payment_sent'
    when p_reason = 'send_money_sent' then 'send_money_out'
    when p_reason = 'bill_paid' then 'bill_paid'
    when p_reason = 'loan_repaid' then 'loan_repaid'
    else 'other_in' end;
$$;

-- ---------- 2. agent Cash In has no daily limit (owner 2026-11-08); the saved-number rule stays for this button ----------
create or replace function public.queue_phone_command(p_device uuid, p_kind text, p_provider text, p_amount numeric, p_to_number text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind <> 'cashin' then raise exception 'bad kind'; end if;
  if p_provider not in ('nagad', 'bkash') then raise exception 'bad wallet'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 50000 then raise exception 'the amount must be between 100 and 50,000'; end if;
  if p_to_number is null or p_to_number !~ '^01[0-9]{9}$' then raise exception 'bad number'; end if;
  if not exists (select 1 from public.cashin_numbers where provider = p_provider and number = p_to_number and enabled) then
    raise exception 'that number is not one of the saved cash-in numbers for this wallet';
  end if;
  if not exists (select 1 from public.devices where id = p_device and status = 'approved') then
    raise exception 'unknown phone';
  end if;
  perform public.phone_commands_tidy(p_device);
  insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by)
  values (p_device, 'cashin', p_provider, round(p_amount, 2), p_to_number, auth.uid())
  returning id into v_id;
  return v_id;
end $function$;

-- ---------- 1. payouts ----------
create table if not exists public.payout_settings (
  id boolean primary key default true check (id),
  keep_pct numeric(5, 2) not null default 20 check (keep_pct >= 0 and keep_pct <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.payout_settings (id) values (true) on conflict do nothing;
alter table public.payout_settings enable row level security;
grant select on public.payout_settings to authenticated;
create policy payout_settings_read on public.payout_settings for select to authenticated using (public.is_admin());

create or replace function public.set_payout_settings(p_keep_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_keep_pct is null or p_keep_pct < 0 or p_keep_pct > 100 then raise exception 'the share you keep must be 0 to 100 percent'; end if;
  update public.payout_settings set keep_pct = round(p_keep_pct, 2), updated_at = now(), updated_by = auth.uid() where id;
end $$;
revoke all on function public.set_payout_settings(numeric) from public, anon;
grant execute on function public.set_payout_settings(numeric) to authenticated;

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('cash_in', 'send_money', 'manual')),
  status text not null check (status in ('sending', 'paid', 'unsure', 'failed', 'cancelled')),
  device_id uuid references public.devices(id),
  provider text check (provider is null or provider in ('bkash', 'nagad', 'rocket', 'upay')),
  from_account text check (from_account is null or from_account in ('agent', 'personal')),
  to_number text check (to_number is null or to_number ~ '^01[0-9]{9}$'),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  keep_pct numeric(5, 2) not null check (keep_pct >= 0 and keep_pct <= 100),
  keep_amount numeric(14, 2) not null check (keep_amount >= 0),
  send_amount numeric(14, 2) not null check (send_amount >= 0),
  command_id uuid,
  trx_id text check (trx_id is null or trx_id ~ '^[A-Za-z0-9]{1,24}$'),
  balance_after numeric(14, 2),
  error text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz
);
create index if not exists payouts_created_idx on public.payouts (created_at desc);
create index if not exists payouts_command_idx on public.payouts (command_id) where command_id is not null;
create index if not exists payouts_device_idx on public.payouts (device_id);

create table if not exists public.payout_items (
  payout_id uuid not null references public.payouts(id),
  payment_id uuid not null references public.payments(id),
  amount numeric(14, 2) not null,
  live boolean not null default true,
  primary key (payout_id, payment_id)
);
-- The rule that matters most: a transaction can be in only one live payout.
create unique index if not exists payout_items_one_live on public.payout_items (payment_id) where live;
create index if not exists payout_items_payment_idx on public.payout_items (payment_id);

alter table public.payouts enable row level security;
alter table public.payout_items enable row level security;
grant select on public.payouts, public.payout_items to authenticated;
create policy payouts_read on public.payouts for select to authenticated using (public.is_admin());
create policy payout_items_read on public.payout_items for select to authenticated using (public.is_admin());

-- "+8801712345678", "8801712345678", "01712-345678" -> "01712345678"; anything else -> null.
create or replace function public.bd_number(p text) returns text language sql immutable as $$
  select case
    when d ~ '^01[0-9]{9}$' then d
    when d ~ '^8801[0-9]{9}$' then substr(d, 3)
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Why a payment cannot be paid out, or null when it can. Only money that came IN from someone (a customer's Cash Out,
-- a Send Money or payment received) and that counts as real (never a hold that may be fake, never "not yours").
create or replace function public.payout_refusal(p_payment uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.id is null then 'not found'
    when coalesce(p.review_reason, '') = 'not_ours' then 'not one of this phone''s wallets'
    when p.txn_type not in ('cash_out', 'send_money_received', 'payment_received') then 'not money received'
    when not public.payment_counted(p.status, p.chain_status, p.txn_type, p.review_reason) then 'held for review'
    when exists (select 1 from public.payout_items i where i.payment_id = p.id and i.live) then 'already paid out'
    else null end
  from (select 1) one left join public.payments p on p.id = p_payment;
$$;
revoke all on function public.payout_refusal(uuid) from public, anon;
grant execute on function public.payout_refusal(uuid) to authenticated, service_role;

-- Whole taka only: 80% of Tk 497 is sent as Tk 397.
create or replace function public.payout_split(p_total numeric, p_keep_pct numeric) returns table (keep_amount numeric, send_amount numeric)
language sql immutable as $$
  select round(p_total - floor(p_total - round(p_total * p_keep_pct / 100, 2)), 2), floor(p_total - round(p_total * p_keep_pct / 100, 2));
$$;

create or replace function public.create_payout(
  p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric,
  p_from_account text default 'agent', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices; v_num text; v_total numeric := 0; v_keep numeric; v_send numeric; v_why text; pid uuid;
  v_cmd uuid; v_payout uuid; n int;
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
  if p_from_account = 'personal' then raise exception 'send_money_not_ready: sending from a personal account (Send Money) is not built yet'; end if;
  if p_provider not in ('bkash', 'nagad') then raise exception 'only bKash and Nagad agent wallets can send a cash-in'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'unknown phone'; end if;
  if not d.allow_cashin then raise exception 'sending money is switched off for that phone (Phones page, "What the dashboard may do")'; end if;

  -- One payout at a time, so two clicks cannot both take the same transaction.
  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  foreach pid in array p_payments loop
    v_why := public.payout_refusal(pid);
    if v_why is not null then raise exception 'transaction % cannot be paid out: %', (select trx_id from public.payments where id = pid), v_why; end if;
  end loop;
  select sum(amount) into v_total from public.payments where id = any(p_payments);
  select s.keep_amount, s.send_amount into v_keep, v_send from public.payout_split(v_total, p_keep_pct) s;
  if v_send < 100 then raise exception 'Tk % is under the Tk 100 a cash-in can send; tick more transactions together', v_send; end if;
  if v_send > 50000 then raise exception 'Tk % is over the Tk 50,000 one cash-in can send; tick fewer transactions', v_send; end if;

  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by)
    values (p_device, 'cashin', p_provider, v_send, v_num, auth.uid()) returning id into v_cmd;
  exception when unique_violation then
    raise exception 'that phone is already sending a cash-in from this wallet; wait for it to finish';
  end;
  insert into public.payouts (method, status, device_id, provider, from_account, to_number, total_amount, keep_pct, keep_amount, send_amount, command_id, note, created_by)
  values ('cash_in', 'sending', p_device, p_provider, 'agent', v_num, v_total, round(p_keep_pct, 2), v_keep, v_send, v_cmd, left(p_note, 200), auth.uid())
  returning id into v_payout;
  insert into public.payout_items (payout_id, payment_id, amount)
  select v_payout, p.id, p.amount from public.payments p where p.id = any(p_payments);
  insert into public.events (kind, provider, detail) values ('payout_created', p_provider,
    jsonb_build_object('payout_id', v_payout, 'device_id', p_device, 'to', v_num, 'total', v_total, 'keep', v_keep, 'send', v_send, 'count', n, 'by', auth.uid()));
  return jsonb_build_object('payout_id', v_payout, 'command_id', v_cmd, 'device_id', p_device, 'total', v_total, 'keep', v_keep, 'send', v_send);
end $$;
revoke all on function public.create_payout(uuid[], uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.create_payout(uuid[], uuid, text, text, numeric, text, text) to authenticated;

-- Money paid outside PayTrace: recorded as paid at once. Number and TrxID are optional.
create or replace function public.manual_payout(p_payments uuid[], p_keep_pct numeric, p_to_number text default null, p_trx text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_num text := null; v_total numeric; v_keep numeric; v_send numeric; v_why text; pid uuid; v_payout uuid; n int; v_trx text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  n := coalesce(array_length(p_payments, 1), 0);
  if n = 0 then raise exception 'tick at least one transaction'; end if;
  if n > 200 then raise exception 'at most 200 transactions in one payout'; end if;
  if (select count(distinct x) from unnest(p_payments) x) <> n then raise exception 'a transaction is ticked twice'; end if;
  if p_keep_pct is null or p_keep_pct < 0 or p_keep_pct > 100 then raise exception 'the share you keep must be 0 to 100 percent'; end if;
  if nullif(trim(coalesce(p_to_number, '')), '') is not null then
    v_num := public.bd_number(p_to_number);
    if v_num is null then raise exception 'the receiving number must be a Bangladesh mobile number (11 digits starting 01)'; end if;
  end if;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  foreach pid in array p_payments loop
    v_why := public.payout_refusal(pid);
    if v_why is not null then raise exception 'transaction % cannot be paid out: %', (select trx_id from public.payments where id = pid), v_why; end if;
  end loop;
  select sum(amount) into v_total from public.payments where id = any(p_payments);
  select s.keep_amount, s.send_amount into v_keep, v_send from public.payout_split(v_total, p_keep_pct) s;
  insert into public.payouts (method, status, to_number, total_amount, keep_pct, keep_amount, send_amount, trx_id, note, created_by, paid_at, resolved_by, resolved_at)
  values ('manual', 'paid', v_num, v_total, round(p_keep_pct, 2), v_keep, v_send, left(v_trx, 24), left(p_note, 200), auth.uid(), now(), auth.uid(), now())
  returning id into v_payout;
  insert into public.payout_items (payout_id, payment_id, amount)
  select v_payout, p.id, p.amount from public.payments p where p.id = any(p_payments);
  insert into public.events (kind, detail) values ('payout_manual', jsonb_build_object('payout_id', v_payout, 'to', v_num, 'total', v_total, 'send', v_send, 'count', n, 'by', auth.uid()));
  return jsonb_build_object('payout_id', v_payout, 'total', v_total, 'keep', v_keep, 'send', v_send);
end $$;
revoke all on function public.manual_payout(uuid[], numeric, text, text, text) from public, anon;
grant execute on function public.manual_payout(uuid[], numeric, text, text, text) to authenticated;

-- The owner's word on an UNSURE payout (did the money go?), or undoing a payout recorded by hand.
create or replace function public.resolve_payout(p_payout uuid, p_sent boolean, p_trx text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.payouts; v_trx text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into o from public.payouts where id = p_payout for update;
  if o.id is null then raise exception 'no such payout'; end if;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if o.status = 'unsure' then
    if p_sent then
      update public.payouts set status = 'paid', trx_id = coalesce(left(v_trx, 24), trx_id), paid_at = now(), resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    else
      update public.payouts set status = 'failed', resolved_by = auth.uid(), resolved_at = now() where id = o.id;
      update public.payout_items set live = false where payout_id = o.id;
    end if;
  elsif o.status = 'paid' and o.method = 'manual' and not p_sent then
    update public.payouts set status = 'cancelled', resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    update public.payout_items set live = false where payout_id = o.id;
  else
    raise exception 'only an unsure payout, or one recorded by hand, can be changed';
  end if;
  insert into public.events (kind, detail) values ('payout_resolved', jsonb_build_object('payout_id', o.id, 'sent', p_sent, 'trx', v_trx, 'by', auth.uid()));
end $$;
revoke all on function public.resolve_payout(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_payout(uuid, boolean, text) to authenticated;

-- Errors the phone reports only when NO money can have moved (the PIN was never typed, or the wallet itself said no).
create or replace function public.payout_safe_error(p_error text) returns boolean language sql immutable as $$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused');
$$;

-- A payout follows its phone command. Never lets a problem here stop the command's own update.
create or replace function public.payouts_follow_command() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status or new.status not in ('done', 'failed', 'cancelled') then return new; end if;
  begin
    if new.status = 'done' then
      update public.payouts set status = 'paid', trx_id = coalesce(new.trx_id, trx_id), balance_after = new.balance, paid_at = coalesce(paid_at, now())
       where command_id = new.id and status in ('sending', 'unsure');
    elsif new.status = 'cancelled' or public.payout_safe_error(new.error) then
      update public.payouts set status = 'failed', error = coalesce(new.error, 'cancelled') where command_id = new.id and status = 'sending';
      update public.payout_items i set live = false from public.payouts o
       where o.id = i.payout_id and o.command_id = new.id and o.status = 'failed';
    else
      update public.payouts set status = 'unsure', error = coalesce(new.error, 'failed') where command_id = new.id and status = 'sending';
    end if;
  exception when others then
    insert into public.events (kind, detail) values ('payout_follow_failed', jsonb_build_object('command_id', new.id, 'error', left(sqlerrm, 200)));
  end;
  return new;
end $$;
create trigger payouts_follow_command after update of status on public.phone_commands
  for each row execute function public.payouts_follow_command();

-- bKash texts "Cash In Tk X to ... successful" for every agent cash-in: that settles a payout still sending or unsure.
create or replace function public.payouts_follow_sms() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(new.review_reason, '') <> 'cash_in_sent' or new.device_id is null then return new; end if;
  begin
    select o.id into v_id from public.payouts o
     where o.method = 'cash_in' and o.status in ('sending', 'unsure') and o.device_id = new.device_id and o.provider = new.provider
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
create trigger payouts_follow_sms after insert on public.payments
  for each row execute function public.payouts_follow_sms();

-- ---------- 4. balance gaps count PayTrace's own cash-ins (same body as 064, plus the "known" step) ----------
create or replace function public.balance_gap_record(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; prev record; d public.devices; kind text; signed numeric; expected numeric; tol numeric; gap numeric; known numeric := 0;
  gid uuid; cmd uuid; pull boolean := false; why text := null; can_pull boolean;
begin
  select * into p from public.payments where id = p_payment;
  if p.id is null or p.balance is null or p.device_id is null then return jsonb_build_object('gap', null, 'why', 'no balance or phone'); end if;
  if coalesce(p.review_reason, '') = 'not_ours' then return jsonb_build_object('gap', null, 'why', 'not our wallet'); end if;
  if p.chain_status is distinct from 'mismatch' then return jsonb_build_object('gap', null, 'why', 'chain not broken'); end if;
  if exists (select 1 from public.balance_gaps g where g.payment_id = p_payment) then return jsonb_build_object('gap', null, 'why', 'already recorded'); end if;
  select x.balance, coalesce(x.occurred_at, x.received_at) as at, x.received_at into prev
    from public.payments x
   where x.provider = p.provider and x.source = 'app' and x.balance is not null and x.device_id = p.device_id
     and x.id <> p.id
     and coalesce(x.review_reason, '') <> 'not_ours'
     and (p.sim_slot is null or x.sim_slot is null or x.sim_slot = p.sim_slot)
     and (coalesce(x.occurred_at, x.received_at), x.received_at) < (coalesce(p.occurred_at, p.received_at), p.received_at)
   order by coalesce(x.occurred_at, x.received_at) desc, x.received_at desc
   limit 1;
  if prev.balance is null then return jsonb_build_object('gap', null, 'why', 'first message of the wallet'); end if;
  kind := public.payment_ledger_kind(p.txn_type, p.review_reason);
  signed := case when public.ledger_is_out(kind) then -p.amount else p.amount end;
  expected := signed - coalesce(p.fee, 0) + coalesce(p.commission, 0);
  gap := round(p.balance - prev.balance - expected, 2);
  -- Cash-ins PayTrace itself made from this agent wallet between the two messages (Nagad sends no SMS for them; a bKash
  -- one has its own SMS and is skipped here because it is a stored message already).
  if coalesce(public.wallet_account_of(p.device_id, p.provider, p.sim_slot), 'agent') = 'agent' then
    select coalesce(sum(c.amount), 0) into known from public.phone_commands c
     where c.device_id = p.device_id and c.provider = p.provider and c.kind = 'cashin' and c.status = 'done'
       and c.finished_at > prev.received_at and c.finished_at <= p.received_at
       and (c.trx_id is null or not exists (select 1 from public.payments x where x.provider = c.provider and x.trx_id = upper(c.trx_id)));
    if known > 0 then
      -- The agent earns a small commission on a cash-in, so the balance falls by a little less than the amount.
      if abs(gap + known) <= 0.006 * known + 1 then return jsonb_build_object('gap', null, 'why', 'a cash-in PayTrace made'); end if;
      gap := round(gap + known, 2);
    end if;
  end if;
  tol := case when signed > 0 and coalesce(p.commission, 0) = 0 then greatest(0.02 * abs(p.amount), 1) else 0.01 end;
  if gap > -0.01 and gap <= tol then return jsonb_build_object('gap', null, 'why', 'within commission'); end if;
  if abs(gap) < 1 then return jsonb_build_object('gap', null, 'why', 'under one taka'); end if;
  insert into public.balance_gaps (device_id, provider, sim_slot, payment_id, at, prev_at, amount, tolerance, prev_balance, new_balance)
  values (p.device_id, p.provider, p.sim_slot, p.id, coalesce(p.occurred_at, p.received_at), prev.at, gap, tol, prev.balance, p.balance)
  returning id into gid;
  select * into d from public.devices where id = p.device_id;
  can_pull := p.provider in ('bkash', 'nagad') and d.status = 'approved' and d.allow_balance <> false
              and (select auto_pull from public.ledger_settings limit 1)
              and not exists (select 1 from public.events e where e.kind = 'statement_pull_auto' and e.provider = p.provider
                                 and e.detail->>'device_id' = p.device_id::text and e.detail->>'why' = 'gap'
                                 and e.at > now() - interval '10 minutes');
  if not can_pull then
    why := case when p.provider not in ('bkash', 'nagad') then 'no statement flow for this wallet'
                when d.status <> 'approved' then 'phone not approved'
                when d.allow_balance = false then 'balance checks are switched off for this phone'
                when not (select auto_pull from public.ledger_settings limit 1) then 'automatic statement pulls are off'
                else 'a statement was asked less than 10 minutes ago' end;
  else
    perform public.phone_commands_tidy(p.device_id);
    begin
      insert into public.phone_commands (device_id, kind, provider) values (p.device_id, 'statement', p.provider) returning id into cmd;
      insert into public.events (kind, provider, detail) values ('statement_pull_auto', p.provider,
        jsonb_build_object('device_id', p.device_id, 'hour', extract(hour from (now() at time zone 'Asia/Dhaka'))::int, 'why', 'gap', 'gap_id', gid));
      update public.balance_gaps set command_id = cmd where id = gid;
      pull := true;
    exception when unique_violation then
      why := 'a statement is already running on this phone';
    end;
  end if;
  insert into public.events (kind, provider, detail, payment_id) values ('balance_gap', p.provider,
    jsonb_build_object('device_id', p.device_id, 'gap_id', gid, 'amount', gap, 'known_cashins', known, 'prev_balance', prev.balance, 'balance', p.balance, 'pull', pull, 'why', why), p.id);
  perform public.balance_gap_explain(p.device_id, p.provider);
  return jsonb_build_object('gap', gid, 'amount', gap, 'pull', pull, 'why', why, 'device_id', p.device_id, 'command_id', cmd,
                            'explained', exists (select 1 from public.balance_gaps g where g.id = gid and g.explained_by is not null));
end $$;
revoke all on function public.balance_gap_record(uuid) from public, anon, authenticated;
grant execute on function public.balance_gap_record(uuid) to service_role;

-- ---------- 4. the phone card's day check ----------
-- Per phone, wallet and account for one Bangladesh day. Every money movement counted once: an SMS, a statement line the
-- SMS do not already account for, and a cash-in PayTrace made that left no SMS (counted as max(SMS + PayTrace, statement)
-- per day, kind and amount, because a statement lists both). Statement lines and PayTrace's cash-ins are the agent's.
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
    select c.device_id, c.provider, 'agent'::text as account, 'cash_in_sent'::text as kind, c.amount as amt, count(*)::int as n
      from public.phone_commands c join dev on dev.id = c.device_id
     where c.kind = 'cashin' and c.status = 'done' and (c.finished_at at time zone 'Asia/Dhaka')::date = p_day
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
