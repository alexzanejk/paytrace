-- 061: the agent's cash-out totals count every cash-out that really happened, and the wallet's own statement settles
-- chain holds on every pull (owner 2026-11-07: "all the cashout that really happen should show on transaction so we get
-- 100% accurate cashout number from our agent").
--
-- Before this, one status did two jobs: "review" both blocked the order AND removed the payment from every total, as if
-- the money had never arrived. For a wrong-amount hold that is plainly wrong: the balance chain proves the Tk 490 landed
-- in the wallet, the only open question is which order it belongs to. On 2026-11-06 the agent totals were short by seven
-- such receipts. Chain-mismatch holds are different: there the SMS alone cannot prove the money came in, so they stay
-- out until the wallet itself vouches for them. The wallet check of migration 053 ran ONCE, right after the hold, and a
-- sleeping phone made it fail for good. Now every statement pull (migration 059) re-judges every chain hold of that
-- wallet, and a wallet with a hold is pulled every hour instead of twice a day.
--
-- Deliberately NOT done (owner 2026-11-07: "dont do this"): confirming a held receipt because the NEXT SMS continued
-- from its balance. Only the wallet's live balance, its statement or the owner release a chain hold.
--
-- 1. payment_counted(): the one rule for "this money really arrived", used by device_day_totals (new column `counted`,
--    which the dashboard reads instead of its own status list), device_commission_daily and device_day_flows.
-- 2. statement_confirm_held(): called at the end of every statement_lines_record. A held cash-out / send-money receipt
--    is confirmed when the statement lists at least as many money-IN entries of that amount on that Bangladesh day as
--    PayTrace stores payments of that amount that day on that wallet (one entry cannot vouch for two SMS; the same rule
--    as payment_check_judge_statement). Confirmation goes through payment_check_confirm, so the order is paid the normal
--    way and the Review line says "statement".
-- 3. statement_pull_wallets(hour): the wallets due a pull: the scheduled hours as before, PLUS any wallet holding a
--    chain-mismatch payment from the last 48 hours, every hour. statement_pull_tick() uses it.
-- 4. device_day_flows gains kind 'cash_out_stmt': the statement's own Cash Out entries per day, so the phone card can
--    show SMS and statement side by side with the difference.

-- ---------- 1. what counts ----------
create or replace function public.payment_counted(p_status text, p_chain text, p_txn_type text, p_reason text)
returns boolean language sql immutable as $$
  select p_status in ('unmatched', 'matched', 'tracked_only')
      or (p_status = 'review' and p_chain = 'ok'
          and p_txn_type in ('cash_out', 'send_money_received', 'payment_received')
          and (coalesce(p_reason, '') like 'amount_mismatch%'
               or coalesce(p_reason, '') in ('paid_before_order', 'wrong_phone', 'phone_mismatch', 'order_expired_before_payment')));
$$;
comment on function public.payment_counted(text, text, text, text) is
  'True when a stored SMS counts as money that really arrived: a counted status, or a hold that is only an order question (wrong amount, paid before the order, wrong phone) on a receipt whose balance chain is intact.';

create or replace view public.device_day_totals with (security_invoker = true) as
select (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date as day,
       device_id, provider, txn_type, status,
       count(*) as n, sum(amount) as amount, sum(fee) as fee, sum(commission) as commission,
       public.payment_counted(status, chain_status, txn_type, review_reason) as counted
  from public.payments
 where source = 'app'
 group by (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date, device_id, provider, txn_type, status,
          public.payment_counted(status, chain_status, txn_type, review_reason);

create or replace view public.device_commission_daily as
select t.day, t.device_id, t.provider, t.kind, t.n, t.total, r.rate_pct,
       round(t.total * coalesce(r.rate_pct, 0) / 100, 2) as commission
  from (
    select day, device_id, provider,
           case txn_type when 'cash_out' then 'cash_out' else 'send_money' end as kind,
           sum(n)::int as n, sum(amount) as total
      from public.device_day_totals
     where device_id is not null
       and counted
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

create or replace view public.device_day_flows with (security_invoker = true) as
select day, device_id, provider, kind, count(*)::int as n, sum(amount) as amount
  from (
    select (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date as day, p.device_id, p.provider,
           case when p.review_reason = 'b2b_transfer_out' then 'b2b_out'
                when p.review_reason = 'cash_in_sent' then 'cash_in'
                else 'cash_out' end as kind,
           p.amount
      from public.payments p
     where p.source = 'app'
       and ((p.txn_type = 'cash_out' and public.payment_counted(p.status, p.chain_status, p.txn_type, p.review_reason))
            or p.review_reason in ('b2b_transfer_out', 'cash_in_sent'))
    union all
    select (coalesce(c.finished_at, c.created_at) at time zone 'Asia/Dhaka')::date, c.device_id, c.provider, 'cash_in', c.amount
      from public.phone_commands c
     where c.kind = 'cashin' and c.status = 'done' and c.amount is not null and c.provider is not null
    union all
    select (coalesce(j.submitted_at, j.checked_at, j.created_at) at time zone 'Asia/Dhaka')::date, j.device_id, j.provider, 'cash_in', j.amount
      from public.cashin_jobs j
     where j.status = 'verified' and j.amount is not null
    union all
    -- The wallet's own word: every Cash Out entry the statement listed (money IN), one row per entry.
    select l.day, l.device_id, l.provider, 'cash_out_stmt', l.amount
      from public.statement_lines l
     where l.amount > 0 and public.ledger_kind(l.type, true) = 'cash_out'
  ) x
 group by 1, 2, 3, 4;

-- ---------- 2. the statement settles chain holds, every pull ----------
create or replace function public.statement_confirm_held(p_device uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; pday date; kind text; matches int; stored int; covered int; why text; r text;
        out jsonb := '[]'::jsonb; last_detail text;
begin
  for p in
    select * from public.payments x
     where x.device_id = p_device and x.provider = p_provider
       and x.status = 'review' and x.review_reason = 'balance_chain_mismatch'
       and x.txn_type in ('cash_out', 'send_money_received')
       and x.received_at > now() - interval '30 days'
     order by x.received_at
  loop
    pday := (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date;
    kind := public.payment_ledger_kind(p.txn_type, p.review_reason);
    -- Does the statement cover that day at all? (The list shows only the newest entries.)
    select count(*) into covered from public.statement_lines l
     where l.device_id = p_device and l.provider = p_provider and l.day = pday;
    if covered = 0 then continue; end if;
    select count(*) into matches from public.statement_lines l
     where l.device_id = p_device and l.provider = p_provider and l.day = pday
       and l.amount > 0 and abs(l.amount - p.amount) < 0.005
       and public.ledger_kind(l.type, true) = kind
       and (p.sim_slot is null or l.sim_slot is null or l.sim_slot = p.sim_slot);
    select count(*) into stored from public.payments x
     where x.device_id = p_device and x.provider = p_provider and x.status <> 'ignored'
       and abs(x.amount - p.amount) < 0.005
       and (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date = pday
       and public.payment_ledger_kind(x.txn_type, x.review_reason) = kind
       and (p.sim_slot is null or x.sim_slot is null or x.sim_slot = p.sim_slot);
    if matches >= greatest(stored, 1) then
      why := format('The wallet''s statement (pulled %s) lists %s entr%s of Tk %s coming in on %s.',
                    to_char(now() at time zone 'Asia/Dhaka', 'DD Mon HH24:MI'), matches, case when matches = 1 then 'y' else 'ies' end, p.amount, to_char(pday, 'DD Mon'));
      r := public.payment_check_confirm(p.id, 'statement', why);
      out := out || jsonb_build_object('payment_id', p.id, 'trx_id', p.trx_id, 'amount', p.amount, 'provider', p.provider, 'result', r, 'detail', why);
    else
      why := case when matches = 0
               then format('The wallet''s statement (pulled %s) shows no Tk %s coming in on %s.', to_char(now() at time zone 'Asia/Dhaka', 'DD Mon HH24:MI'), p.amount, to_char(pday, 'DD Mon'))
               else format('The statement shows %s entr%s of Tk %s on %s but PayTrace holds %s payments of that amount that day, so one of them is not in the wallet.',
                           matches, case when matches = 1 then 'y' else 'ies' end, p.amount, to_char(pday, 'DD Mon'), stored) end;
      -- One line on Review per distinct verdict, not one per hourly pull.
      select c.detail into last_detail from public.payment_checks c where c.payment_id = p.id order by c.created_at desc limit 1;
      if last_detail is distinct from why then
        insert into public.payment_checks (payment_id, step, status, detail, finished_at)
          values (p.id, 'statement', 'not_confirmed', why, now());
      end if;
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.statement_confirm_held(uuid, text) from public, anon, authenticated;
grant execute on function public.statement_confirm_held(uuid, text) to service_role;

-- statement_lines_record now ends by re-judging the wallet's chain holds and returns them under `confirmed`.
create or replace function public.statement_lines_record(p_command uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; wsim smallint; n int := 0; added jsonb := '[]'::jsonb; confirmed jsonb := '[]'::jsonb;
begin
  select device_id, provider, item into c from public.phone_commands where id = p_command;
  if c.device_id is null or c.item is not null then return jsonb_build_object('count', 0, 'added', '[]'::jsonb, 'confirmed', '[]'::jsonb); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return jsonb_build_object('count', 0, 'added', '[]'::jsonb, 'confirmed', '[]'::jsonb); end if;
  wsim := public.sim_of_wallet(c.device_id, c.provider);
  with l as (
    select (x->>'no')::int as no, (x->>'day')::date as day, left(trim(x->>'type'), 60) as type,
           case when (x->>'in')::boolean then (x->>'amount')::numeric else -((x->>'amount')::numeric) end as amount
      from jsonb_array_elements(p_lines) x
     where x ? 'no' and x ? 'day' and x ? 'amount' and x ? 'in' and x ? 'type'
       and (x->>'day') ~ '^\d{4}-\d{2}-\d{2}$' and (x->>'no') ~ '^\d{1,3}$' and (x->>'amount') ~ '^\d+(\.\d+)?$'
  ), ranked as (
    select l.*, row_number() over (partition by l.day, l.type, l.amount order by l.no) as occ,
           row_number() over (order by l.no) - 1 as list_pos
      from l
  ), ins as (
    insert into public.statement_lines (device_id, provider, sim_slot, day, type, amount, occ, list_pos, command_id)
    select c.device_id, c.provider, wsim, r.day, r.type, r.amount, r.occ, r.list_pos, p_command from ranked r
    on conflict (device_id, provider, day, type, amount, occ) do update
      set list_pos = excluded.list_pos, command_id = excluded.command_id, seen_at = now(),
          sim_slot = coalesce(excluded.sim_slot, public.statement_lines.sim_slot)
    returning (xmax = 0) as inserted, day, type, amount
  )
  select count(*) filter (where inserted),
         coalesce(jsonb_agg(jsonb_build_object('day', day, 'type', type, 'amount', amount)) filter (where inserted), '[]'::jsonb)
    into n, added from ins;
  begin
    confirmed := public.statement_confirm_held(c.device_id, c.provider);
  exception when others then
    -- Never let a judging problem lose the lines themselves.
    insert into public.events (kind, provider, detail) values ('statement_confirm_failed', c.provider, jsonb_build_object('device_id', c.device_id, 'error', left(sqlerrm, 200)));
  end;
  return jsonb_build_object('count', n, 'added', added, 'confirmed', confirmed, 'device_id', c.device_id, 'provider', c.provider);
end $$;
revoke all on function public.statement_lines_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.statement_lines_record(uuid, jsonb) to service_role;

-- ---------- 3. pull every hour while a wallet holds something ----------
create or replace function public.statement_pull_wallets(p_hour integer)
returns table (device_id uuid, provider text, why text) language sql stable security definer set search_path = public as $$
  with s as (select * from public.ledger_settings limit 1)
  select d.id, w.provider,
         case when exists (select 1 from public.payments p where p.device_id = d.id and p.provider = w.provider
                              and p.status = 'review' and p.review_reason = 'balance_chain_mismatch'
                              and p.received_at > now() - interval '48 hours') then 'held' else 'scheduled' end
    from public.devices d
    join (values ('bkash'), ('nagad')) as w(provider) on true
    cross join s
   where s.auto_pull
     and d.status = 'approved' and d.allow_balance <> false
     and (exists (select 1 from public.device_wallets x where x.device_id = d.id and x.provider = w.provider and x.enabled)
          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) j where j->>'provider' = w.provider))
     and (p_hour = any (public.statement_pull_hours(s.times_per_day))
          or exists (select 1 from public.payments p where p.device_id = d.id and p.provider = w.provider
                        and p.status = 'review' and p.review_reason = 'balance_chain_mismatch'
                        and p.received_at > now() - interval '48 hours'))
     and not exists (select 1 from public.events e where e.kind = 'statement_pull_auto' and e.at > now() - interval '50 minutes'
                        and e.detail->>'device_id' = d.id::text and e.provider = w.provider);
$$;
revoke all on function public.statement_pull_wallets(integer) from public, anon, authenticated;
grant execute on function public.statement_pull_wallets(integer) to service_role;

create or replace function public.statement_pull_tick() returns integer
language plpgsql security definer set search_path = public as $$
declare h int; r record; n int := 0;
begin
  h := extract(hour from (now() at time zone 'Asia/Dhaka'))::int;
  for r in select * from public.statement_pull_wallets(h) loop
    perform public.phone_commands_tidy(r.device_id);
    begin
      insert into public.phone_commands (device_id, kind, provider) values (r.device_id, 'statement', r.provider);
      insert into public.events (kind, provider, detail) values ('statement_pull_auto', r.provider, jsonb_build_object('device_id', r.device_id, 'hour', h, 'why', r.why));
      n := n + 1;
    exception when unique_violation then
      null; -- a statement is already live on that phone
    end;
  end loop;
  return n;
end $$;
revoke all on function public.statement_pull_tick() from public, anon, authenticated;
grant execute on function public.statement_pull_tick() to service_role;
