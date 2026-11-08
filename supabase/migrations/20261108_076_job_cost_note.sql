-- 076: the partner can say what the job cost them, and why (owner 2026-11-08: "there is only a commission box on job submit, but
-- what if he has a cost, like SADIKUR did for a fund transfer; they need to put the cost amount and a note of what cost what, so we
-- get the full picture").
--
-- SADIKUR's Rocket job: Cash In from the agent wallet to his own account (commission +134.37), then a fund transfer that cost him
-- money, then the send to our number. The commission box could hold only one figure. Now every submission (and the one fix) also
-- carries `cost` (Tk, 0 = none) and `cost_note` (what it was for, up to 200 characters).
--
-- The cost is for the owner to read. It does NOT change the automatic check: that check is about the AGENT wallet's balance, and a
-- cost like a fund-transfer fee is paid from the partner's own account, not from the agent wallet. If a cost did come out of the
-- agent wallet the check shows it as "off by" and the owner decides with Accept / Reject, as before.
--
-- New six-argument versions of the four phone functions; the four-argument ones stay (an older app build sends no cost) and the new
-- ones call them, then write the cost. No DROP or DELETE (the Supabase MCP hangs on them).

alter table public.cashin_jobs add column if not exists cost numeric(14, 2) not null default 0 check (cost >= 0 and cost <= 1000000);
alter table public.cashin_jobs add column if not exists cost_note text check (cost_note is null or char_length(cost_note) <= 200);
alter table public.job_transfers add column if not exists cost numeric(14, 2) not null default 0 check (cost >= 0 and cost <= 1000000);
alter table public.job_transfers add column if not exists cost_note text check (cost_note is null or char_length(cost_note) <= 200);

-- The note as stored: control characters out, spaces squeezed, at most 200 characters, empty = null.
create or replace function public.job_cost_note(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 200), '');
$$;

create or replace function public.device_cashin_sent(p_device uuid, p_provider text, p_amount numeric, p_commission numeric, p_cost numeric, p_cost_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; c numeric := coalesce(p_cost, 0);
begin
  if c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_cost'); end if;
  r := public.device_cashin_sent(p_device, p_provider, p_amount, p_commission);
  if (r ->> 'ok')::boolean then
    update public.cashin_jobs set cost = round(c, 2), cost_note = public.job_cost_note(p_cost_note) where id = (r ->> 'id')::uuid;
  end if;
  return r;
end $$;

create or replace function public.device_cashin_fix(p_device uuid, p_id uuid, p_amount numeric, p_commission numeric, p_cost numeric, p_cost_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; c numeric := coalesce(p_cost, 0);
begin
  if c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_cost'); end if;
  r := public.device_cashin_fix(p_device, p_id, p_amount, p_commission);
  if (r ->> 'ok')::boolean then
    update public.cashin_jobs set cost = round(c, 2), cost_note = public.job_cost_note(p_cost_note) where id = p_id and device_id = p_device;
  end if;
  return r;
end $$;

create or replace function public.device_job_sent(p_device uuid, p_provider text, p_amount numeric, p_charge numeric, p_cost numeric, p_cost_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; c numeric := coalesce(p_cost, 0);
begin
  if c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_cost'); end if;
  r := public.device_job_sent(p_device, p_provider, p_amount, p_charge);
  if (r ->> 'ok')::boolean then
    update public.job_transfers set cost = round(c, 2), cost_note = public.job_cost_note(p_cost_note) where id = (r ->> 'id')::uuid;
  end if;
  return r;
end $$;

create or replace function public.device_job_fix(p_device uuid, p_id uuid, p_amount numeric, p_charge numeric, p_cost numeric, p_cost_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; c numeric := coalesce(p_cost, 0);
begin
  if c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_cost'); end if;
  r := public.device_job_fix(p_device, p_id, p_amount, p_charge);
  if (r ->> 'ok')::boolean then
    update public.job_transfers set cost = round(c, 2), cost_note = public.job_cost_note(p_cost_note) where id = p_id and device_id = p_device;
  end if;
  return r;
end $$;

revoke all on function public.job_cost_note(text) from public, anon, authenticated;
revoke all on function public.device_cashin_sent(uuid, text, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.device_cashin_fix(uuid, uuid, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.device_job_sent(uuid, text, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.device_job_fix(uuid, uuid, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.job_cost_note(text) to service_role;
grant execute on function public.device_cashin_sent(uuid, text, numeric, numeric, numeric, text) to service_role;
grant execute on function public.device_cashin_fix(uuid, uuid, numeric, numeric, numeric, text) to service_role;
grant execute on function public.device_job_sent(uuid, text, numeric, numeric, numeric, text) to service_role;
grant execute on function public.device_job_fix(uuid, uuid, numeric, numeric, numeric, text) to service_role;

-- The phone's list: the partner's own submissions now carry the cost and its note (075 + two fields).
create or replace function public.device_jobs(p_device uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb;
  v_cash jsonb;
  v_transfers jsonb;
  s public.cashin_settings;
  names constant jsonb := '{"bkash":"bKash","nagad":"Nagad","rocket":"Rocket","upay":"Upay"}'::jsonb;
begin
  begin
    perform public.cashin_sync(p_device);
  exception when others then
    null;
  end;
  begin
    perform public.crypto_job_sync(p_device);
  exception when others then
    null;
  end;
  select * into s from public.cashin_settings where id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'send',
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
           'kind', 'cashin',
           'id', c.id,
           'provider', c.provider,
           'agent', coalesce(nullif(d.name, ''), d.pair_code),
           'urgency', c.urgency,
           'balance', c.balance,
           'balance_at', c.balance_at,
           'threshold', w.threshold,
           'wallet', c.number,
           'network', coalesce(names ->> np.provider, ''),
           'instruction', replace(replace(replace(replace(replace(s.instruction, '{agent}', coalesce(nullif(d.name, ''), d.pair_code)),
                                  '{provider}', coalesce(names ->> c.provider, c.provider)),
                                  '{balance}', 'Tk ' || to_char(c.balance, 'FM999,999,999,990.00')),
                                  '{number}', c.number),
                                  '{to}', coalesce(names ->> np.provider, 'our'))
         ) order by case c.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, c.balance desc), '[]'::jsonb)
    into v_cash
    from public.cashin_jobs c join public.devices d on d.id = c.device_id
    cross join lateral public.wallet_job_of(c.device_id, c.provider) w
    left join lateral (select n.provider from public.cashin_numbers n where n.number = c.number
                        order by (n.provider = c.provider) desc, n.enabled desc limit 1) np on true
   where c.device_id = p_device and c.status = 'open';
  select coalesce(jsonb_agg(x.item order by x.at desc), '[]'::jsonb) into v_transfers
    from (
      select t.submitted_at as at, jsonb_build_object(
               'kind', 'send', 'id', t.id, 'provider', t.provider, 'amount', t.amount, 'charge', t.charge, 'status', t.status,
               'attempts', t.attempts, 'submitted_at', t.submitted_at, 'resolved_at', t.checked_at, 'note', t.note,
               'cost', t.cost, 'cost_note', t.cost_note) as item
        from public.job_transfers t
       where t.device_id = p_device and (t.status in ('checking', 'mismatch', 'review') or t.submitted_at > now() - interval '3 days')
      union all
      select c.submitted_at, jsonb_build_object(
               'kind', 'cashin', 'id', c.id, 'provider', c.provider, 'amount', c.amount, 'charge', c.commission, 'status', c.status,
               'attempts', c.attempts, 'submitted_at', c.submitted_at, 'resolved_at', c.checked_at, 'note', c.note, 'number', c.number,
               'cost', c.cost, 'cost_note', c.cost_note)
        from public.cashin_jobs c
       where c.device_id = p_device and c.submitted_at is not null
         and (c.status in ('checking', 'mismatch', 'review') or c.submitted_at > now() - interval '3 days')
       order by 1 desc limit 12
    ) x;
  return jsonb_build_object('jobs', coalesce(v_jobs, '[]'::jsonb) || coalesce(v_cash, '[]'::jsonb), 'transfers', v_transfers);
end $$;
