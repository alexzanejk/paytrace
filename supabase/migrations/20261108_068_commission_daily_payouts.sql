-- 068: daily commission payouts (owner 2026-11-08).
--
-- A partner earns commission on their agent Cash Out only (personal accounts are all the owner's, so Send Money earns
-- nothing). Each phone's commission for one Bangladesh day (12:00 AM to 11:59 PM) becomes DUE once the day is over, and
-- is paid one of three ways, to the number the OWNER saved for that partner on the dashboard (never set from the app):
--   * Send Money from one of the owner's personal bKash accounts: the bKash fee comes off the commission;
--   * Cash In from the partner's own agent wallet (same phone): no charge; it stays a normal Cash In in the phone totals;
--   * marked paid by hand (any due day; TrxID and note optional).
-- Whole taka is sent; the paisa left over carries to the partner's next payment. A day can be in only one live payment.
-- Lump sums recorded earlier (commission_payouts without a pay) are applied to the oldest unpaid finished days first.

-- ---------- 1. commission comes from agent Cash Out only ----------
create or replace view public.device_commission_daily as
select t.day, t.device_id, t.provider, t.kind, t.n, t.total, r.rate_pct,
       round(t.total * coalesce(r.rate_pct, 0) / 100, 2) as commission
  from (
    select day, device_id, provider, 'cash_out'::text as kind, sum(n)::int as n, sum(amount) as total
      from public.device_day_totals
     where device_id is not null and counted and txn_type = 'cash_out'
     group by 1, 2, 3, 4
  ) t
  left join lateral (
    select cr.rate_pct
      from public.commission_rates cr
     where cr.device_id = t.device_id and cr.provider = t.provider and cr.kind = t.kind and cr.effective_from <= t.day
     order by cr.effective_from desc
     limit 1
  ) r on true;

-- ---------- 2. where a partner's commission goes (owner-set, dashboard only) ----------
alter table public.devices add column if not exists commission_number text
  check (commission_number is null or commission_number ~ '^01[0-9]{9}$');

create or replace function public.set_commission_number(p_device uuid, p_number text)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if nullif(trim(coalesce(p_number, '')), '') is null then v := null;
  else
    v := public.bd_number(p_number);
    if v is null then raise exception 'the number must be a Bangladesh mobile number (11 digits starting 01)'; end if;
  end if;
  update public.devices set commission_number = v where id = p_device;
  if not found then raise exception 'unknown phone'; end if;
  insert into public.events (kind, detail) values ('commission_number_set', jsonb_build_object('device_id', p_device, 'number', v, 'by', auth.uid()));
  return v;
end $$;
revoke all on function public.set_commission_number(uuid, text) from public, anon;
grant execute on function public.set_commission_number(uuid, text) to authenticated;

-- ---------- 3. payments of commission days ----------
create table if not exists public.commission_pays (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  method text not null check (method in ('cash_in', 'send_money', 'manual')),
  status text not null check (status in ('sending', 'paid', 'unsure', 'failed', 'cancelled')),
  from_device_id uuid references public.devices(id),
  provider text check (provider is null or provider in ('bkash', 'nagad')),
  to_number text check (to_number is null or to_number ~ '^01[0-9]{9}$'),
  days_amount numeric(14, 2) not null check (days_amount >= 0),
  carry_in numeric(14, 2) not null default 0,
  fee_reserved numeric(10, 2) not null default 0,
  send_amount numeric(14, 2) not null default 0,
  carry_out numeric(14, 2) not null default 0,
  fee_actual numeric(10, 2),
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
create index if not exists commission_pays_device_idx on public.commission_pays (device_id, created_at desc);
create index if not exists commission_pays_command_idx on public.commission_pays (command_id) where command_id is not null;
create index if not exists commission_pays_from_idx on public.commission_pays (from_device_id);

create table if not exists public.commission_pay_days (
  pay_id uuid not null references public.commission_pays(id),
  device_id uuid not null references public.devices(id),
  day date not null,
  amount numeric(14, 2) not null,
  live boolean not null default true,
  primary key (pay_id, day)
);
-- The rule that matters most: a day of one partner is in at most one live payment.
create unique index if not exists commission_pay_days_one_live on public.commission_pay_days (device_id, day) where live;

alter table public.commission_payouts add column if not exists pay_id uuid references public.commission_pays(id);
create index if not exists commission_payouts_pay_idx on public.commission_payouts (pay_id) where pay_id is not null;

alter table public.commission_pays enable row level security;
alter table public.commission_pay_days enable row level security;
grant select on public.commission_pays, public.commission_pay_days to authenticated;
create policy commission_pays_read on public.commission_pays for select to authenticated using (public.is_admin());
create policy commission_pay_days_read on public.commission_pay_days for select to authenticated using (public.is_admin());

-- ---------- 4. every partner day and where it stands ----------
-- state: running (today or later), paid / sending / unsure (a live day payment), paid_before (fully covered by a lump sum
-- recorded earlier, oldest days first), part (partly covered), due. due = what is still owed for that day.
create or replace function public.commission_day_rows(p_device uuid)
returns table (device_id uuid, day date, commission numeric, pay_id uuid, pay_status text, lump numeric, due numeric, state text)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Dhaka')::date as td),
  days as (
    select c.device_id, c.day, round(sum(c.commission), 2) as commission
      from public.device_commission_daily c
     where (p_device is null or c.device_id = p_device)
     group by 1, 2 having sum(c.commission) > 0
  ),
  explicit as (
    select pd.device_id, pd.day, pd.pay_id, p.status
      from public.commission_pay_days pd join public.commission_pays p on p.id = pd.pay_id
     where pd.live and (p_device is null or pd.device_id = p_device)
  ),
  lumps as (
    select cp.device_id, sum(cp.amount) as amt from public.commission_payouts cp
     where cp.voided_at is null and cp.pay_id is null and (p_device is null or cp.device_id = p_device)
     group by 1
  ),
  open_days as (
    select d.device_id, d.day, d.commission,
           sum(d.commission) over (partition by d.device_id order by d.day rows between unbounded preceding and current row) as running
      from days d, today t
     where d.day < t.td and not exists (select 1 from explicit e where e.device_id = d.device_id and e.day = d.day)
  ),
  judged as (
    select d.device_id, d.day, d.commission, e.pay_id, e.status as pay_status,
           case when o.day is null then 0
                else least(d.commission, greatest(coalesce(l.amt, 0) - (o.running - d.commission), 0)) end as lump,
           (d.day >= (select td from today)) as running_day
      from days d
      left join explicit e on e.device_id = d.device_id and e.day = d.day
      left join open_days o on o.device_id = d.device_id and o.day = d.day
      left join lumps l on l.device_id = d.device_id
  )
  select device_id, day, commission, pay_id, pay_status, round(lump, 2),
         case when running_day or pay_id is not null then 0 else round(commission - lump, 2) end,
         case when running_day then 'running'
              when pay_id is not null then pay_status
              when lump >= commission then 'paid_before'
              when lump > 0 then 'part'
              else 'due' end
    from judged;
$$;
revoke all on function public.commission_day_rows(uuid) from public, anon, authenticated;
grant execute on function public.commission_day_rows(uuid) to service_role;

-- The dashboard's read: every partner's days from p_from on (the lump-sum allocation still runs over all history).
create or replace function public.commission_days(p_from date)
returns table (device_id uuid, day date, commission numeric, pay_id uuid, pay_status text, lump numeric, due numeric, state text)
language sql stable security definer set search_path = public as $$
  select r.* from public.commission_day_rows(null) r where public.is_admin() and r.day >= p_from order by r.device_id, r.day desc;
$$;
revoke all on function public.commission_days(date) from public, anon;
grant execute on function public.commission_days(date) to authenticated;

-- Paisa a partner is still owed from earlier whole-taka payments (live payments only, so a failed one gives its carry back).
create or replace function public.commission_carry(p_device uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(carry_out - carry_in), 0) from public.commission_pays
   where device_id = p_device and status in ('sending', 'paid', 'unsure');
$$;
revoke all on function public.commission_carry(uuid) from public, anon, authenticated;

-- Taka sent today by personal Send Money from one phone, for payouts and commission alike (the one daily limit).
create or replace function public.personal_sent_today(p_device uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(send_amount) from public.payouts
                    where device_id = p_device and method = 'send_money' and status in ('sending', 'paid', 'unsure')
                      and (created_at at time zone 'Asia/Dhaka')::date = (now() at time zone 'Asia/Dhaka')::date), 0)
       + coalesce((select sum(send_amount) from public.commission_pays
                    where from_device_id = p_device and method = 'send_money' and status in ('sending', 'paid', 'unsure')
                      and (created_at at time zone 'Asia/Dhaka')::date = (now() at time zone 'Asia/Dhaka')::date), 0);
$$;
revoke all on function public.personal_sent_today(uuid) from public, anon, authenticated;

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
    v_today := public.personal_sent_today(p_device);
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


-- Marks a commission payment paid once and records it where the partner's app counts payments (commission_payouts).
create or replace function public.commission_pay_settle(p_pay uuid, p_trx text, p_balance numeric)
returns void language plpgsql security definer set search_path = public as $$
declare o public.commission_pays; v_days text;
begin
  select * into o from public.commission_pays where id = p_pay for update;
  if o.id is null or o.status not in ('sending', 'unsure', 'paid') then return; end if;
  update public.commission_pays set status = 'paid', trx_id = coalesce(trx_id, left(p_trx, 24)), balance_after = coalesce(balance_after, p_balance),
         paid_at = coalesce(paid_at, now()) where id = o.id;
  if not exists (select 1 from public.commission_payouts where pay_id = o.id and voided_at is null) then
    select string_agg(to_char(day, 'DD Mon'), ', ' order by day) into v_days from public.commission_pay_days where pay_id = o.id;
    insert into public.commission_payouts (device_id, amount, paid_on, note, created_by, pay_id)
    values (o.device_id, round(o.days_amount + o.carry_in - o.carry_out, 2), (now() at time zone 'Asia/Dhaka')::date,
            left('Commission for ' || coalesce(v_days, '?') || case o.method when 'cash_in' then ' (Cash In)' when 'send_money' then ' (Send Money)' else '' end, 200),
            o.created_by, o.id);
  end if;
end $$;
revoke all on function public.commission_pay_settle(uuid, text, numeric) from public, anon, authenticated;

-- Checks shared by both ways of paying: the days, their due amounts and the carry. Raises in plain words.
create or replace function public.commission_pay_check(p_device uuid, p_days date[], out v_due numeric, out v_carry numeric)
language plpgsql security definer set search_path = public as $$
declare n int; d date; r record; today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  n := coalesce(array_length(p_days, 1), 0);
  if n = 0 then raise exception 'tick at least one day'; end if;
  if n > 62 then raise exception 'at most 62 days in one payment'; end if;
  if (select count(distinct x) from unnest(p_days) x) <> n then raise exception 'a day is ticked twice'; end if;
  v_due := 0;
  foreach d in array p_days loop
    if d >= today then raise exception '% is not over yet: a day can be paid after 11:59 PM', to_char(d, 'DD Mon'); end if;
    select * into r from public.commission_day_rows(p_device) x where x.day = d;
    if r.day is null then raise exception 'no commission on %', to_char(d, 'DD Mon'); end if;
    if r.pay_id is not null then raise exception '% is already in a payment (%)', to_char(d, 'DD Mon'), r.pay_status; end if;
    if r.due <= 0 then raise exception '% is already paid', to_char(d, 'DD Mon'); end if;
    v_due := v_due + r.due;
  end loop;
  v_carry := public.commission_carry(p_device);
end $$;
revoke all on function public.commission_pay_check(uuid, date[]) from public, anon, authenticated;

-- Pay due days through a phone: 'cash_in' from the partner's own agent wallet, or 'send_money' from a personal bKash.
create or replace function public.create_commission_pay(p_device uuid, p_days date[], p_method text, p_from_device uuid, p_provider text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices; f public.devices; v_due numeric; v_carry numeric; v_total numeric; v_fee numeric := 0; v_send numeric;
  v_limit numeric; v_kind text; v_cmd uuid; v_pay uuid; dd date;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_method not in ('cash_in', 'send_money') then raise exception 'bad method'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null then raise exception 'unknown phone'; end if;
  if d.commission_number is null then raise exception 'save the number this partner''s commission goes to first (Phones page, Partner commission)'; end if;
  if p_provider not in ('bkash', 'nagad') then raise exception 'only bKash and Nagad can send'; end if;
  if p_method = 'cash_in' and p_from_device <> p_device then raise exception 'a Cash In payment comes from the partner''s own phone'; end if;
  if p_method = 'send_money' and p_provider <> 'bkash' then raise exception 'send_money_not_ready: Send Money is only built for a personal bKash account'; end if;
  select * into f from public.devices where id = p_from_device;
  if f.id is null or f.status <> 'approved' then raise exception 'the sending phone is not approved'; end if;
  if not f.allow_cashin then raise exception 'sending money is switched off for the sending phone (Phones page, "What the dashboard may do")'; end if;
  if p_method = 'send_money' then
    if not coalesce(f.allow_personal, false) then raise exception 'personal accounts are switched off for the sending phone'; end if;
    if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(f.info->'wallets') = 'array' then f.info->'wallets' else '[]'::jsonb end) w
                    where w->>'provider' = 'bkash' and w->>'kind' = 'personal') then
      raise exception 'the sending phone has no personal bKash account saved in its app yet';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('paytrace:commission:' || p_device::text));
  select x.v_due, x.v_carry into v_due, v_carry from public.commission_pay_check(p_device, p_days) x;
  v_total := v_due + v_carry;
  if p_method = 'send_money' then select coalesce(send_money_fee, 0) into v_fee from public.payout_settings limit 1; end if;
  v_send := floor(v_total - v_fee);
  if v_send < 100 then raise exception 'Tk % is under the Tk 100 one send can carry; tick more days together, or mark it paid by hand', greatest(v_send, 0); end if;
  if v_send > 50000 then raise exception 'Tk % is over the Tk 50,000 one send can carry; tick fewer days', v_send; end if;
  if p_method = 'send_money' then
    select coalesce(daily_limit, 0) into v_limit from public.cashin_limits limit 1;
    if coalesce(v_limit, 0) <= 0 then raise exception 'personal Send Money is off: set its daily limit on the Jobs page first'; end if;
    if public.personal_sent_today(p_from_device) + v_send > v_limit then
      raise exception 'that would go over today''s personal Send Money limit of Tk % on the sending phone', v_limit;
    end if;
  end if;

  v_kind := case p_method when 'send_money' then 'sendmoney' else 'cashin' end;
  perform public.phone_commands_tidy(p_from_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by)
    values (p_from_device, v_kind, p_provider, v_send, d.commission_number, auth.uid()) returning id into v_cmd;
  exception when unique_violation then
    raise exception 'that phone is already sending from this wallet; wait for it to finish';
  end;
  insert into public.commission_pays (device_id, method, status, from_device_id, provider, to_number, days_amount, carry_in, fee_reserved, send_amount, carry_out, command_id, note, created_by)
  values (p_device, p_method, 'sending', p_from_device, p_provider, d.commission_number, v_due, v_carry, v_fee, v_send,
          round(v_total - v_fee - v_send, 2), v_cmd, left(p_note, 200), auth.uid())
  returning id into v_pay;
  foreach dd in array p_days loop
    insert into public.commission_pay_days (pay_id, device_id, day, amount)
    select v_pay, p_device, dd, r.due from public.commission_day_rows(p_device) r where r.day = dd;
  end loop;
  insert into public.events (kind, provider, detail) values ('commission_pay_created', p_provider,
    jsonb_build_object('pay_id', v_pay, 'device_id', p_device, 'from', p_from_device, 'method', p_method, 'days', to_jsonb(p_days),
                       'due', v_due, 'carry', v_carry, 'fee', v_fee, 'send', v_send, 'by', auth.uid()));
  return jsonb_build_object('pay_id', v_pay, 'command_id', v_cmd, 'from_device', p_from_device, 'due', v_due, 'carry', v_carry, 'fee', v_fee, 'send', v_send);
end $$;
revoke all on function public.create_commission_pay(uuid, date[], text, uuid, text, text) from public, anon;
grant execute on function public.create_commission_pay(uuid, date[], text, uuid, text, text) to authenticated;

-- Paid outside PayTrace: the days are marked paid at once (the paisa carried so far is settled with them).
create or replace function public.manual_commission_pay(p_device uuid, p_days date[], p_trx text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_due numeric; v_carry numeric; v_pay uuid; dd date; v_trx text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.devices where id = p_device) then raise exception 'unknown phone'; end if;
  perform pg_advisory_xact_lock(hashtext('paytrace:commission:' || p_device::text));
  select x.v_due, x.v_carry into v_due, v_carry from public.commission_pay_check(p_device, p_days) x;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  insert into public.commission_pays (device_id, method, status, days_amount, carry_in, send_amount, carry_out, trx_id, note, created_by, resolved_by, resolved_at)
  values (p_device, 'manual', 'sending', v_due, v_carry, round(v_due + v_carry, 2), 0, left(v_trx, 24), left(p_note, 200), auth.uid(), auth.uid(), now())
  returning id into v_pay;
  foreach dd in array p_days loop
    insert into public.commission_pay_days (pay_id, device_id, day, amount)
    select v_pay, p_device, dd, r.due from public.commission_day_rows(p_device) r where r.day = dd;
  end loop;
  perform public.commission_pay_settle(v_pay, v_trx, null);
  insert into public.events (kind, detail) values ('commission_pay_manual',
    jsonb_build_object('pay_id', v_pay, 'device_id', p_device, 'days', to_jsonb(p_days), 'due', v_due, 'carry', v_carry, 'by', auth.uid()));
  return jsonb_build_object('pay_id', v_pay, 'due', v_due, 'carry', v_carry);
end $$;
revoke all on function public.manual_commission_pay(uuid, date[], text, text) from public, anon;
grant execute on function public.manual_commission_pay(uuid, date[], text, text) to authenticated;

-- The owner's word on an unsure payment (did the money go?), or undoing one marked paid by hand.
create or replace function public.resolve_commission_pay(p_pay uuid, p_sent boolean, p_trx text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.commission_pays; v_trx text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into o from public.commission_pays where id = p_pay for update;
  if o.id is null then raise exception 'no such payment'; end if;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if o.status = 'unsure' and p_sent then
    update public.commission_pays set resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    perform public.commission_pay_settle(o.id, v_trx, null);
  elsif o.status = 'unsure' then
    update public.commission_pays set status = 'failed', resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    update public.commission_pay_days set live = false where pay_id = o.id;
  elsif o.status = 'paid' and o.method = 'manual' and not p_sent then
    update public.commission_pays set status = 'cancelled', resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    update public.commission_pay_days set live = false where pay_id = o.id;
    update public.commission_payouts set voided_at = now() where pay_id = o.id and voided_at is null;
  else
    raise exception 'only an unsure payment, or one marked paid by hand, can be changed';
  end if;
  insert into public.events (kind, detail) values ('commission_pay_resolved', jsonb_build_object('pay_id', o.id, 'sent', p_sent, 'trx', v_trx, 'by', auth.uid()));
end $$;
revoke all on function public.resolve_commission_pay(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_commission_pay(uuid, boolean, text) to authenticated;

-- A commission payment follows its phone command, the same way a payout does. Never stops the command's own update.
create or replace function public.commission_pays_follow_command() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.status is not distinct from old.status or new.status not in ('done', 'failed', 'cancelled') then return new; end if;
  begin
    select id into v_id from public.commission_pays where command_id = new.id and status in ('sending', 'unsure');
    if v_id is null then return new; end if;
    if new.status = 'done' then
      perform public.commission_pay_settle(v_id, new.trx_id, new.balance);
    elsif new.status = 'cancelled' or public.payout_safe_error(new.error) then
      update public.commission_pays set status = 'failed', error = coalesce(new.error, 'cancelled') where id = v_id and status = 'sending';
      update public.commission_pay_days set live = false where pay_id = v_id and exists (select 1 from public.commission_pays where id = v_id and status = 'failed');
    else
      update public.commission_pays set status = 'unsure', error = coalesce(new.error, 'failed') where id = v_id and status = 'sending';
    end if;
  exception when others then
    insert into public.events (kind, detail) values ('commission_pay_follow_failed', jsonb_build_object('command_id', new.id, 'error', left(sqlerrm, 200)));
  end;
  return new;
end $$;
create trigger commission_pays_follow_command after update of status on public.phone_commands
  for each row execute function public.commission_pays_follow_command();

-- The wallet's own receipt SMS settles a commission payment still sending or unsure, and records the real Send Money fee.
-- Named to run AFTER payouts_follow_sms (same event, triggers fire in name order) and skips an SMS a payout already took.
create or replace function public.commission_pays_follow_sms() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_method text;
begin
  v_method := case coalesce(new.review_reason, '') when 'cash_in_sent' then 'cash_in' when 'send_money_sent' then 'send_money' else null end;
  if v_method is null or new.device_id is null then return new; end if;
  begin
    if exists (select 1 from public.payouts where upper(trx_id) = upper(new.trx_id)) then return new; end if;
    select o.id into v_id from public.commission_pays o
     where o.method = v_method and o.status in ('sending', 'unsure') and o.from_device_id = new.device_id and o.provider = new.provider
       and o.send_amount = new.amount and o.created_at > new.received_at - interval '30 minutes' and o.created_at <= new.received_at
     order by o.created_at limit 1;
    if v_id is not null then perform public.commission_pay_settle(v_id, new.trx_id, new.balance); end if;
    if v_method = 'send_money' then
      update public.commission_pays set fee_actual = new.fee
       where method = 'send_money' and fee_actual is null and from_device_id = new.device_id and (id = v_id or upper(trx_id) = upper(new.trx_id));
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
create trigger zz_commission_pays_follow_sms after insert on public.payments
  for each row execute function public.commission_pays_follow_sms();

-- ---------- 5. the partner's app: each day of the month says whether it is paid ----------
create or replace function public.device_earnings(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Dhaka')::date;
  month_start date := date_trunc('month', (now() at time zone 'Asia/Dhaka'))::date;
  month_end date := (date_trunc('month', (now() at time zone 'Asia/Dhaka')) + interval '1 month - 1 day')::date;
  v_show boolean; v_name text;
  v_today jsonb; v_month jsonb; v_days jsonb; v_rates jsonb; v_detail jsonb; v_earned numeric; v_paid numeric;
  v_month_days jsonb; v_recent_paid jsonb; v_paid_month numeric;
begin
  select show_earnings, name into v_show, v_name from public.devices where id = p_device and status = 'approved';
  if v_show is null or not v_show then return jsonb_build_object('enabled', false); end if;

  select jsonb_build_object('total', coalesce(sum(total), 0), 'commission', coalesce(sum(commission), 0)) into v_today
    from public.device_commission_daily where device_id = p_device and day = today;
  select jsonb_build_object('total', coalesce(sum(total), 0), 'commission', coalesce(sum(commission), 0)) into v_month
    from public.device_commission_daily where device_id = p_device and day >= month_start and day <= today;

  select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'total', coalesce(s.total, 0), 'commission', coalesce(s.commission, 0)) order by g.day desc), '[]'::jsonb) into v_days
    from (select (today - i) as day from generate_series(0, 6) i) g
    left join (select day, sum(total) as total, sum(commission) as commission
                 from public.device_commission_daily where device_id = p_device and day >= today - 6 and day <= today group by day) s on s.day = g.day;

  -- every day of this month, 1st to last
  -- each day also says whether it is paid (migration 068): paid / sending / due / running / none
  select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'total', coalesce(s.total, 0), 'commission', coalesce(s.commission, 0),
           'state', coalesce(r.state, case when g.day >= today then 'running' else 'none' end)) order by g.day desc), '[]'::jsonb) into v_month_days
    from (select d::date as day from generate_series(month_start, month_end, interval '1 day') d) g
    left join (select day, sum(total) as total, sum(commission) as commission
                 from public.device_commission_daily where device_id = p_device and day >= month_start and day <= month_end group by day) s on s.day = g.day
    left join public.commission_day_rows(p_device) r on r.day = g.day;

  select coalesce(jsonb_agg(jsonb_build_object('day', paid_on, 'amount', amount, 'note', note) order by paid_on desc, created_at desc), '[]'::jsonb) into v_recent_paid
    from public.commission_payouts where device_id = p_device and voided_at is null and paid_on >= today - 2;
  select coalesce(sum(amount), 0) into v_paid_month
    from public.commission_payouts where device_id = p_device and voided_at is null and paid_on >= month_start and paid_on <= month_end;

  select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'kind', kind, 'total', total, 'rate', rate_pct, 'commission', commission) order by provider, kind), '[]'::jsonb) into v_detail
    from public.device_commission_daily where device_id = p_device and day = today;

  select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'kind', kind, 'rate', rate_pct) order by provider, kind), '[]'::jsonb) into v_rates
    from (select distinct on (provider, kind) provider, kind, rate_pct
            from public.commission_rates where device_id = p_device and effective_from <= today
           order by provider, kind, effective_from desc) x;

  select coalesce(sum(commission), 0) into v_earned from public.device_commission_daily where device_id = p_device;
  select coalesce(sum(amount), 0) into v_paid from public.commission_payouts where device_id = p_device and voided_at is null;

  return jsonb_build_object('enabled', true, 'name', v_name, 'day', today, 'today', v_today, 'today_detail', v_detail, 'month', v_month,
    'days', v_days, 'rates', v_rates, 'earned', v_earned, 'paid', v_paid, 'owed', v_earned - v_paid,
    'month_start', month_start, 'month_end', month_end, 'month_days', v_month_days, 'recent_paid', v_recent_paid, 'paid_month', v_paid_month);
end $$;
revoke all on function public.device_earnings(uuid) from public, anon, authenticated;
grant execute on function public.device_earnings(uuid) to service_role;
