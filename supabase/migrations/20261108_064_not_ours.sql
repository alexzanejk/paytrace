-- 064: a wallet that is not set up in the PayTrace app on that phone is not ours (owner 2026-11-08: "if we dont set a
-- account on paytrace app it just not ours").
--
-- WHY: a phone forwards every bKash / Nagad / Rocket SMS it receives, and PayTrace filed each under "that phone's bKash
-- wallet" and so on. Rubel's phone also carries a personal Nagad, SADIKUR's a personal bKash, and a phone can hold two
-- accounts of the same wallet on two SIMs (rubel's two bKash). Their messages were counted in totals, set balances,
-- broke the balance chain and could start a job. From now on a message is OURS only when the app on that phone has a
-- saved wallet of that kind and, when the SMS says which SIM it arrived on, a saved wallet in that SIM. Everything else
-- is stored for the record as status ignored, reason not_ours, and is left out of totals, balances, the ledger, the
-- chain, gaps, jobs and the checks. A phone with NO wallet saved in the app is left exactly as before (the rule cannot
-- tell what is ours there), so the OnePlus and the Xiaomi 22101316I lose nothing until they are set up.
-- No DROP, no DELETE.

-- ---------- the rule ----------
create or replace function public.wallet_is_ours(p_device uuid, p_provider text, p_sim smallint)
returns boolean language sql stable security definer set search_path = public as $$
  with w as (
    select x->>'provider' as provider, (x->>'slot')::smallint as slot
      from public.devices d,
           jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) x
     where d.id = p_device and (x->>'slot') ~ '^[01]$'
  )
  select case
    when p_device is null then true
    when not exists (select 1 from w) then true                           -- nothing set up: rule not applied
    when not exists (select 1 from w where w.provider = p_provider) then false
    when p_sim is null then true                                           -- the SMS did not say which SIM
    else exists (select 1 from w where w.provider = p_provider and w.slot = p_sim)
  end;
$$;
revoke all on function public.wallet_is_ours(uuid, text, smallint) from public, anon;
grant execute on function public.wallet_is_ours(uuid, text, smallint) to authenticated, service_role;

-- ---------- balances never come from a wallet that is not ours ----------
create or replace view public.device_balances as
select distinct on (p.device_id, p.provider) p.device_id, p.provider, p.balance, coalesce(p.occurred_at, p.received_at) as at
  from public.payments p
  left join public.devices d on d.id = p.device_id
 where p.source = 'app' and p.balance is not null and p.device_id is not null
   and coalesce(p.review_reason, '') <> 'not_ours'
 order by p.device_id, p.provider,
          (p.sim_slot is not null and exists (
             select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
              where w->>'provider' = p.provider and (w->>'slot') ~ '^[01]$' and (w->>'slot')::int = p.sim_slot)) desc,
          coalesce(p.occurred_at, p.received_at) desc, p.received_at desc;

create or replace view public.device_sim_balances with (security_invoker = true) as
select distinct on (device_id, provider, sim_slot) device_id, provider, sim_slot, balance, coalesce(occurred_at, received_at) as at
  from public.payments
 where source = 'app' and balance is not null and device_id is not null and coalesce(review_reason, '') <> 'not_ours'
 order by device_id, provider, sim_slot, coalesce(occurred_at, received_at) desc, received_at desc;

-- ---------- the chain, the gaps and the ledger skip them too ----------
create or replace function public.balance_chain_check(
  p_provider text, p_at timestamptz, p_balance numeric, p_amount numeric, p_fee numeric, p_commission numeric, p_device uuid, p_sim smallint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
    and coalesce(review_reason, '') <> 'not_ours'
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

create or replace function public.wallet_ledger_rows(p_device uuid, p_provider text, p_from date, p_to date)
returns table (
  sort_at timestamptz, exact_time boolean, day date, kind text, label text, amount numeric, balance numeric,
  trx_id text, status text, review_reason text, chain_status text, source text, raw text, payment_id uuid,
  sim_slot smallint, counterparty text
) language sql stable security definer set search_path = public as $$
  with w as (select public.sim_of_wallet(p_device, p_provider) as sim),
  p as (
    select x.id, coalesce(x.occurred_at, x.received_at) as at,
           (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date as day,
           public.payment_ledger_kind(x.txn_type, x.review_reason) as kind,
           x.amount as abs_amount, x.balance, x.trx_id, x.status, x.review_reason, x.chain_status, x.raw_message, x.sim_slot, x.counterparty
      from public.payments x, w
     where x.device_id = p_device and x.provider = p_provider and x.source = 'app'
       and coalesce(x.review_reason, '') <> 'not_ours'
       and (w.sim is null or x.sim_slot is null or x.sim_slot = w.sim)
       and (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date between p_from and p_to
  ),
  ps as (
    select p.*, case when public.ledger_is_out(p.kind) then -p.abs_amount else p.abs_amount end as signed,
           row_number() over (partition by p.day, p.kind, p.abs_amount order by p.at desc) as rn
      from p
  ),
  pc as (select ps.day, ps.kind, ps.abs_amount, count(*) as n from ps group by 1, 2, 3),
  s as (
    select l.day, l.type, l.amount, l.occ, l.list_pos, l.sim_slot, public.ledger_kind(l.type, l.amount > 0) as kind, abs(l.amount) as abs_amount,
           c.created_at as pull_at
      from public.statement_lines l left join public.phone_commands c on c.id = l.command_id
     where l.device_id = p_device and l.provider = p_provider and l.day between p_from and p_to
  ),
  ss as (
    select s.*, row_number() over (partition by s.day, s.kind, s.abs_amount order by s.occ) as rn,
           row_number() over (order by s.pull_at nulls first, s.list_pos desc) as seq
      from s
  ),
  sm as (
    select ss.*, (ss.rn <= coalesce(pc.n, 0)) as matched,
           (select p2.at from ps p2 where p2.day = ss.day and p2.kind = ss.kind and p2.abs_amount = ss.abs_amount and p2.rn = ss.rn) as matched_at
      from ss left join pc on pc.day = ss.day and pc.kind = ss.kind and pc.abs_amount = ss.abs_amount
  ),
  placed as (
    select sm.*, max(sm.matched_at) over (order by sm.seq rows between unbounded preceding and current row) as prev_at,
           max(case when sm.matched then sm.seq end) over (order by sm.seq rows between unbounded preceding and current row) as prev_seq,
           (sm.day::timestamp at time zone 'Asia/Dhaka') as day_start
      from sm
  )
  select ps.at, true, ps.day, ps.kind, ps.kind, ps.signed, ps.balance, ps.trx_id, ps.status, ps.review_reason, ps.chain_status,
         case when exists (select 1 from sm where sm.matched and sm.day = ps.day and sm.kind = ps.kind and sm.abs_amount = ps.abs_amount and sm.rn = ps.rn) then 'both' else 'sms' end,
         ps.raw_message, ps.id, ps.sim_slot, ps.counterparty
    from ps
  union all
  select greatest(coalesce(pl.prev_at + (pl.seq - pl.prev_seq) * interval '1 second', pl.day_start), pl.day_start),
         false, pl.day, pl.kind, pl.type, pl.amount, null, null, 'statement', null, null, 'statement',
         'Statement: ' || pl.type || ' Tk ' || pl.amount, null, pl.sim_slot, null
    from placed pl where not pl.matched
  order by 1;
$$;

-- balance_gap_record: the previous message must be ours too (same body as 063, one more condition).
create or replace function public.balance_gap_record(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; prev record; d public.devices; kind text; signed numeric; expected numeric; tol numeric; gap numeric;
  gid uuid; cmd uuid; pull boolean := false; why text := null; can_pull boolean;
begin
  select * into p from public.payments where id = p_payment;
  if p.id is null or p.balance is null or p.device_id is null then return jsonb_build_object('gap', null, 'why', 'no balance or phone'); end if;
  if coalesce(p.review_reason, '') = 'not_ours' then return jsonb_build_object('gap', null, 'why', 'not our wallet'); end if;
  if p.chain_status is distinct from 'mismatch' then return jsonb_build_object('gap', null, 'why', 'chain not broken'); end if;
  if exists (select 1 from public.balance_gaps g where g.payment_id = p_payment) then return jsonb_build_object('gap', null, 'why', 'already recorded'); end if;
  select x.balance, coalesce(x.occurred_at, x.received_at) as at into prev
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
    jsonb_build_object('device_id', p.device_id, 'gap_id', gid, 'amount', gap, 'prev_balance', prev.balance, 'balance', p.balance, 'pull', pull, 'why', why), p.id);
  perform public.balance_gap_explain(p.device_id, p.provider);
  return jsonb_build_object('gap', gid, 'amount', gap, 'pull', pull, 'why', why, 'device_id', p.device_id, 'command_id', cmd,
                            'explained', exists (select 1 from public.balance_gaps g where g.id = gid and g.explained_by is not null));
end $$;
revoke all on function public.balance_gap_record(uuid) from public, anon, authenticated;
grant execute on function public.balance_gap_record(uuid) to service_role;

-- ---------- what each phone is ignoring, for the Phones page (last 7 days) ----------
create or replace view public.device_not_ours with (security_invoker = true) as
select device_id, provider, sim_slot, count(*)::int as n, max(received_at) as last_at, sum(amount) as amount
  from public.payments
 where review_reason = 'not_ours' and device_id is not null and received_at > now() - interval '7 days'
 group by device_id, provider, sim_slot;
grant select on public.device_not_ours to authenticated;

-- ---------- one-time: what already arrived from wallets that are not ours ----------
-- Only rows nothing depends on (never a matched payment, never one an order points at); last 30 days.
do $$
declare n int;
begin
  with c as (
    update public.payments p
       set status = 'ignored', review_reason = 'not_ours'
     where p.device_id is not null and p.source = 'app'
       and p.status in ('tracked_only', 'unmatched', 'review')
       and p.received_at > now() - interval '30 days'
       and not public.wallet_is_ours(p.device_id, p.provider, p.sim_slot)
       and not exists (select 1 from public.orders o where o.payment_id = p.id)
    returning p.id
  )
  select count(*) into n from c;
  insert into public.events (kind, detail) values ('not_ours_backfill', jsonb_build_object('rows', n));
end $$;
