-- 097: every movement of every wallet in one list (owner 2026-11-12: "every transaction that happened in our agent
-- should be on our transaction page ... filter by phone, bKash, Nagad, Rocket, cash out, cash in, B2B ... no
-- transaction should be missed").
--
-- Three sources, each movement counted ONCE (the same rule as device_day_money): for every phone x wallet x Bangladesh
-- day x kind family x amount,
--   1. every SMS PayTrace stored (payments, not 'not_ours'),
--   2. the wallet's own list (statement_lines: the bKash/Nagad agent app reads and the *247#/*167# statements) only
--      for the entries beyond what the wallet's own-SIM SMS already show,
--   3. PayTrace's own finished commands (cash-in, B2B, Send Money) only beyond what both of those show.
-- A bKash agent Cash In or a B2B often sends NO SMS; the app read lists it, so it lands here as source 'wallet'.
-- Read only. Admins only (wrapper); the rows function is server-only.

create or replace function public.all_movements_rows(p_from date, p_to date, p_device uuid default null, p_provider text default null)
returns table(at timestamptz, exact_time boolean, day date, device_id uuid, provider text, account text, kind text,
              amount numeric, commission numeric, balance numeric, trx_id text, counterparty text, status text,
              review_reason text, chain_status text, seen text, payment_id uuid, raw text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with
  p as (
    select x.id, coalesce(x.occurred_at, x.received_at) as at,
           (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date as day,
           x.device_id, x.provider, x.sim_slot,
           public.payment_ledger_kind(x.txn_type, x.review_reason) as kind,
           x.amount as abs_amount, x.commission, x.balance, x.trx_id, x.counterparty, x.status, x.review_reason,
           x.chain_status, x.raw_message
      from public.payments x
     where x.source = 'app' and coalesce(x.review_reason, '') <> 'not_ours'
       and (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date between p_from and p_to
       and (p_device is null or x.device_id = p_device)
       and (p_provider is null or x.provider = p_provider)
  ),
  w as (select distinct p.device_id, p.provider, public.sim_of_wallet(p.device_id, p.provider) as sim from p where p.device_id is not null),
  pk as (
    select p.*, public.ledger_match_kind(p.kind) as mk,
           -- only an SMS of the wallet's own SIM can be the same entry as a line in that wallet's own list
           (p.device_id is not null and (w.sim is null or p.sim_slot is null or p.sim_slot = w.sim)) as matchable
      from p left join w on w.device_id = p.device_id and w.provider = p.provider
  ),
  pkr as (
    select pk.*, row_number() over (partition by pk.device_id, pk.provider, pk.day, pk.mk, pk.abs_amount, pk.matchable order by pk.at) as rn
      from pk
  ),
  pn as (select device_id, provider, day, mk, abs_amount, count(*) as n from pk where matchable group by 1, 2, 3, 4, 5),
  pa as (select device_id, provider, day, mk, abs_amount, count(*) as n from pk where device_id is not null group by 1, 2, 3, 4, 5),
  s as (
    select l.id, l.device_id, l.provider, l.day, l.at, l.type, l.amount, l.commission, l.occ,
           public.ledger_kind(l.type, l.amount > 0) as kind, abs(l.amount) as abs_amount
      from public.statement_lines l
     where l.day between p_from and p_to
       and (p_device is null or l.device_id = p_device)
       and (p_provider is null or l.provider = p_provider)
  ),
  sk as (
    select s.*, public.ledger_match_kind(s.kind) as mk,
           row_number() over (partition by s.device_id, s.provider, s.day, public.ledger_match_kind(s.kind), s.abs_amount
                              order by s.at nulls last, s.occ, s.type) as rn
      from s
  ),
  sn as (select device_id, provider, day, mk, abs_amount, count(*) as n from sk group by 1, 2, 3, 4, 5),
  su as (
    select sk.* from sk left join pn using (device_id, provider, day, mk, abs_amount)
     where sk.rn > coalesce(pn.n, 0)
  ),
  c as (
    select c.id, coalesce(c.finished_at, c.created_at) as at,
           (coalesce(c.finished_at, c.created_at) at time zone 'Asia/Dhaka')::date as day,
           c.device_id, c.provider,
           case c.kind when 'cashin' then 'cash_in_sent' when 'btob' then 'b2b_out' else 'send_money_out' end as kind,
           c.kind as cmd_kind, c.amount as abs_amount, c.trx_id, c.to_number
      from public.phone_commands c
     where c.status = 'done' and c.kind in ('cashin', 'btob', 'sendmoney') and c.amount is not null
       and (coalesce(c.finished_at, c.created_at) at time zone 'Asia/Dhaka')::date between p_from and p_to
       and (p_device is null or c.device_id = p_device)
       and (p_provider is null or c.provider = p_provider)
  ),
  ck as (
    select c.*, public.ledger_match_kind(c.kind) as mk,
           row_number() over (partition by c.device_id, c.provider, c.day, public.ledger_match_kind(c.kind), c.abs_amount order by c.at) as rn
      from c
  ),
  cu as (
    select ck.* from ck
      left join pa using (device_id, provider, day, mk, abs_amount)
      left join sn using (device_id, provider, day, mk, abs_amount)
     where ck.rn > greatest(coalesce(pa.n, 0), coalesce(sn.n, 0))
       -- an SMS with the same TrxID always wins
       and not exists (select 1 from p where ck.trx_id is not null and p.trx_id = ck.trx_id)
  )
  select pkr.at, true, pkr.day, pkr.device_id, pkr.provider,
         case when pkr.device_id is null then null else public.wallet_account_of(pkr.device_id, pkr.provider, pkr.sim_slot) end,
         pkr.kind,
         case when public.ledger_is_out(pkr.kind) then -pkr.abs_amount else pkr.abs_amount end,
         pkr.commission, pkr.balance, pkr.trx_id, pkr.counterparty, pkr.status, pkr.review_reason, pkr.chain_status,
         case when pkr.matchable and pkr.rn <= coalesce(sn.n, 0) then 'both' else 'sms' end,
         pkr.id, pkr.raw_message
    from pkr left join sn on sn.device_id = pkr.device_id and sn.provider = pkr.provider and sn.day = pkr.day
                         and sn.mk = pkr.mk and sn.abs_amount = pkr.abs_amount
  union all
  select coalesce(su.at, (su.day::timestamp at time zone 'Asia/Dhaka')), su.at is not null, su.day, su.device_id, su.provider,
         'agent', su.kind, su.amount, su.commission, null::numeric, ar.trx_id, ar.party, 'wallet', null, null, 'wallet',
         null::uuid, su.type
    from su left join lateral (
      select a.trx_id, a.party from public.app_rows a
       where a.device_id = su.device_id and a.provider = su.provider and a.at = su.at and a.amount = su.amount
       order by a.trx_id nulls last limit 1
    ) ar on true
  union all
  select cu.at, true, cu.day, cu.device_id, cu.provider,
         case when cu.cmd_kind = 'sendmoney' then 'personal' else 'agent' end,
         cu.kind, -cu.abs_amount, null::numeric, null::numeric, cu.trx_id, cu.to_number, 'paytrace', null, null, 'paytrace',
         null::uuid, 'Sent by PayTrace (' || cu.cmd_kind || ')'
    from cu;
end;
$$;

revoke all on function public.all_movements_rows(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.all_movements_rows(date, date, uuid, text) to service_role;

create or replace function public.all_movements(p_from date, p_to date, p_device uuid default null, p_provider text default null)
returns table(at timestamptz, exact_time boolean, day date, device_id uuid, provider text, account text, kind text,
              amount numeric, commission numeric, balance numeric, trx_id text, counterparty text, status text,
              review_reason text, chain_status text, seen text, payment_id uuid, raw text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then raise exception 'bad_range'; end if;
  return query select * from public.all_movements_rows(p_from, p_to, p_device, p_provider) order by 1 desc;
end;
$$;

revoke all on function public.all_movements(date, date, uuid, text) from public, anon;
grant execute on function public.all_movements(date, date, uuid, text) to authenticated, service_role;
