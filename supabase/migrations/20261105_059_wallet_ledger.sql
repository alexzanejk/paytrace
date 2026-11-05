-- 059: the wallet ledger and the B2B float (owner 2026-11-05).
--
-- WHY: the wallet apps show every transaction in time order; PayTrace showed only what arrived as an SMS, and the B2B
-- money a distributor puts into an agent wallet counted as the owner's money, so jobs fired on it. Now (1) every line
-- the wallet's own statement lists is KEPT (statement_lines) instead of being thrown away after the comparison; (2) a
-- wallet ledger merges SMS rows and statement lines into one ordered list (wallet_ledger), a statement line that
-- matches an SMS becomes one row, a line with no SMS is placed between its neighbours; (3) a B2B float per wallet
-- (opening amount set by the owner + B2B in - B2B out, from the ledger) and jobs start from balance minus float;
-- (4) the statement of every bKash/Nagad wallet is pulled on a schedule so the ledger fills itself.
-- No DROP, no DELETE (the MCP hangs on both). Old rows are kept; the ledger shows at most 31 days at a time.

-- ---------- the statement lines, kept ----------
create table if not exists public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  sim_slot smallint check (sim_slot is null or sim_slot in (0, 1)),
  day date not null,
  type text not null,
  amount numeric(14, 2) not null,              -- signed, the wallet's own way: + came in, - left
  occ integer not null check (occ >= 1),       -- the n-th identical (day, type, amount) line, counted from the newest end
  list_pos integer not null,                   -- position in the newest pull that listed it (0 = the wallet's newest entry)
  command_id uuid,                             -- that pull
  first_seen_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  unique (device_id, provider, day, type, amount, occ)
);
create index if not exists statement_lines_wallet_idx on public.statement_lines (device_id, provider, day desc);
alter table public.statement_lines enable row level security;
grant select on public.statement_lines to authenticated;
create policy statement_lines_read on public.statement_lines for select to authenticated using (public.is_admin());

-- The ingest function hands over the lines it read from a finished statement command ({no, day, amount, in, type}, in
-- the wallet's order: no 1 = newest). Lines already known are refreshed, new ones inserted and returned (for alerts).
create or replace function public.statement_lines_record(p_command uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; wsim smallint; n int := 0; added jsonb := '[]'::jsonb;
begin
  select device_id, provider, item into c from public.phone_commands where id = p_command;
  if c.device_id is null or c.item is not null then return jsonb_build_object('count', 0, 'added', '[]'::jsonb); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return jsonb_build_object('count', 0, 'added', '[]'::jsonb); end if;
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
  return jsonb_build_object('count', n, 'added', added, 'device_id', c.device_id, 'provider', c.provider);
end $$;
revoke all on function public.statement_lines_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.statement_lines_record(uuid, jsonb) to service_role;

-- ---------- one vocabulary for both sources ----------
-- Kinds: cash_out (a customer's Cash Out at the agent: money IN), send_money_in, payment_in, cash_in_received,
-- b2b_in, commission_in, other_in; b2b_out, cash_in_sent, cash_out_sent, payment_sent, bill_paid, loan_repaid,
-- send_money_out, other_out.
create or replace function public.ledger_is_out(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('b2b_out', 'cash_in_sent', 'cash_out_sent', 'payment_sent', 'bill_paid', 'loan_repaid', 'send_money_out', 'other_out');
$$;

-- A statement line's kind, from the wallet's own words and the sign.
create or replace function public.ledger_kind(p_text text, p_in boolean) returns text language sql immutable as $$
  select case
    when t ~ 'b2b' then case when p_in then 'b2b_in' else 'b2b_out' end
    when t ~ 'commission' then case when p_in then 'commission_in' else 'other_out' end
    when t ~ 'cash\s*in' then case when p_in then 'cash_in_received' else 'cash_in_sent' end
    when t ~ 'cash\s*out' then case when p_in then 'cash_out' else 'cash_out_sent' end
    when t ~ 'send money|received|transfer in' then case when p_in then 'send_money_in' else 'send_money_out' end
    when t ~ 'payment' then case when p_in then 'payment_in' else 'payment_sent' end
    when t ~ 'bill' then 'bill_paid'
    when t ~ 'loan' then 'loan_repaid'
    else case when p_in then 'other_in' else 'other_out' end end
  from (select lower(coalesce(p_text, '')) as t) x;
$$;

-- A stored SMS row's kind.
create or replace function public.payment_ledger_kind(p_txn_type text, p_reason text) returns text language sql immutable as $$
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
    when p_reason = 'bill_paid' then 'bill_paid'
    when p_reason = 'loan_repaid' then 'loan_repaid'
    else 'other_in' end;
$$;

-- ---------- the ledger ----------
-- SMS rows of the wallet (its own SIM, plus rows from before the app said the SIM) and the statement lines of the same
-- days. A statement line matches an SMS row when day, kind and amount agree (the n-th such line to the n-th such SMS,
-- both counted from the newest); it then rides on the SMS row as source 'both'. A line with no SMS is its own row,
-- source 'statement', placed just after the nearest OLDER matched line in the wallet's own list order (lines last
-- seen in an older pull are older than everything in a newer pull, because a pull always lists the newest entries).
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
revoke all on function public.wallet_ledger_rows(uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.wallet_ledger_rows(uuid, text, date, date) to service_role;

create or replace function public.wallet_ledger(p_device uuid, p_provider text, p_from date, p_to date)
returns table (
  sort_at timestamptz, exact_time boolean, day date, kind text, label text, amount numeric, balance numeric,
  trx_id text, status text, review_reason text, chain_status text, source text, raw text, payment_id uuid,
  sim_slot smallint, counterparty text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then raise exception 'pick at most 31 days'; end if;
  return query select * from public.wallet_ledger_rows(p_device, p_provider, p_from, p_to);
end $$;
revoke all on function public.wallet_ledger(uuid, text, date, date) from public, anon;
grant execute on function public.wallet_ledger(uuid, text, date, date) to authenticated;

-- ---------- the B2B float ----------
create table if not exists public.wallet_floats (
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  opening numeric(14, 2) not null default 0 check (opening >= 0 and opening <= 10000000),
  opening_at timestamptz not null default now(),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (device_id, provider)
);
alter table public.wallet_floats enable row level security;
grant select on public.wallet_floats to authenticated;
create policy wallet_floats_read on public.wallet_floats for select to authenticated using (public.is_admin());

create or replace function public.set_wallet_b2b_opening(p_device uuid, p_provider text, p_amount numeric, p_at timestamptz default now(), p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'bad wallet'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000000 then raise exception 'bad amount'; end if;
  insert into public.wallet_floats (device_id, provider, opening, opening_at, note, updated_at, updated_by)
  values (p_device, p_provider, round(p_amount, 2), coalesce(p_at, now()), left(p_note, 200), now(), auth.uid())
  on conflict (device_id, provider) do update
    set opening = excluded.opening, opening_at = excluded.opening_at, note = excluded.note, updated_at = now(), updated_by = auth.uid();
  insert into public.events (kind, provider, detail)
    values ('b2b_opening_set', p_provider, jsonb_build_object('device_id', p_device, 'opening', round(p_amount, 2), 'at', coalesce(p_at, now()), 'by', auth.uid()));
end $$;
revoke all on function public.set_wallet_b2b_opening(uuid, text, numeric, timestamptz, text) from public, anon;
grant execute on function public.set_wallet_b2b_opening(uuid, text, numeric, timestamptz, text) to authenticated;

-- Per approved phone and wallet type: opening + B2B in - B2B out since the opening moment (at most the last 60 days),
-- from the ledger, so a statement-only B2B line counts too. float can go below zero when the opening is set too low.
create or replace view public.wallet_b2b_float as
select d.id as device_id, pr.provider,
       coalesce(f.opening, 0) as opening, f.opening_at,
       coalesce(x.b2b_in, 0) as b2b_in, coalesce(x.b2b_out, 0) as b2b_out,
       coalesce(f.opening, 0) + coalesce(x.b2b_in, 0) - coalesce(x.b2b_out, 0) as float,
       x.last_out_at, x.last_out_amount, x.last_in_at
  from public.devices d
 cross join (values ('bkash'), ('nagad'), ('rocket'), ('upay')) as pr(provider)
  left join public.wallet_floats f on f.device_id = d.id and f.provider = pr.provider
  left join lateral (
    select sum(r.amount) filter (where r.kind = 'b2b_in') as b2b_in,
           -sum(r.amount) filter (where r.kind = 'b2b_out') as b2b_out,
           max(r.sort_at) filter (where r.kind = 'b2b_out') as last_out_at,
           (array_agg(-r.amount order by r.sort_at desc) filter (where r.kind = 'b2b_out'))[1] as last_out_amount,
           max(r.sort_at) filter (where r.kind = 'b2b_in') as last_in_at
      from public.wallet_ledger_rows(d.id, pr.provider,
             greatest(coalesce((f.opening_at at time zone 'Asia/Dhaka')::date, (now() at time zone 'Asia/Dhaka')::date - 60), (now() at time zone 'Asia/Dhaka')::date - 60),
             (now() at time zone 'Asia/Dhaka')::date + 1) r
     where r.sort_at >= coalesce(f.opening_at, '-infinity'::timestamptz)
  ) x on true
 where d.status = 'approved';
revoke all on public.wallet_b2b_float from anon;
grant select on public.wallet_b2b_float to authenticated;

-- Jobs start from the owner's money: balance minus the B2B float (columns added at the end; the old ones are unchanged).
create or replace view public.device_open_jobs with (security_invoker = true) as
select b.device_id,
       b.provider,
       b.balance,
       b.at as balance_at,
       s.threshold,
       coalesce(nullif(a.instruction, ''), s.instruction) as instruction,
       coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider) as wallet,
       coalesce(a.urgency, s.urgency) as urgency,
       coalesce(nullif(a.agent_name, ''), nullif(d.name, ''), d.pair_code) as agent_name,
       coalesce(nullif(a.network, ''), s.network) as network,
       b.balance - coalesce(f.float, 0) as own_money,
       coalesce(f.float, 0) as b2b_float
  from public.device_balances b
  join public.devices d on d.id = b.device_id and d.status = 'approved'
  join public.job_settings s on s.enabled
  left join public.agent_jobs a on a.device_id = b.device_id and a.provider = b.provider
  left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
 where (b.balance - coalesce(f.float, 0)) >= s.threshold
   and coalesce(a.enabled, true)
   and coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider, '') <> ''
   and coalesce(nullif(a.instruction, ''), s.instruction) <> ''
   and not exists (select 1 from public.job_completions c where c.device_id = b.device_id and c.provider = b.provider and c.done_at >= b.at);

-- The cash-in job does the same (identical to before except the two balance tests).
create or replace function public.cashin_sync(p_device uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.cashin_settings; r record; n record; rows int;
begin
  select * into s from public.cashin_settings where id;
  update public.cashin_jobs j set status = 'cancelled', checked_at = now()
   where j.device_id = p_device and j.status = 'open'
     and (not s.enabled or coalesce((select b.balance - coalesce(f.float, 0)
                                       from public.device_balances b
                                       left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
                                      where b.device_id = j.device_id and b.provider = j.provider), 0) < s.threshold);
  if not s.enabled then return; end if;
  for r in
    select b.provider, b.balance, b.at
      from public.device_balances b
      join public.devices d on d.id = b.device_id and d.status = 'approved'
      left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
     where b.device_id = p_device and (b.balance - coalesce(f.float, 0)) >= s.threshold
       and not exists (select 1 from public.cashin_jobs j where j.device_id = b.device_id and j.provider = b.provider
                          and (j.status in ('open', 'checking', 'mismatch', 'review') or j.balance_at >= b.at))
       and not exists (select 1 from public.job_transfers t where t.device_id = b.device_id and t.provider = b.provider and t.status in ('checking', 'mismatch'))
  loop
    select id, number into n from public.cashin_numbers where provider = r.provider and enabled
     order by last_assigned_at asc nulls first, created_at limit 1;
    if n.id is not null then
      insert into public.cashin_jobs (device_id, provider, number, balance, balance_at, urgency)
      values (p_device, r.provider, n.number, r.balance, r.at, s.urgency) on conflict do nothing;
      get diagnostics rows = row_count;
      if rows > 0 then update public.cashin_numbers set last_assigned_at = now() where id = n.id; end if;
    end if;
  end loop;
end $$;

-- ---------- the statement pulled on a schedule ----------
create table if not exists public.ledger_settings (
  id boolean primary key default true check (id),
  auto_pull boolean not null default true,
  times_per_day integer not null default 2 check (times_per_day between 1 and 4),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.ledger_settings (id) values (true) on conflict do nothing;
alter table public.ledger_settings enable row level security;
grant select on public.ledger_settings to authenticated;
create policy ledger_settings_read on public.ledger_settings for select to authenticated using (public.is_admin());

create or replace function public.set_ledger_settings(p_auto boolean, p_times integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_times is null or p_times < 1 or p_times > 4 then raise exception 'times per day must be 1 to 4'; end if;
  update public.ledger_settings set auto_pull = coalesce(p_auto, auto_pull), times_per_day = p_times, updated_at = now(), updated_by = auth.uid() where id;
end $$;
revoke all on function public.set_ledger_settings(boolean, integer) from public, anon;
grant execute on function public.set_ledger_settings(boolean, integer) to authenticated;

-- The pull hours (Bangladesh time) for a number of pulls a day: 10:00, then every 24/n hours.
create or replace function public.statement_pull_hours(p_times integer) returns integer[] language sql immutable as $$
  select array_agg(((10 + i * (24 / greatest(p_times, 1))) % 24) order by i) from generate_series(0, greatest(p_times, 1) - 1) i;
$$;

-- Called every hour by pg_cron. Queues a statement command for every bKash and Nagad wallet of an approved phone that
-- is allowed balance checks, in the pull hours, once per hour at most; the phone takes it on its next heartbeat.
create or replace function public.statement_pull_tick() returns integer
language plpgsql security definer set search_path = public as $$
declare s public.ledger_settings; h int; r record; n int := 0;
begin
  select * into s from public.ledger_settings where id;
  if s.id is null or not s.auto_pull then return 0; end if;
  h := extract(hour from (now() at time zone 'Asia/Dhaka'))::int;
  if not (h = any (public.statement_pull_hours(s.times_per_day))) then return 0; end if;
  for r in
    select d.id as device_id, w.provider
      from public.devices d
      join (values ('bkash'), ('nagad')) as w(provider) on true
     where d.status = 'approved' and d.allow_balance <> false
       and (exists (select 1 from public.device_wallets x where x.device_id = d.id and x.provider = w.provider and x.enabled)
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) j where j->>'provider' = w.provider))
       and not exists (select 1 from public.events e where e.kind = 'statement_pull_auto' and e.at > now() - interval '50 minutes'
                          and e.detail->>'device_id' = d.id::text and e.provider = w.provider)
  loop
    perform public.phone_commands_tidy(r.device_id);
    begin
      insert into public.phone_commands (device_id, kind, provider) values (r.device_id, 'statement', r.provider);
      insert into public.events (kind, provider, detail) values ('statement_pull_auto', r.provider, jsonb_build_object('device_id', r.device_id, 'hour', h));
      n := n + 1;
    exception when unique_violation then
      null; -- a statement is already live on that phone
    end;
  end loop;
  return n;
end $$;
revoke all on function public.statement_pull_tick() from public, anon, authenticated;
grant execute on function public.statement_pull_tick() to service_role;

select cron.schedule('paytrace-statement-pull', '7 * * * *', $$select public.statement_pull_tick()$$);
