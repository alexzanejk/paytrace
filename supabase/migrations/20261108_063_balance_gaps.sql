-- 063: balance gaps (owner 2026-11-08: "rubel said they sent money with B2B money yesterday, the dashboard showed it all
-- as your money").
--
-- WHAT HAPPENED: Tk 7,000 of B2B came into rubel's bKash at 11:23 on 7 Nov. bKash sends no SMS for a B2B in, the
-- phone's balance switch was off that day so no statement was pulled, and by the first pull (17:07) the wallet's
-- 6-entry statement list had long scrolled past it. The B2B float stayed at 0, the whole balance read as "your money",
-- and this morning's B2B out of 7,000 pushed the float to -7,000 ("your money" bigger than the balance).
--
-- PayTrace DID see the money arrive: the next cash-out SMS printed a balance 7,000 higher than the chain explained.
-- Now such a jump is a BALANCE GAP: (1) recorded against the SMS that revealed it (signed: + came in with no SMS,
-- - left with no SMS); (2) the wallet's statement is pulled at once, while the entry is still among the newest, at
-- most once per 10 minutes per wallet; (3) every statement pull tries to explain open gaps from its unmatched lines
-- (a B2B Transfer +7,000 the same day explains a +7,002 gap, the bKash commission being the tolerance); (4) the owner
-- can mark one by hand (B2B / my money / other); (5) an unexplained IN is held back from "your money" like B2B
-- (safer: B2B money must not start a job), and a float below zero is never used as if it were money: jobs and the
-- cash-in rule use `reserved` = greatest(float, 0) + unexplained ins.
-- No DROP, no DELETE (the MCP hangs on both).

create table if not exists public.balance_gaps (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  sim_slot smallint check (sim_slot is null or sim_slot in (0, 1)),
  payment_id uuid not null unique references public.payments(id),  -- the SMS whose balance revealed the gap
  at timestamptz not null,                                        -- that SMS's time: the gap happened before it...
  prev_at timestamptz,                                            -- ...and after the previous message of the wallet
  amount numeric(14, 2) not null,                                 -- signed: + came in with no SMS, - left with no SMS
  tolerance numeric(14, 2) not null default 0.01,                 -- bKash never prints its commission: a tolerance
  prev_balance numeric(14, 2),
  new_balance numeric(14, 2),
  explained_by text check (explained_by is null or explained_by in ('statement', 'owner')),
  explained_kind text,                                            -- a ledger kind (b2b_in, cash_in_sent, ...) or own / other
  explained_at timestamptz,
  statement_line_id uuid references public.statement_lines(id),
  command_id uuid,                                                -- the statement pull this gap started, if any
  note text,
  created_at timestamptz not null default now()
);
create index if not exists balance_gaps_open_idx on public.balance_gaps (device_id, provider, at desc) where explained_by is null;
alter table public.balance_gaps enable row level security;
grant select on public.balance_gaps to authenticated;
create policy balance_gaps_read on public.balance_gaps for select to authenticated using (public.is_admin());

-- ---------- 1. record the gap a just-stored SMS revealed, and ask the wallet's statement at once ----------
-- Service role (the ingest function calls it right after storing a payment whose chain check said mismatch).
-- Returns {gap, amount, pull, device_id, command_id} or {gap: null, why}.
create or replace function public.balance_gap_record(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; prev record; d public.devices; kind text; signed numeric; expected numeric; tol numeric; gap numeric;
  gid uuid; cmd uuid; pull boolean := false; why text := null; can_pull boolean;
begin
  select * into p from public.payments where id = p_payment;
  if p.id is null or p.balance is null or p.device_id is null then return jsonb_build_object('gap', null, 'why', 'no balance or phone'); end if;
  if p.chain_status is distinct from 'mismatch' then return jsonb_build_object('gap', null, 'why', 'chain not broken'); end if;
  if exists (select 1 from public.balance_gaps g where g.payment_id = p_payment) then return jsonb_build_object('gap', null, 'why', 'already recorded'); end if;

  -- The previous message of the same wallet (same phone, same kind of wallet, same SIM or untagged), as the chain check sees it.
  select x.balance, coalesce(x.occurred_at, x.received_at) as at into prev
    from public.payments x
   where x.provider = p.provider and x.source = 'app' and x.balance is not null and x.device_id = p.device_id
     and x.id <> p.id
     and (p.sim_slot is null or x.sim_slot is null or x.sim_slot = p.sim_slot)
     and (coalesce(x.occurred_at, x.received_at), x.received_at) < (coalesce(p.occurred_at, p.received_at), p.received_at)
   order by coalesce(x.occurred_at, x.received_at) desc, x.received_at desc
   limit 1;
  if prev.balance is null then return jsonb_build_object('gap', null, 'why', 'first message of the wallet'); end if;

  kind := public.payment_ledger_kind(p.txn_type, p.review_reason);
  signed := case when public.ledger_is_out(kind) then -p.amount else p.amount end;
  expected := signed - coalesce(p.fee, 0) + coalesce(p.commission, 0);
  gap := round(p.balance - prev.balance - expected, 2);
  -- bKash prints no commission on a cash-out receipt: anything up to the chain check's ceiling may be commission, not a gap.
  tol := case when signed > 0 and coalesce(p.commission, 0) = 0 then greatest(0.02 * abs(p.amount), 1) else 0.01 end;
  if gap > -0.01 and gap <= tol then return jsonb_build_object('gap', null, 'why', 'within commission'); end if;
  if abs(gap) < 1 then return jsonb_build_object('gap', null, 'why', 'under one taka'); end if;

  insert into public.balance_gaps (device_id, provider, sim_slot, payment_id, at, prev_at, amount, tolerance, prev_balance, new_balance)
  values (p.device_id, p.provider, p.sim_slot, p.id, coalesce(p.occurred_at, p.received_at), prev.at, gap, tol, prev.balance, p.balance)
  returning id into gid;

  -- Ask the wallet's statement now, while the entry is still among its newest: bKash lists only ~6, a busy wallet pushes
  -- a line out within the hour. At most once per 10 minutes per wallet; never while a statement is already live.
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
  -- An older pull may already hold the line that explains it.
  perform public.balance_gap_explain(p.device_id, p.provider);
  return jsonb_build_object('gap', gid, 'amount', gap, 'pull', pull, 'why', why, 'device_id', p.device_id, 'command_id', cmd,
                            'explained', exists (select 1 from public.balance_gaps g where g.id = gid and g.explained_by is not null));
end $$;
revoke all on function public.balance_gap_record(uuid) from public, anon, authenticated;
grant execute on function public.balance_gap_record(uuid) to service_role;

-- ---------- 2. explain open gaps from the statement lines no SMS accounts for ----------
-- A line explains a gap when it lies on a day between the wallet's previous message and the revealing SMS, has the same
-- sign, and its amount is within the gap's tolerance (one line per gap, oldest gaps first; no summing of several lines).
-- Returns the gaps explained in this call: [{gap_id, amount, kind, day, line_amount}].
create or replace function public.balance_gap_explain(p_device uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; l record; done jsonb := '[]'::jsonb; d_from date; d_to date;
begin
  for g in select * from public.balance_gaps where device_id = p_device and provider = p_provider and explained_by is null
                                               and at > now() - interval '14 days' order by at
  loop
    d_from := (coalesce(g.prev_at, g.at - interval '1 day') at time zone 'Asia/Dhaka')::date;
    d_to := (g.at at time zone 'Asia/Dhaka')::date;
    -- Lines the ledger shows as statement-only (no SMS twin) in that window, nearest amount first.
    select s.id, s.day, s.amount, public.ledger_kind(s.type, s.amount > 0) as kind into l
      from public.wallet_ledger_rows(p_device, p_provider, d_from, d_to) r
      join public.statement_lines s on s.device_id = p_device and s.provider = p_provider and s.day = r.day and s.amount = r.amount
                                   and public.ledger_kind(s.type, s.amount > 0) = r.kind
     where r.source = 'statement'
       and sign(r.amount) = sign(g.amount)
       and abs(r.amount - g.amount) <= g.tolerance + 0.01
       and not exists (select 1 from public.balance_gaps o where o.statement_line_id = s.id)
     order by abs(r.amount - g.amount), s.occ
     limit 1;
    if l.id is not null then
      update public.balance_gaps set explained_by = 'statement', explained_kind = l.kind, explained_at = now(), statement_line_id = l.id where id = g.id;
      insert into public.events (kind, provider, detail, payment_id) values ('balance_gap_explained', p_provider,
        jsonb_build_object('device_id', p_device, 'gap_id', g.id, 'amount', g.amount, 'kind', l.kind, 'day', l.day, 'line_amount', l.amount, 'by', 'statement'), g.payment_id);
      done := done || jsonb_build_object('gap_id', g.id, 'amount', g.amount, 'kind', l.kind, 'day', l.day, 'line_amount', l.amount);
    end if;
  end loop;
  return done;
end $$;
revoke all on function public.balance_gap_explain(uuid, text) from public, anon, authenticated;
grant execute on function public.balance_gap_explain(uuid, text) to service_role;

-- ---------- 3. the owner's word ----------
create or replace function public.set_balance_gap(p_gap uuid, p_kind text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g public.balance_gaps;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into g from public.balance_gaps where id = p_gap;
  if g.id is null then raise exception 'no such gap'; end if;
  if p_kind not in ('b2b_in', 'cash_in_received', 'send_money_in', 'other_in', 'b2b_out', 'cash_in_sent', 'cash_out_sent', 'other_out', 'own', 'other') then
    raise exception 'bad kind';
  end if;
  if p_kind not in ('own', 'other') and public.ledger_is_out(p_kind) <> (g.amount < 0) then raise exception 'that kind does not fit the direction of this gap'; end if;
  update public.balance_gaps set explained_by = 'owner', explained_kind = p_kind, explained_at = now(), note = left(p_note, 200) where id = p_gap;
  insert into public.events (kind, provider, detail, payment_id) values ('balance_gap_explained', g.provider,
    jsonb_build_object('device_id', g.device_id, 'gap_id', g.id, 'amount', g.amount, 'kind', p_kind, 'by', 'owner', 'user', auth.uid()), g.payment_id);
end $$;
revoke all on function public.set_balance_gap(uuid, text, text) from public, anon;
grant execute on function public.set_balance_gap(uuid, text, text) to authenticated;

-- ---------- 4. the float, with what PayTrace does not yet understand held back ----------
-- Columns in the same order as before, then: pending_in (unexplained ins since the opening), pending_out, reserved =
-- greatest(float, 0) + pending_in = what is NOT the owner's money. A gap the owner marked B2B counts in b2b_in / b2b_out
-- (a gap the statement explained is already in the ledger as that line, so it is not added again).
create or replace view public.wallet_b2b_float as
select d.id as device_id, pr.provider,
       coalesce(f.opening, 0) as opening, f.opening_at,
       coalesce(x.b2b_in, 0) + coalesce(o.owner_in, 0) as b2b_in,
       coalesce(x.b2b_out, 0) + coalesce(o.owner_out, 0) as b2b_out,
       coalesce(f.opening, 0) + coalesce(x.b2b_in, 0) + coalesce(o.owner_in, 0) - coalesce(x.b2b_out, 0) - coalesce(o.owner_out, 0) as float,
       x.last_out_at, x.last_out_amount, x.last_in_at,
       coalesce(o.pending_in, 0) as pending_in,
       coalesce(o.pending_out, 0) as pending_out,
       greatest(coalesce(f.opening, 0) + coalesce(x.b2b_in, 0) + coalesce(o.owner_in, 0) - coalesce(x.b2b_out, 0) - coalesce(o.owner_out, 0), 0)
         + coalesce(o.pending_in, 0) as reserved
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
  left join lateral (
    select sum(g.amount) filter (where g.explained_by is null and g.amount > 0) as pending_in,
           -sum(g.amount) filter (where g.explained_by is null and g.amount < 0) as pending_out,
           sum(g.amount) filter (where g.explained_by = 'owner' and g.explained_kind = 'b2b_in') as owner_in,
           -sum(g.amount) filter (where g.explained_by = 'owner' and g.explained_kind = 'b2b_out') as owner_out
      from public.balance_gaps g
     where g.device_id = d.id and g.provider = pr.provider
       and g.at >= coalesce(f.opening_at, '-infinity'::timestamptz) and g.at > now() - interval '60 days'
  ) o on true
 where d.status = 'approved';
revoke all on public.wallet_b2b_float from anon;
grant select on public.wallet_b2b_float to authenticated;

-- The admin's door to it (migration 060) follows the view's new columns.
create or replace function public.wallet_b2b_floats()
returns setof public.wallet_b2b_float language sql stable security definer set search_path = public as $$
  select * from public.wallet_b2b_float where public.is_admin()
$$;
revoke all on function public.wallet_b2b_floats() from public, anon;
grant execute on function public.wallet_b2b_floats() to authenticated, service_role;

-- Jobs and the cash-in job start from balance minus `reserved` (never from a negative float).
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
       b.balance - coalesce(f.reserved, 0) as own_money,
       coalesce(f.reserved, 0) as b2b_float
  from public.device_balances b
  join public.devices d on d.id = b.device_id and d.status = 'approved'
  join public.job_settings s on s.enabled
  left join public.agent_jobs a on a.device_id = b.device_id and a.provider = b.provider
  left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
 where (b.balance - coalesce(f.reserved, 0)) >= s.threshold
   and coalesce(a.enabled, true)
   and coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider, '') <> ''
   and coalesce(nullif(a.instruction, ''), s.instruction) <> ''
   and not exists (select 1 from public.job_completions c where c.device_id = b.device_id and c.provider = b.provider and c.done_at >= b.at);

create or replace function public.cashin_sync(p_device uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.cashin_settings; r record; n record; rows int;
begin
  select * into s from public.cashin_settings where id;
  update public.cashin_jobs j set status = 'cancelled', checked_at = now()
   where j.device_id = p_device and j.status = 'open'
     and (not s.enabled or coalesce((select b.balance - coalesce(f.reserved, 0)
                                       from public.device_balances b
                                       left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
                                      where b.device_id = j.device_id and b.provider = j.provider), 0) < s.threshold);
  if not s.enabled then return; end if;
  for r in
    select b.provider, b.balance, b.at
      from public.device_balances b
      join public.devices d on d.id = b.device_id and d.status = 'approved'
      left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
     where b.device_id = p_device and (b.balance - coalesce(f.reserved, 0)) >= s.threshold
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

-- ---------- 5. every statement pull also explains open gaps ----------
-- Same body as 061, plus balance_gap_explain at the end; the explained gaps come back under `gaps`.
create or replace function public.statement_lines_record(p_command uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; wsim smallint; n int := 0; added jsonb := '[]'::jsonb; confirmed jsonb := '[]'::jsonb; gaps jsonb := '[]'::jsonb;
begin
  select device_id, provider, item into c from public.phone_commands where id = p_command;
  if c.device_id is null or c.item is not null then return jsonb_build_object('count', 0, 'added', '[]'::jsonb, 'confirmed', '[]'::jsonb, 'gaps', '[]'::jsonb); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return jsonb_build_object('count', 0, 'added', '[]'::jsonb, 'confirmed', '[]'::jsonb, 'gaps', '[]'::jsonb); end if;
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
    insert into public.events (kind, provider, detail) values ('statement_confirm_failed', c.provider, jsonb_build_object('device_id', c.device_id, 'error', left(sqlerrm, 200)));
  end;
  begin
    gaps := public.balance_gap_explain(c.device_id, c.provider);
  exception when others then
    insert into public.events (kind, provider, detail) values ('balance_gap_explain_failed', c.provider, jsonb_build_object('device_id', c.device_id, 'error', left(sqlerrm, 200)));
  end;
  return jsonb_build_object('count', n, 'added', added, 'confirmed', confirmed, 'gaps', gaps, 'device_id', c.device_id, 'provider', c.provider);
end $$;
revoke all on function public.statement_lines_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.statement_lines_record(uuid, jsonb) to service_role;
