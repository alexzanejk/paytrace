-- Partner commission (owner request 2026-10-23). People who provide bKash / Nagad / Rocket / Upay agent (Cash Out) and personal
-- (Send Money) accounts earn a commission on the daily total that comes through their phone. The owner sets the rate per phone,
-- per provider and per kind (cash_out | send_money); the phone's own PayTrace app can show the earnings. This is bookkeeping only:
-- PayTrace never moves money, the owner pays partners outside the system and records it here.
-- Counted exactly like the dashboard's money totals: a Bangladesh day (12:00 AM to 11:59 PM), statuses unmatched / matched /
-- tracked_only (held and ignored payments earn nothing until approved). Other message types (payment_received, unknown) earn nothing.
-- Nothing existing is changed; this file only adds. No statements that the Supabase MCP cannot run (see migration 014).

alter table public.devices add column if not exists show_earnings boolean not null default false;

create table public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  kind text not null check (kind in ('cash_out', 'send_money')),
  rate_pct numeric(5, 2) not null check (rate_pct >= 0 and rate_pct <= 100),
  effective_from date not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (device_id, provider, kind, effective_from)
);
create index commission_rates_device_idx on public.commission_rates (device_id, provider, kind, effective_from desc);

create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid,
  voided_at timestamptz
);
create index commission_payouts_device_idx on public.commission_payouts (device_id, paid_on desc);

alter table public.commission_rates enable row level security;
alter table public.commission_payouts enable row level security;
create policy commission_rates_read on public.commission_rates for select to authenticated using (public.is_admin());
create policy commission_payouts_read on public.commission_payouts for select to authenticated using (public.is_admin());
revoke all on public.commission_rates, public.commission_payouts from anon, authenticated;
grant select on public.commission_rates, public.commission_payouts to authenticated;

-- One row per Bangladesh day, phone, provider and kind: the day's total and the commission at the rate in force that day.
create view public.device_commission_daily with (security_invoker = true) as
select t.day, t.device_id, t.provider, t.kind, t.n, t.total, r.rate_pct,
       round(t.total * coalesce(r.rate_pct, 0) / 100, 2) as commission
  from (
    select day, device_id, provider,
           case txn_type when 'cash_out' then 'cash_out' else 'send_money' end as kind,
           sum(n)::int as n, sum(amount) as total
      from public.device_day_totals
     where device_id is not null
       and status in ('unmatched', 'matched', 'tracked_only')
       and txn_type in ('cash_out', 'send_money_received')
     group by 1, 2, 3, 4
  ) t
  left join lateral (
    select cr.rate_pct
      from public.commission_rates cr
     where cr.device_id = t.device_id and cr.provider = t.provider and cr.kind = t.kind and cr.effective_from <= t.day
     order by cr.effective_from desc
     limit 1
  ) r on true;

-- Earned, paid and still owed, per phone, over all time.
create view public.device_commission_balance with (security_invoker = true) as
select d.id as device_id,
       coalesce((select sum(c.commission) from public.device_commission_daily c where c.device_id = d.id), 0) as earned,
       coalesce((select sum(p.amount) from public.commission_payouts p where p.device_id = d.id and p.voided_at is null), 0) as paid
  from public.devices d
 where d.status <> 'revoked';

revoke all on public.device_commission_daily, public.device_commission_balance from anon;
grant select on public.device_commission_daily, public.device_commission_balance to authenticated;

-- Show or hide the Earnings card in this phone's own app.
create or replace function public.set_device_earnings_visible(p_device uuid, p_show boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.devices set show_earnings = coalesce(p_show, false) where id = p_device and status <> 'revoked';
  if not found then raise exception 'phone not found'; end if;
  insert into public.events(kind, detail) values ('earnings_visibility_set', jsonb_build_object('device_id', p_device, 'show', coalesce(p_show, false), 'by', auth.uid()));
end $$;
revoke all on function public.set_device_earnings_visible(uuid, boolean) from public, anon;
grant execute on function public.set_device_earnings_visible(uuid, boolean) to authenticated;

-- Save a phone's whole rate grid in one go. p_rates = [{"provider":"bkash","kind":"cash_out","rate":"4"}, ...]. The rates apply
-- from p_from (a Bangladesh date; default today) onwards; earlier days keep the rate they had.
create or replace function public.set_commission_rates(p_device uuid, p_from date, p_rates jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Dhaka')::date;
  d date := coalesce(p_from, (now() at time zone 'Asia/Dhaka')::date);
  r jsonb; prov text; kd text; txt text; pct numeric; n int := 0;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.devices where id = p_device and status <> 'revoked') then raise exception 'phone not found'; end if;
  if d < today - 400 or d > today + 60 then raise exception 'the start date is out of range'; end if;
  if p_rates is null or jsonb_typeof(p_rates) <> 'array' or jsonb_array_length(p_rates) = 0 or jsonb_array_length(p_rates) > 16 then
    raise exception 'send 1 to 16 rates';
  end if;
  for r in select e from jsonb_array_elements(p_rates) e loop
    prov := r->>'provider'; kd := r->>'kind'; txt := btrim(coalesce(r->>'rate', ''));
    if prov is null or prov not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'unknown provider'; end if;
    if kd is null or kd not in ('cash_out', 'send_money') then raise exception 'unknown kind'; end if;
    if txt !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' then raise exception 'a rate must be a number such as 4 or 4.5'; end if;
    pct := txt::numeric;
    if pct > 100 then raise exception 'a rate cannot be more than 100'; end if;
    insert into public.commission_rates(device_id, provider, kind, rate_pct, effective_from, created_by)
      values (p_device, prov, kd, pct, d, auth.uid())
      on conflict (device_id, provider, kind, effective_from)
      do update set rate_pct = excluded.rate_pct, created_by = auth.uid(), created_at = now();
    n := n + 1;
  end loop;
  insert into public.events(kind, detail) values ('commission_rates_set', jsonb_build_object('device_id', p_device, 'from', d, 'count', n, 'by', auth.uid()));
  return n;
end $$;
revoke all on function public.set_commission_rates(uuid, date, jsonb) from public, anon;
grant execute on function public.set_commission_rates(uuid, date, jsonb) to authenticated;

-- Record money the owner paid to a partner (outside PayTrace).
create or replace function public.add_commission_payout(p_device uuid, p_amount numeric, p_paid_on date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Dhaka')::date; pid uuid; nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.devices where id = p_device and status <> 'revoked') then raise exception 'phone not found'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'the amount must be more than 0'; end if;
  if p_paid_on is null or p_paid_on > today or p_paid_on < today - 800 then raise exception 'the payment date is out of range'; end if;
  if nt is not null and length(nt) > 200 then raise exception 'the note is too long (200 characters at most)'; end if;
  insert into public.commission_payouts(device_id, amount, paid_on, note, created_by)
    values (p_device, round(p_amount, 2), p_paid_on, nt, auth.uid()) returning id into pid;
  insert into public.events(kind, detail) values ('commission_payout_added', jsonb_build_object('device_id', p_device, 'payout_id', pid, 'amount', round(p_amount, 2), 'by', auth.uid()));
  return pid;
end $$;
revoke all on function public.add_commission_payout(uuid, numeric, date, text) from public, anon;
grant execute on function public.add_commission_payout(uuid, numeric, date, text) to authenticated;

-- A wrong entry is voided, never removed, so the history stays complete.
create or replace function public.void_commission_payout(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.commission_payouts set voided_at = now() where id = p_id and voided_at is null;
  if not found then raise exception 'payout not found or already voided'; end if;
  insert into public.events(kind, detail) values ('commission_payout_voided', jsonb_build_object('payout_id', p_id, 'by', auth.uid()));
end $$;
revoke all on function public.void_commission_payout(uuid) from public, anon;
grant execute on function public.void_commission_payout(uuid) to authenticated;

-- What a phone's own app shows (called by the ingest function with the phone's key already checked; service role only).
create or replace function public.device_earnings(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Dhaka')::date;
  month_start date := date_trunc('month', (now() at time zone 'Asia/Dhaka'))::date;
  v_show boolean; v_name text;
  v_today jsonb; v_month jsonb; v_days jsonb; v_rates jsonb; v_detail jsonb; v_earned numeric; v_paid numeric;
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

  select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'kind', kind, 'total', total, 'rate', rate_pct, 'commission', commission) order by provider, kind), '[]'::jsonb) into v_detail
    from public.device_commission_daily where device_id = p_device and day = today;

  select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'kind', kind, 'rate', rate_pct) order by provider, kind), '[]'::jsonb) into v_rates
    from (select distinct on (provider, kind) provider, kind, rate_pct
            from public.commission_rates where device_id = p_device and effective_from <= today
           order by provider, kind, effective_from desc) x;

  select coalesce(sum(commission), 0) into v_earned from public.device_commission_daily where device_id = p_device;
  select coalesce(sum(amount), 0) into v_paid from public.commission_payouts where device_id = p_device and voided_at is null;

  return jsonb_build_object('enabled', true, 'name', v_name, 'day', today, 'today', v_today, 'today_detail', v_detail, 'month', v_month,
    'days', v_days, 'rates', v_rates, 'earned', v_earned, 'paid', v_paid, 'owed', v_earned - v_paid);
end $$;
revoke all on function public.device_earnings(uuid) from public, anon, authenticated;
grant execute on function public.device_earnings(uuid) to service_role;
