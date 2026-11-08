-- 069: one accurate figure per wallet per day (owner 2026-11-08: "if we don't get it from SMS we get it from the statement,
-- but one single accurate data, no missing data").
--
-- What the owner's own data showed on 8 Nov (Vivo):
--  * bKash's statement calls a merchant's payment to the agent "Agent Cash Out" while its SMS says "You have received Tk 1,161
--    from <shop>". The two were matched by kind, so the same Tk 1,161 was counted twice (once as Cash Out from the statement,
--    once as Received from the SMS). Now money a customer brings to an agent (cash_out / send_money_in / payment_in) is ONE
--    family for matching, and on an agent account it is counted as Cash Out.
--  * Nagad's gap of -2,987.70 is a Tk 3,000 cash-in that earned the agent Tk 12.30 commission at once (0.41%). A gap was only
--    explained by ONE statement line within the receipt's own tolerance, so a cash-in with its commission never explained
--    anything, and a gap made of several entries (five cash-ins) could never be explained either. Now a gap is explained by
--    the smallest set of statement-only entries (up to 6 of the 12 nearest in size) whose sum fits, allowing each cash-in's
--    commission (0.6% + Tk 0.5).
--  * The day check: device_day_check(day) says per account whether every balance change of the day is accounted for:
--    complete / missing (with the amount and when) / waiting (no balance reading after midnight yet) / running (today).
--  * Statement pulls: also every 3 hours while a wallet has an unexplained gap from the last 24 hours, every 2 hours on a busy wallet (8+ messages
--    since the last pull), and right after midnight for the day that just ended, followed by a balance check that closes
--    the day when nothing moved after the last SMS.
--  * A menu command (balance, statement, cash-in, send money) is no longer handed to a phone while another one is still
--    running there: the second one used to fail with "busy"; now it waits its turn.
-- Nothing here touches crediting, payouts or commission.

-- ---------------------------------------------------------------- matching family
create or replace function public.ledger_match_kind(p_kind text) returns text language sql immutable as $$
  select case when p_kind in ('cash_out', 'send_money_in', 'payment_in') then 'customer_in' else p_kind end;
$$;

-- ---------------------------------------------------------------- the ledger matches by family
create or replace function public.wallet_ledger_rows(p_device uuid, p_provider text, p_from date, p_to date)
returns table(sort_at timestamptz, exact_time boolean, day date, kind text, label text, amount numeric, balance numeric, trx_id text,
              status text, review_reason text, chain_status text, source text, raw text, payment_id uuid, sim_slot smallint, counterparty text)
language sql stable security definer set search_path = public as $$
  with w as (select public.sim_of_wallet(p_device, p_provider) as sim),
  p as (
    select x.id, coalesce(x.occurred_at, x.received_at) as at,
           (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date as day,
           public.payment_ledger_kind(x.txn_type, x.review_reason) as kind,
           public.ledger_match_kind(public.payment_ledger_kind(x.txn_type, x.review_reason)) as mk,
           x.amount as abs_amount, x.balance, x.trx_id, x.status, x.review_reason, x.chain_status, x.raw_message, x.sim_slot, x.counterparty
      from public.payments x, w
     where x.device_id = p_device and x.provider = p_provider and x.source = 'app'
       and coalesce(x.review_reason, '') <> 'not_ours'
       and (w.sim is null or x.sim_slot is null or x.sim_slot = w.sim)
       and (coalesce(x.occurred_at, x.received_at) at time zone 'Asia/Dhaka')::date between p_from and p_to
  ),
  ps as (
    select p.*, case when public.ledger_is_out(p.kind) then -p.abs_amount else p.abs_amount end as signed,
           row_number() over (partition by p.day, p.mk, p.abs_amount order by p.at desc) as rn
      from p
  ),
  pc as (select ps.day, ps.mk, ps.abs_amount, count(*) as n from ps group by 1, 2, 3),
  s as (
    select l.day, l.type, l.amount, l.occ, l.list_pos, l.sim_slot, public.ledger_kind(l.type, l.amount > 0) as kind,
           public.ledger_match_kind(public.ledger_kind(l.type, l.amount > 0)) as mk, abs(l.amount) as abs_amount,
           c.created_at as pull_at
      from public.statement_lines l left join public.phone_commands c on c.id = l.command_id
     where l.device_id = p_device and l.provider = p_provider and l.day between p_from and p_to
  ),
  ss as (
    select s.*, row_number() over (partition by s.day, s.mk, s.abs_amount order by s.occ, s.type) as rn,
           row_number() over (order by s.pull_at nulls first, s.list_pos desc) as seq
      from s
  ),
  sm as (
    select ss.*, (ss.rn <= coalesce(pc.n, 0)) as matched,
           (select p2.at from ps p2 where p2.day = ss.day and p2.mk = ss.mk and p2.abs_amount = ss.abs_amount and p2.rn = ss.rn) as matched_at
      from ss left join pc on pc.day = ss.day and pc.mk = ss.mk and pc.abs_amount = ss.abs_amount
  ),
  placed as (
    select sm.*, max(sm.matched_at) over (order by sm.seq rows between unbounded preceding and current row) as prev_at,
           max(case when sm.matched then sm.seq end) over (order by sm.seq rows between unbounded preceding and current row) as prev_seq,
           (sm.day::timestamp at time zone 'Asia/Dhaka') as day_start
      from sm
  )
  select ps.at, true, ps.day, ps.kind, ps.kind, ps.signed, ps.balance, ps.trx_id, ps.status, ps.review_reason, ps.chain_status,
         case when exists (select 1 from sm where sm.matched and sm.day = ps.day and sm.mk = ps.mk and sm.abs_amount = ps.abs_amount and sm.rn = ps.rn) then 'both' else 'sms' end,
         ps.raw_message, ps.id, ps.sim_slot, ps.counterparty
    from ps
  union all
  select greatest(coalesce(pl.prev_at + (pl.seq - pl.prev_seq) * interval '1 second', pl.day_start), pl.day_start),
         false, pl.day, pl.kind, pl.type, pl.amount, null, null, 'statement', null, null, 'statement',
         'Statement: ' || pl.type || ' Tk ' || pl.amount, null, pl.sim_slot, null
    from placed pl where not pl.matched
  order by 1;
$$;

-- ---------------------------------------------------------------- the day's figures: same family, Cash Out on an agent
create or replace function public.device_day_money(p_day date)
returns table (
  device_id uuid, provider text, account text, sim_slot smallint,
  cash_out_n int, cash_out numeric, cash_in_n int, cash_in numeric,
  b2b_in_n int, b2b_in numeric, b2b_out_n int, b2b_out numeric,
  received_n int, received numeric, sent_n int, sent numeric,
  held_n int, held numeric, unknown_sim_n int,
  from_sms int, from_statement int, from_paytrace int,
  gap_open_n int, gap_open numeric, checked boolean
)
language sql stable security definer set search_path = public as $$
  with dev as (select id from public.devices where status = 'approved' and public.is_admin()),
  sms0 as (
    select p.device_id, p.provider, coalesce(public.wallet_account_of(p.device_id, p.provider, p.sim_slot), 'unknown') as account,
           public.payment_ledger_kind(p.txn_type, p.review_reason) as kind, p.amount as amt,
           (p.status = 'review' and not public.payment_counted(p.status, p.chain_status, p.txn_type, p.review_reason)) as held
      from public.payments p join dev on dev.id = p.device_id
     where p.source = 'app' and coalesce(p.review_reason, '') <> 'not_ours'
       and (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date = p_day
  ),
  -- On an agent account, money a customer brings (a merchant's "You have received", a payment) is a Cash Out: the wallet's
  -- own statement calls it "Agent Cash Out", and counting it under two names counted it twice.
  sms as (
    select device_id, provider, account,
           case when account = 'agent' and public.ledger_match_kind(kind) = 'customer_in' then 'cash_out' else kind end as kind, amt, held
      from sms0
  ),
  sms_keys as (
    select device_id, provider, account, kind, amt, (count(*) filter (where not held))::int as n, (count(*) filter (where held))::int as n_held
      from sms group by 1, 2, 3, 4, 5
  ),
  stmt as (
    select l.device_id, l.provider, 'agent'::text as account,
           case when public.ledger_match_kind(public.ledger_kind(l.type, l.amount > 0)) = 'customer_in' then 'cash_out'
                else public.ledger_kind(l.type, l.amount > 0) end as kind,
           abs(l.amount) as amt, count(*)::int as n
      from public.statement_lines l join dev on dev.id = l.device_id
     where l.day = p_day group by 1, 2, 3, 4, 5
  ),
  cmd as (
    select c.device_id, c.provider,
           case when c.kind = 'sendmoney' then 'personal' else 'agent' end::text as account,
           case when c.kind = 'sendmoney' then 'send_money_out' else 'cash_in_sent' end::text as kind,
           c.amount as amt, count(*)::int as n
      from public.phone_commands c join dev on dev.id = c.device_id
     where c.kind in ('cashin', 'sendmoney') and c.status = 'done' and (c.finished_at at time zone 'Asia/Dhaka')::date = p_day
       and (c.trx_id is null or not exists (select 1 from public.payments x where x.provider = c.provider and x.trx_id = upper(c.trx_id)))
     group by 1, 2, 3, 4, 5
  ),
  keys as (
    select device_id, provider, account, kind, amt from sms_keys
    union select device_id, provider, account, kind, amt from stmt
    union select device_id, provider, account, kind, amt from cmd
  ),
  units as (
    -- Counted = the larger of (SMS + PayTrace's own) and the statement. A held SMS the statement also lists is vouched for
    -- by the wallet itself: counted, and no longer shown as held.
    select k.device_id, k.provider, k.account, k.kind, k.amt,
           coalesce(s.n, 0) + least(coalesce(s.n_held, 0), greatest(coalesce(t.n, 0) - coalesce(s.n, 0) - coalesce(c.n, 0), 0)) as n_sms,
           coalesce(c.n, 0) as n_cmd,
           greatest(coalesce(t.n, 0) - coalesce(s.n, 0) - coalesce(c.n, 0) - coalesce(s.n_held, 0), 0) as n_stmt,
           coalesce(s.n_held, 0) - least(coalesce(s.n_held, 0), greatest(coalesce(t.n, 0) - coalesce(s.n, 0) - coalesce(c.n, 0), 0)) as n_held_left
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
    select device_id, provider, account, sum(n_held_left)::int as held_n, sum(n_held_left * amt) as held from units where n_held_left > 0 group by 1, 2, 3
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

-- ---------------------------------------------------------------- a gap may be explained by several statement entries
alter table public.balance_gaps add column if not exists statement_line_ids uuid[];

create or replace function public.balance_gap_explain(p_device uuid, p_provider text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g record; done jsonb := '[]'::jsonb; d_from date; d_to date;
  ids uuid[]; amts numeric[]; kinds text[]; days date[]; n int; mask int; i int; cnt int;
  s numeric; slack numeric; err numeric; best int; best_cnt int; best_err numeric;
  pick uuid[]; pkinds text[]; pdays date[]; pkind text;
begin
  for g in select * from public.balance_gaps where device_id = p_device and provider = p_provider and explained_by is null
                                               and at > now() - interval '14 days' order by at
  loop
    d_from := (coalesce(g.prev_at, g.at - interval '1 day') at time zone 'Asia/Dhaka')::date;
    d_to := (g.at at time zone 'Asia/Dhaka')::date;
    -- The statement entries that no SMS stands for (the same rule as the ledger: within a day, a family and an amount, the
    -- first entries by list order are the SMS's own), not yet used by another gap, not the commission lines (an SMS that
    -- prints its commission already holds them), the 12 nearest in size to the gap.
    with smsn as (
      select r.day, public.ledger_match_kind(r.kind) as mk, abs(r.amount) as a, count(*) as n
        from public.wallet_ledger_rows(p_device, p_provider, d_from, d_to) r where r.source <> 'statement' group by 1, 2, 3
    ), lines as (
      select l.id, l.amount, l.day, public.ledger_kind(l.type, l.amount > 0) as kind,
             row_number() over (partition by l.day, public.ledger_match_kind(public.ledger_kind(l.type, l.amount > 0)), abs(l.amount)
                                order by l.occ, l.type) as rn
        from public.statement_lines l
       where l.device_id = p_device and l.provider = p_provider and l.day between d_from and d_to
    ), cand as (
      select l.id, l.amount, l.kind, l.day from lines l
        left join smsn on smsn.day = l.day and smsn.mk = public.ledger_match_kind(l.kind) and smsn.a = abs(l.amount)
       where l.rn > coalesce(smsn.n, 0)
         and l.kind <> 'commission_in'
         and not exists (select 1 from public.balance_gaps o where o.id <> g.id
                            and (o.statement_line_id = l.id or l.id = any(coalesce(o.statement_line_ids, '{}'::uuid[]))))
       order by abs(abs(l.amount) - abs(g.amount)), l.day, l.id
       limit 12
    )
    select array_agg(id), array_agg(amount), array_agg(kind), array_agg(day) into ids, amts, kinds, days from cand;
    n := coalesce(array_length(ids, 1), 0);
    best := null; best_cnt := 99; best_err := null;
    if n > 0 then
      for mask in 1 .. (1 << n) - 1 loop
        cnt := 0; s := 0; slack := 0;
        for i in 0 .. n - 1 loop
          if (mask >> i) & 1 = 1 then
            cnt := cnt + 1; s := s + amts[i + 1];
            if kinds[i + 1] = 'cash_in_sent' then slack := slack + 0.006 * abs(amts[i + 1]) + 0.5; end if;
          end if;
        end loop;
        continue when cnt > 6 or cnt > best_cnt;
        err := abs(g.amount - s);
        if err <= g.tolerance + 0.01 + slack and (cnt < best_cnt or err < best_err) then
          best := mask; best_cnt := cnt; best_err := err;
        end if;
      end loop;
    end if;
    if best is not null then
      pick := '{}'; pkinds := '{}'; pdays := '{}';
      for i in 0 .. n - 1 loop
        if (best >> i) & 1 = 1 then pick := pick || ids[i + 1]; pkinds := pkinds || kinds[i + 1]; pdays := pdays || days[i + 1]; end if;
      end loop;
      pkind := case when (select count(distinct k) from unnest(pkinds) k) = 1 then pkinds[1] else 'several' end;
      update public.balance_gaps set explained_by = 'statement', explained_kind = pkind, explained_at = now(),
                                     statement_line_id = pick[1], statement_line_ids = pick
       where id = g.id;
      insert into public.events (kind, provider, detail, payment_id) values ('balance_gap_explained', p_provider,
        jsonb_build_object('device_id', p_device, 'gap_id', g.id, 'amount', g.amount, 'kind', pkind, 'lines', array_length(pick, 1),
                           'kinds', to_jsonb(pkinds), 'days', to_jsonb(pdays), 'by', 'statement'), g.payment_id);
      done := done || jsonb_build_object('gap_id', g.id, 'amount', g.amount, 'kind', pkind, 'day', pdays[1], 'lines', array_length(pick, 1));
    end if;
  end loop;
  return done;
end $$;

-- ---------------------------------------------------------------- is the day complete?
-- One row per account that had a balance in the 14 days up to the day's end: the balance the day started and ended with,
-- whether a later balance reading exists (the first SMS after midnight, or a balance check that agrees), the gaps that
-- touch the day and are still not explained, and the verdict.
create or replace function public.device_day_check(p_day date)
returns table (
  device_id uuid, provider text, account text, sim_slot smallint,
  opening numeric, opening_at timestamptz, closing numeric, closing_at timestamptz,
  next_at timestamptz, reading numeric, reading_at timestamptz,
  gap_open_n int, gap_open numeric, gap_from timestamptz, gap_to timestamptz, gap_explained_n int,
  state text
)
language sql stable security definer set search_path = public as $$
  with b as (
    select (p_day::timestamp at time zone 'Asia/Dhaka') as d0, ((p_day + 1)::timestamp at time zone 'Asia/Dhaka') as d1,
           p_day >= (now() at time zone 'Asia/Dhaka')::date as running
  ),
  dev as (select id from public.devices where status = 'approved' and public.is_admin()),
  r as (
    select p.device_id, p.provider, public.wallet_account_of(p.device_id, p.provider, p.sim_slot) as account, p.sim_slot,
           coalesce(p.occurred_at, p.received_at) as at, p.received_at, p.balance
      from public.payments p join dev on dev.id = p.device_id, b
     where p.source = 'app' and p.balance is not null and coalesce(p.review_reason, '') <> 'not_ours'
       and coalesce(p.occurred_at, p.received_at) >= b.d0 - interval '14 days'
       and coalesce(p.occurred_at, p.received_at) < b.d1 + interval '7 days'
  ),
  a as (
    select distinct r.device_id, r.provider, r.account from r, b where r.account is not null and r.at < b.d1
  ),
  x as (
    select a.device_id, a.provider, a.account,
      (select o.balance from r o, b where o.device_id = a.device_id and o.provider = a.provider and o.account = a.account and o.at < b.d0 order by o.at desc, o.received_at desc limit 1) as opening,
      (select o.at from r o, b where o.device_id = a.device_id and o.provider = a.provider and o.account = a.account and o.at < b.d0 order by o.at desc, o.received_at desc limit 1) as opening_at,
      (select o.balance from r o, b where o.device_id = a.device_id and o.provider = a.provider and o.account = a.account and o.at >= b.d0 and o.at < b.d1 order by o.at desc, o.received_at desc limit 1) as closing,
      (select o.at from r o, b where o.device_id = a.device_id and o.provider = a.provider and o.account = a.account and o.at >= b.d0 and o.at < b.d1 order by o.at desc, o.received_at desc limit 1) as closing_at,
      (select o.at from r o, b where o.device_id = a.device_id and o.provider = a.provider and o.account = a.account and o.at >= b.d1 order by o.at, o.received_at limit 1) as next_at
      from a
  ),
  y as (
    select x.*,
      -- A balance check after midnight reads the agent account (the wallet's own menu).
      (select c.balance from public.phone_commands c, b where x.account = 'agent' and c.device_id = x.device_id and c.provider = x.provider
          and c.kind = 'balance' and c.status = 'done' and c.balance is not null and c.finished_at >= b.d1 order by c.finished_at limit 1) as reading,
      (select c.finished_at from public.phone_commands c, b where x.account = 'agent' and c.device_id = x.device_id and c.provider = x.provider
          and c.kind = 'balance' and c.status = 'done' and c.balance is not null and c.finished_at >= b.d1 order by c.finished_at limit 1) as reading_at
      from x
  ),
  g as (
    select gg.device_id, gg.provider, public.wallet_account_of(gg.device_id, gg.provider, gg.sim_slot) as account,
           count(*) filter (where gg.explained_by is null)::int as open_n,
           coalesce(sum(gg.amount) filter (where gg.explained_by is null), 0) as open_amt,
           min(coalesce(gg.prev_at, gg.at)) filter (where gg.explained_by is null) as g_from,
           max(gg.at) filter (where gg.explained_by is null) as g_to,
           count(*) filter (where gg.explained_by is not null)::int as explained_n
      from public.balance_gaps gg join dev on dev.id = gg.device_id, b
     where coalesce(gg.prev_at, gg.at) < b.d1 and gg.at >= b.d0
     group by 1, 2, 3
  )
  select y.device_id, y.provider, y.account,
         (select (w->>'slot')::smallint from public.devices d2, jsonb_array_elements(case when jsonb_typeof(d2.info->'wallets') = 'array' then d2.info->'wallets' else '[]'::jsonb end) w
           where d2.id = y.device_id and w->>'provider' = y.provider and (w->>'slot') ~ '^[01]$'
             and (case when w->>'kind' = 'personal' then 'personal' else 'agent' end) = y.account limit 1),
         y.opening, y.opening_at, y.closing, y.closing_at, y.next_at,
         case when y.next_at is null then y.reading end, case when y.next_at is null then y.reading_at end,
         coalesce(g.open_n, 0), coalesce(g.open_amt, 0), g.g_from, g.g_to, coalesce(g.explained_n, 0),
         case
           when y.opening is null and y.closing is null then 'no_data'
           when coalesce(g.open_n, 0) > 0 then 'missing'
           when b.running then 'running'
           when y.next_at is not null then 'complete'
           when y.reading is not null and abs(y.reading - coalesce(y.closing, y.opening)) < 1 then 'complete'
           when y.reading is not null then 'reading_differs'
           else 'waiting' end
    from y cross join b
    left join g on g.device_id = y.device_id and g.provider = y.provider and g.account = y.account
   order by y.device_id, y.provider, y.account;
$$;

revoke all on function public.device_day_check(date) from public, anon;
grant execute on function public.device_day_check(date) to authenticated, service_role;

-- ---------------------------------------------------------------- one menu at a time
create or replace function public.device_next_command(p_device uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands set status = 'running', started_at = now()
  where id = (
    select c.id from public.phone_commands c
    where c.device_id = p_device and c.status = 'queued'
      and not (c.kind in ('balance', 'cashin', 'statement', 'sendmoney')
               and exists (select 1 from public.phone_commands r where r.device_id = p_device and r.status = 'running'
                              and r.kind in ('balance', 'cashin', 'statement', 'sendmoney')))
    order by c.created_at limit 1
  )
  returning jsonb_build_object(
    'id', id, 'kind', kind, 'provider', provider,
    'amount', amount, 'to_number', to_number, 'item', item
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------- when to read the statement
create or replace function public.statement_pull_wallets(p_hour integer)
returns table(device_id uuid, provider text, why text)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.ledger_settings limit 1),
  w0 as (
    select d.id, w.provider,
           exists (select 1 from public.payments p where p.device_id = d.id and p.provider = w.provider
                      and p.status = 'review' and p.review_reason = 'balance_chain_mismatch'
                      and p.received_at > now() - interval '48 hours') as held,
           exists (select 1 from public.balance_gaps g where g.device_id = d.id and g.provider = w.provider
                      and g.explained_by is null and g.at > now() - interval '24 hours') as gap,
           (select count(*) from public.payments p where p.device_id = d.id and p.provider = w.provider and p.source = 'app'
               and coalesce(p.review_reason, '') <> 'not_ours'
               and p.received_at > coalesce((select max(c.created_at) from public.phone_commands c
                                              where c.device_id = d.id and c.provider = w.provider and c.kind = 'statement'),
                                            now() - interval '24 hours')) as since_pull,
           (select max(c.created_at) from public.phone_commands c where c.device_id = d.id and c.provider = w.provider and c.kind = 'statement') as last_pull
      from public.devices d
      join (values ('bkash'), ('nagad')) as w(provider) on true
      cross join s
     where s.auto_pull
       and d.status = 'approved' and d.allow_balance <> false
       and (exists (select 1 from public.device_wallets x where x.device_id = d.id and x.provider = w.provider and x.enabled)
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) j where j->>'provider' = w.provider))
  )
  select w0.id, w0.provider,
         case when p_hour = 0 then 'day_end'
              when w0.held then 'held'
              when w0.gap then 'gap'
              when p_hour = any (public.statement_pull_hours(s.times_per_day)) then 'scheduled'
              else 'busy' end
    from w0 cross join s
   where (p_hour = 0
          or w0.held
          or (w0.gap and coalesce(w0.last_pull, now() - interval '1 day') < now() - interval '3 hours')
          or p_hour = any (public.statement_pull_hours(s.times_per_day))
          or (w0.since_pull >= 8 and coalesce(w0.last_pull, now() - interval '1 day') < now() - interval '2 hours'))
     and not exists (select 1 from public.events e where e.kind = 'statement_pull_auto'
                        and e.detail->>'device_id' = w0.id::text and e.provider = w0.provider
                        and e.at > case when p_hour = 0 then ((now() at time zone 'Asia/Dhaka')::date::timestamp at time zone 'Asia/Dhaka')
                                        else now() - interval '50 minutes' end);
$$;

-- After midnight: the statement for the day that ended, then a balance check (it closes the day at once when nothing
-- moved after the last SMS; the menu gate above makes it wait until the statement is done).
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
      null;
    end;
    if r.why = 'day_end' then
      begin
        insert into public.phone_commands (device_id, kind, provider) values (r.device_id, 'balance', r.provider);
        insert into public.events (kind, provider, detail) values ('balance_pull_auto', r.provider, jsonb_build_object('device_id', r.device_id, 'hour', h, 'why', 'day_end'));
      exception when unique_violation then
        null;
      end;
    end if;
  end loop;
  return n;
end $$;

-- Re-judge the open gaps of the last 14 days with the new rule.
select public.balance_gap_explain(x.device_id, x.provider)
  from (select distinct device_id, provider from public.balance_gaps where explained_by is null and at > now() - interval '14 days') x;
