-- 073: a Taka job sends to ANY of our saved numbers (owner 2026-11-08: "it does not have to be rocket to rocket, their job is to
-- send money to our saved bKash / Nagad number"). Before, a wallet only got a number of its own type, so a Rocket wallet
-- with Taka chosen got no job at all (no Rocket number is saved). Now: our number of the same type if there is one, else a
-- bKash number, else a Nagad number, each used in turn. The phone is told which kind of number it is ('network' carries
-- "bKash"/"Nagad" for a Taka job; an older app ignores it) and the job text may say {to}.

create or replace function public.cashin_sync(p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.cashin_settings; r record; n record; rows int;
begin
  select * into s from public.cashin_settings where id;
  update public.cashin_jobs j set status = 'cancelled', checked_at = now(), note = 'switched'
   where j.device_id = p_device and j.status = 'open'
     and (not s.enabled
          or (select w.kind from public.wallet_job_of(j.device_id, j.provider) w) <> 'cashin'
          or coalesce((select b.balance - coalesce(f.reserved, 0)
                         from public.device_balances b
                         left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
                        where b.device_id = j.device_id and b.provider = j.provider), 0)
             < (select w.threshold from public.wallet_job_of(j.device_id, j.provider) w));
  if not s.enabled then return; end if;
  for r in
    select b.provider, b.balance, b.at
      from public.device_balances b
      join public.devices d on d.id = b.device_id and d.status = 'approved'
      left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
      cross join lateral public.wallet_job_of(b.device_id, b.provider) w
     where b.device_id = p_device and w.kind = 'cashin' and (b.balance - coalesce(f.reserved, 0)) >= w.threshold
       and not exists (select 1 from public.cashin_jobs j where j.device_id = b.device_id and j.provider = b.provider
                          and (j.status in ('open', 'checking', 'mismatch', 'review')
                               or (j.balance_at >= b.at and coalesce(j.note, '') <> 'switched')))
       and not exists (select 1 from public.job_transfers t where t.device_id = b.device_id and t.provider = b.provider and t.status in ('checking', 'mismatch'))
  loop
    -- Our number of the wallet's own type first, then bKash, then Nagad; within a type the least recently given.
    select id, number into n from public.cashin_numbers
     where enabled and (provider = r.provider or provider in ('bkash', 'nagad'))
     order by (provider = r.provider) desc, (provider = 'bkash') desc, last_assigned_at asc nulls first, created_at
     limit 1;
    if n.id is not null then
      insert into public.cashin_jobs (device_id, provider, number, balance, balance_at, urgency)
      values (p_device, r.provider, n.number, r.balance, r.at, s.urgency) on conflict do nothing;
      get diagnostics rows = row_count;
      if rows > 0 then update public.cashin_numbers set last_assigned_at = now() where id = n.id; end if;
    end if;
  end loop;
end $$;

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
           -- The kind of OUR number (bKash / Nagad ...): the app labels the box "Send to our bKash number".
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
               'attempts', t.attempts, 'submitted_at', t.submitted_at, 'resolved_at', t.checked_at, 'note', t.note) as item
        from public.job_transfers t
       where t.device_id = p_device and (t.status in ('checking', 'mismatch', 'review') or t.submitted_at > now() - interval '3 days')
      union all
      select c.submitted_at, jsonb_build_object(
               'kind', 'cashin', 'id', c.id, 'provider', c.provider, 'amount', c.amount, 'charge', c.commission, 'status', c.status,
               'attempts', c.attempts, 'submitted_at', c.submitted_at, 'resolved_at', c.checked_at, 'note', c.note, 'number', c.number)
        from public.cashin_jobs c
       where c.device_id = p_device and c.submitted_at is not null
         and (c.status in ('checking', 'mismatch', 'review') or c.submitted_at > now() - interval '3 days')
       order by 1 desc limit 12
    ) x;
  return jsonb_build_object('jobs', coalesce(v_jobs, '[]'::jsonb) || coalesce(v_cash, '[]'::jsonb), 'transfers', v_transfers);
end $$;

-- The job text: the old default spoke of cashing in to a number of the wallet's own type. Only replaced if it is still that default.
update public.cashin_settings
   set instruction = 'Send the money to our {to} number below (Cash In from your agent wallet, or any way you can), then tap "I did it" and type the amount you sent and the commission or charge.'
 where id and instruction = 'Cash in from your {provider} agent wallet to this personal number, then tap "I did it" and type the cash-in amount and your commission.';

-- The Jobs page: a Taka job needs one of our numbers of the same type, or any bKash / Nagad number.
create or replace function public.admin_wallet_jobs()
returns table (device_id uuid, provider text, balance numeric, balance_at timestamptz, own_money numeric,
               kind text, kind_own boolean, threshold numeric, threshold_own boolean, showing text, numbers int)
language sql stable security definer set search_path = public as $$
  with w as (
    select d.id as device_id, p.provider
      from public.devices d cross join (values ('bkash'), ('nagad'), ('rocket'), ('upay')) as p(provider)
     where d.status = 'approved' and public.is_admin()
       and (exists (select 1 from public.device_balances b where b.device_id = d.id and b.provider = p.provider)
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) x
                        where x->>'provider' = p.provider and coalesce(x->>'kind', 'agent') <> 'personal')
            or exists (select 1 from public.agent_jobs a where a.device_id = d.id and a.provider = p.provider)
            or exists (select 1 from public.device_wallets dw where dw.device_id = d.id and dw.provider = p.provider and dw.enabled))
  )
  select w.device_id, w.provider, b.balance, b.at, b.balance - coalesce(f.reserved, 0),
         j.kind, j.kind_own, j.threshold, j.threshold_own,
         case when exists (select 1 from public.device_open_jobs o where o.device_id = w.device_id and o.provider = w.provider) then 'crypto'
              when exists (select 1 from public.cashin_jobs c where c.device_id = w.device_id and c.provider = w.provider
                              and c.status in ('open', 'checking', 'mismatch', 'review')) then 'cashin' end,
         (select count(*)::int from public.cashin_numbers n where n.enabled and (n.provider = w.provider or n.provider in ('bkash', 'nagad')))
    from w
    left join public.device_balances b on b.device_id = w.device_id and b.provider = w.provider
    left join public.wallet_b2b_float f on f.device_id = w.device_id and f.provider = w.provider
    cross join lateral public.wallet_job_of(w.device_id, w.provider) j
   order by w.device_id, w.provider;
$$;
