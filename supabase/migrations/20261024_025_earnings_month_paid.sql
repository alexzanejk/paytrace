-- Phone app: a cleaner Earnings screen (owner request 2026-10-24).
--  * device_earnings also returns the whole month (day 1 to the last day, with a row for every day), what was paid in the last 3 days
--    (payments the owner recorded, not voided), and what was paid this month. "owed" is unchanged: everything earned minus everything paid.
--  * device_jobs returns only the sends that still matter: waiting or needing a decision always; verified ones for 3 hours; rejected ones
--    for 12 hours. So a finished or rejected send no longer sits on the phone's Home screen.
-- Same function names and arguments (create or replace); nothing is dropped.

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
  select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'total', coalesce(s.total, 0), 'commission', coalesce(s.commission, 0)) order by g.day desc), '[]'::jsonb) into v_month_days
    from (select d::date as day from generate_series(month_start, month_end, interval '1 day') d) g
    left join (select day, sum(total) as total, sum(commission) as commission
                 from public.device_commission_daily where device_id = p_device and day >= month_start and day <= month_end group by day) s on s.day = g.day;

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

create or replace function public.device_jobs(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb;
  v_transfers jsonb;
  names constant jsonb := '{"bkash":"bKash","nagad":"Nagad","rocket":"Rocket","upay":"Upay"}'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', j.provider,
           'agent', j.agent_name,
           'urgency', j.urgency,
           'balance', j.balance,
           'balance_at', j.balance_at,
           'threshold', j.threshold,
           'wallet', j.wallet,
           'network', j.network,
           'instruction', replace(replace(replace(j.instruction, '{agent}', j.agent_name), '{provider}', coalesce(names ->> j.provider, j.provider)),
                                  '{balance}', 'Tk ' || to_char(j.balance, 'FM999,999,999,990.00'))
         ) order by case j.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, j.balance desc), '[]'::jsonb)
    into v_jobs
    from public.device_open_jobs j
   where j.device_id = p_device;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'provider', x.provider, 'amount', x.amount, 'charge', x.charge, 'status', x.status,
           'attempts', x.attempts, 'submitted_at', x.submitted_at) order by x.submitted_at desc), '[]'::jsonb)
    into v_transfers
    from (select * from public.job_transfers t
           where t.device_id = p_device
             and (t.status in ('checking', 'mismatch', 'review')
                  or (t.status = 'verified' and coalesce(t.checked_at, t.submitted_at) > now() - interval '3 hours')
                  or (t.status = 'rejected' and coalesce(t.checked_at, t.submitted_at) > now() - interval '12 hours'))
           order by t.submitted_at desc limit 8) x;
  return jsonb_build_object('jobs', v_jobs, 'transfers', v_transfers);
end $$;
revoke all on function public.device_jobs(uuid) from public, anon, authenticated;
grant execute on function public.device_jobs(uuid) to service_role;
