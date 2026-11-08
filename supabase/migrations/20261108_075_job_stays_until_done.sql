-- 075: a job the partner has been shown stays until they say they did it (owner 2026-11-08: "recently rocket showed a job, but
-- when he cashed that money in to his personal account the job disappeared, so he can't send money now").
--
-- What happened (SADIKUR's phone, Rocket, 8 Nov): the Taka job appeared at 7:29 PM at a balance of Tk 28,347. At 8:02 PM the
-- partner did the first half of the job, a Cash In of Tk 28,300 from the agent wallet to his own account. That message dropped
-- the balance to Tk 181, and cashin_sync cancelled the job 5 seconds later "because the money fell under the amount". With the
-- job gone the "I did it" button was gone too, and even with the button the phone's answer would have been refused as
-- "too_much" (the typed amount was compared with the NEW balance) and then judged against a balance that had already dropped.
-- A crypto job had the same three faults: the view showed it only while the newest balance was above the amount.
--
-- Now:
--  * A shown job stays until the partner sends "I did it" / "I sent it", the owner cancels it, the wallet's job is switched
--    (to another kind or off), or jobs are switched off. Falling balance no longer removes it. Taka jobs already have a row
--    (cashin_jobs); crypto jobs get one (job_shown), written by crypto_job_sync on the phone's heartbeat, and the view
--    device_open_jobs now reads it (same columns as before).
--  * The typed amount may be as large as the balance the job was shown at (or the balance now, whichever is larger).
--  * Proof by message: a Cash In or Send Money message from that wallet, after the job was shown, of EXACTLY the typed amount,
--    not already used by another job, verifies the job at once (at submit if it already arrived, or when it arrives). The old
--    check against the next Cash Out still runs when no such message exists (money that left with no SMS).
--  * Removing one of our numbers no longer cancels a shown Taka job: the job gets another of our numbers.
--  * Rocket's agent cash-in ("B2C: Cash-In to A/C: ... Comm: ...") was read by the generic reader as money RECEIVED and held for
--    review (the parser fix is in the ingest function). The three stored ones are corrected here, and the false balance gap the
--    8 Nov one made (Tk -56,600) is closed.
-- No DROP or DELETE (the Supabase MCP hangs on them).

-- ---------------------------------------------------------------- crypto jobs get a memory
create table if not exists public.job_shown (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  balance numeric(14, 2) not null,
  balance_at timestamptz not null,
  shown_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text
);
create unique index if not exists job_shown_one_open on public.job_shown (device_id, provider) where closed_at is null;
alter table public.job_shown enable row level security;
create policy job_shown_read on public.job_shown for select to authenticated using (public.is_admin());

alter table public.job_transfers add column if not exists since timestamptz;
alter table public.job_transfers add column if not exists shown_balance numeric(14, 2);

-- Shows, keeps, raises and closes the crypto job of one phone. Called with every jobs request and when the owner changes a job.
create or replace function public.crypto_job_sync(p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.job_settings;
begin
  select * into s from public.job_settings limit 1;
  -- closed: the partner said they did it, the wallet's job is no longer crypto, jobs are off, the phone is gone,
  -- or the wallet has no address / text to show
  update public.job_shown js
     set closed_at = now(),
         close_reason = case when exists (select 1 from public.job_completions c where c.device_id = js.device_id and c.provider = js.provider and c.done_at >= js.shown_at)
                             then 'done' else 'switched' end
   where js.device_id = p_device and js.closed_at is null
     and (exists (select 1 from public.job_completions c where c.device_id = js.device_id and c.provider = js.provider and c.done_at >= js.shown_at)
          or s.id is null or not s.enabled
          or not exists (select 1 from public.devices d where d.id = js.device_id and d.status = 'approved')
          or (select w.kind from public.wallet_job_of(js.device_id, js.provider) w) <> 'crypto'
          or coalesce((select nullif(a.wallet, '') from public.agent_jobs a where a.device_id = js.device_id and a.provider = js.provider), s.wallets ->> js.provider, '') = ''
          or coalesce((select nullif(a.instruction, '') from public.agent_jobs a where a.device_id = js.device_id and a.provider = js.provider), s.instruction, '') = '');
  if s.id is null or not s.enabled then return; end if;
  -- the wallet's newest reading, while it is at or above the amount and not yet answered by "I sent it"
  with cur as (
    select b.device_id, b.provider, b.balance, b.at
      from public.device_balances b
      join public.devices d on d.id = b.device_id and d.status = 'approved'
      left join public.agent_jobs a on a.device_id = b.device_id and a.provider = b.provider
      left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
      cross join lateral public.wallet_job_of(b.device_id, b.provider) w
     where b.device_id = p_device and w.kind = 'crypto'
       and b.balance - coalesce(f.reserved, 0) >= w.threshold
       and coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider, '') <> ''
       and coalesce(nullif(a.instruction, ''), s.instruction, '') <> ''
       and not exists (select 1 from public.job_completions c where c.device_id = b.device_id and c.provider = b.provider and c.done_at >= b.at)
  ), raised as (
    -- more money came in while the job was shown: show the newer balance (the phone rings again for it, as before)
    update public.job_shown js set balance = cur.balance, balance_at = cur.at
      from cur
     where js.device_id = cur.device_id and js.provider = cur.provider and js.closed_at is null and cur.at > js.balance_at
    returning js.provider
  )
  insert into public.job_shown (device_id, provider, balance, balance_at)
  select cur.device_id, cur.provider, cur.balance, cur.at from cur
   where not exists (select 1 from public.job_shown js where js.device_id = cur.device_id and js.provider = cur.provider and js.closed_at is null)
  on conflict do nothing;
end $$;
revoke all on function public.crypto_job_sync(uuid) from public, anon, authenticated;
grant execute on function public.crypto_job_sync(uuid) to service_role;

-- The crypto job as the phone sees it: every shown, still-open job (same columns as before; balance = the reading it was shown at).
create or replace view public.device_open_jobs with (security_invoker = true) as
select js.device_id, js.provider, js.balance, js.balance_at, w.threshold::numeric(14,2) as threshold,
       coalesce(nullif(a.instruction, ''), s.instruction) as instruction,
       coalesce(nullif(a.wallet, ''), s.wallets ->> js.provider) as wallet,
       coalesce(a.urgency, s.urgency) as urgency,
       coalesce(nullif(a.agent_name, ''), nullif(d.name, ''), d.pair_code) as agent_name,
       coalesce(nullif(a.network, ''), s.network) as network,
       b.balance - coalesce(f.reserved, 0) as own_money,
       coalesce(f.reserved, 0) as b2b_float
  from public.job_shown js
  join public.devices d on d.id = js.device_id and d.status = 'approved'
  join public.job_settings s on s.enabled
  cross join lateral public.wallet_job_of(js.device_id, js.provider) w
  left join public.agent_jobs a on a.device_id = js.device_id and a.provider = js.provider
  left join public.device_balances b on b.device_id = js.device_id and b.provider = js.provider
  left join public.wallet_b2b_float f on f.device_id = js.device_id and f.provider = js.provider
 where js.closed_at is null and w.kind = 'crypto'
   and coalesce(nullif(a.wallet, ''), s.wallets ->> js.provider, '') <> ''
   and coalesce(nullif(a.instruction, ''), s.instruction) <> '';

-- ---------------------------------------------------------------- Taka jobs stay
create or replace function public.cashin_sync(p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.cashin_settings; r record; n record; rows int;
begin
  select * into s from public.cashin_settings where id;
  -- Cancelled only when the job is switched (another kind, off) or jobs are switched off; marked 'switched', so switching back
  -- gives the wallet its job again at once. A falling balance no longer cancels a shown job: the partner may already be moving
  -- the money out (075).
  update public.cashin_jobs j set status = 'cancelled', checked_at = now(), note = 'switched'
   where j.device_id = p_device and j.status = 'open'
     and (not s.enabled or (select w.kind from public.wallet_job_of(j.device_id, j.provider) w) <> 'cashin');
  if not s.enabled then return; end if;
  -- An open job whose number of ours was removed gets another of our numbers (074 used to cancel it).
  for r in
    select j.id, j.provider from public.cashin_jobs j
     where j.device_id = p_device and j.status = 'open'
       and not exists (select 1 from public.cashin_numbers n where n.number = j.number and n.enabled)
  loop
    select id, number into n from public.cashin_numbers
     where enabled and (provider = r.provider or provider in ('bkash', 'nagad'))
     order by (provider = r.provider) desc, (provider = 'bkash') desc, last_assigned_at asc nulls first, created_at
     limit 1;
    if n.id is not null then
      update public.cashin_jobs set number = n.number where id = r.id;
      update public.cashin_numbers set last_assigned_at = now() where id = n.id;
    end if;
  end loop;
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

-- Removing a number no longer cancels the job that shows it; cashin_sync gives that job another number.
create or replace function public.remove_cashin_number(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n public.cashin_numbers; dev uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.cashin_numbers set enabled = false, removed_at = now() where id = p_id returning * into n;
  if n.id is null then raise exception 'number not found'; end if;
  for dev in select distinct device_id from public.cashin_jobs where number = n.number and status = 'open' loop
    perform public.cashin_sync(dev);
  end loop;
  insert into public.events (kind, provider, detail) values ('cashin_number_removed', n.provider, jsonb_build_object('number', n.number, 'by', auth.uid()));
end $$;

-- ---------------------------------------------------------------- proof by message
-- The oldest message from this wallet, at or after p_since, saying exactly p_amount LEFT it by Cash In or Send Money, that no
-- other job has used yet.
create or replace function public.job_outflow_match(p_device uuid, p_provider text, p_since timestamptz, p_amount numeric)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.payments p
   where p.device_id = p_device and p.provider = p_provider
     and p.review_reason in ('cash_in_sent', 'send_money_sent')
     and p.amount = p_amount
     and coalesce(p.occurred_at, p.received_at) >= coalesce(p_since, '-infinity'::timestamptz)
     and not exists (select 1 from public.cashin_jobs j where j.payment_id = p.id)
     and not exists (select 1 from public.job_transfers t where t.payment_id = p.id)
   order by coalesce(p.occurred_at, p.received_at)
   limit 1;
$$;
revoke all on function public.job_outflow_match(uuid, text, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.job_outflow_match(uuid, text, timestamptz, numeric) to service_role;

-- "I did it" for a Taka job.
create or replace function public.device_cashin_sent(p_device uuid, p_provider text, p_amount numeric, p_commission numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.cashin_jobs; b record; c numeric := coalesce(p_commission, 0); m uuid;
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then return jsonb_build_object('ok', false, 'error', 'bad_provider'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 or c > p_amount then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  select * into j from public.cashin_jobs where device_id = p_device and provider = p_provider and status in ('open', 'checking', 'mismatch', 'review') for update;
  if j.id is null then return jsonb_build_object('ok', false, 'error', 'no_job'); end if;
  if j.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'already_waiting'); end if;
  if exists (select 1 from public.job_transfers where device_id = p_device and provider = p_provider and status in ('checking', 'mismatch')) then
    return jsonb_build_object('ok', false, 'error', 'already_waiting');
  end if;
  select balance, at into b from public.device_balances where device_id = p_device and provider = p_provider;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_balance'); end if;
  -- the money may already have left: up to the balance the job was shown at
  if p_amount > greatest(b.balance, j.balance) then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  update public.cashin_jobs
     set status = 'checking', amount = p_amount, commission = c, base_balance = b.balance, base_at = b.at, submitted_at = now()
   where id = j.id;
  insert into public.events(kind, provider, detail)
  values ('cashin_job_submitted', p_provider, jsonb_build_object('job_id', j.id, 'device_id', p_device, 'amount', p_amount, 'commission', c));
  m := public.job_outflow_match(p_device, p_provider, j.balance_at, p_amount);
  if m is not null then
    update public.cashin_jobs set status = 'verified', payment_id = m, diff = 0, checked_at = now() where id = j.id;
    insert into public.events(kind, provider, payment_id, detail)
    values ('cashin_job_verified', p_provider, m, jsonb_build_object('job_id', j.id, 'device_id', p_device, 'by', 'message'));
    return jsonb_build_object('ok', true, 'id', j.id, 'status', 'verified');
  end if;
  return jsonb_build_object('ok', true, 'id', j.id);
end $$;
revoke all on function public.device_cashin_sent(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_cashin_sent(uuid, text, numeric, numeric) to service_role;

create or replace function public.device_cashin_fix(p_device uuid, p_id uuid, p_amount numeric, p_commission numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.cashin_jobs; c numeric := coalesce(p_commission, 0); s text; m uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 or c > p_amount then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  select * into t from public.cashin_jobs where id = p_id and device_id = p_device for update;
  if t.id is null or t.status <> 'mismatch' or t.attempts >= 2 or t.payment_id is null then return jsonb_build_object('ok', false, 'error', 'not_fixable'); end if;
  if p_amount > greatest(t.base_balance, t.balance) then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  update public.cashin_jobs set amount = p_amount, commission = c, attempts = 2 where id = t.id;
  m := public.job_outflow_match(p_device, t.provider, t.balance_at, p_amount);
  if m is not null then
    update public.cashin_jobs set status = 'verified', payment_id = m, diff = 0, checked_at = now() where id = t.id;
    insert into public.events(kind, provider, payment_id, detail)
    values ('cashin_job_verified', t.provider, m, jsonb_build_object('job_id', t.id, 'device_id', p_device, 'by', 'message'));
    return jsonb_build_object('ok', true, 'status', 'verified');
  end if;
  s := public.cashin_judge(t.id, t.payment_id);
  return jsonb_build_object('ok', true, 'status', s);
end $$;
revoke all on function public.device_cashin_fix(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_cashin_fix(uuid, uuid, numeric, numeric) to service_role;

-- "I sent it" for a crypto job.
create or replace function public.device_job_sent(p_device uuid, p_provider text, p_amount numeric, p_charge numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; js public.job_shown; v_id uuid; c numeric := coalesce(p_charge, 0); since timestamptz; m uuid;
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then return jsonb_build_object('ok', false, 'error', 'bad_provider'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if exists (select 1 from public.job_transfers where device_id = p_device and provider = p_provider and status in ('checking', 'mismatch'))
     or exists (select 1 from public.cashin_jobs where device_id = p_device and provider = p_provider and status in ('checking', 'mismatch')) then
    return jsonb_build_object('ok', false, 'error', 'already_waiting');
  end if;
  select balance, at into b from public.device_balances where device_id = p_device and provider = p_provider;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_balance'); end if;
  select * into js from public.job_shown where device_id = p_device and provider = p_provider and closed_at is null for update;
  since := coalesce(js.balance_at, b.at);
  -- the money may already have left: up to the balance the job was shown at
  if p_amount + c > greatest(b.balance, coalesce(js.balance, 0)) then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  insert into public.job_transfers(device_id, provider, amount, charge, base_balance, base_at, since, shown_balance)
  values (p_device, p_provider, p_amount, c, b.balance, b.at, since, js.balance) returning id into v_id;
  insert into public.job_completions(device_id, provider, balance) values (p_device, p_provider, b.balance);
  if js.id is not null then update public.job_shown set closed_at = now(), close_reason = 'done' where id = js.id; end if;
  insert into public.events(kind, provider, detail)
  values ('job_transfer_submitted', p_provider, jsonb_build_object('transfer_id', v_id, 'device_id', p_device, 'amount', p_amount, 'charge', c));
  m := public.job_outflow_match(p_device, p_provider, since, p_amount);
  if m is not null then
    update public.job_transfers set status = 'verified', payment_id = m, diff = 0, checked_at = now() where id = v_id;
    insert into public.events(kind, provider, payment_id, detail)
    values ('job_transfer_verified', p_provider, m, jsonb_build_object('transfer_id', v_id, 'device_id', p_device, 'by', 'message'));
    return jsonb_build_object('ok', true, 'id', v_id, 'status', 'verified');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.device_job_sent(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_job_sent(uuid, text, numeric, numeric) to service_role;

create or replace function public.device_job_fix(p_device uuid, p_id uuid, p_amount numeric, p_charge numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.job_transfers; c numeric := coalesce(p_charge, 0); s text; m uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  select * into t from public.job_transfers where id = p_id and device_id = p_device for update;
  if t.id is null or t.status <> 'mismatch' or t.attempts >= 2 or t.payment_id is null then return jsonb_build_object('ok', false, 'error', 'not_fixable'); end if;
  if p_amount + c > greatest(t.base_balance, coalesce(t.shown_balance, 0)) then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  update public.job_transfers set amount = p_amount, charge = c, attempts = 2 where id = t.id;
  m := public.job_outflow_match(p_device, t.provider, coalesce(t.since, t.base_at), p_amount);
  if m is not null then
    update public.job_transfers set status = 'verified', payment_id = m, diff = 0, checked_at = now() where id = t.id;
    insert into public.events(kind, provider, payment_id, detail)
    values ('job_transfer_verified', t.provider, m, jsonb_build_object('transfer_id', t.id, 'device_id', p_device, 'by', 'message'));
    return jsonb_build_object('ok', true, 'status', 'verified');
  end if;
  s := public.job_transfer_judge(t.id, t.payment_id);
  return jsonb_build_object('ok', true, 'status', s);
end $$;
revoke all on function public.device_job_fix(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_job_fix(uuid, uuid, numeric, numeric) to service_role;

-- Old app builds' "Done": still only while the job is shown, and it closes the shown job.
create or replace function public.device_job_done(p_device uuid, p_provider text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_balance numeric;
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then return false; end if;
  select balance into v_balance from public.device_open_jobs where device_id = p_device and provider = p_provider;
  if not found then return false; end if;
  insert into public.job_completions(device_id, provider, balance) values (p_device, p_provider, v_balance);
  update public.job_shown set closed_at = now(), close_reason = 'done' where device_id = p_device and provider = p_provider and closed_at is null;
  insert into public.events(kind, provider, detail) values ('job_done', p_provider, jsonb_build_object('device_id', p_device, 'balance', v_balance));
  return true;
end $$;
revoke all on function public.device_job_done(uuid, text) from public, anon, authenticated;
grant execute on function public.device_job_done(uuid, text) to service_role;

-- A Cash In / Send Money message that arrives AFTER "I did it": settles the waiting job of the same wallet and amount.
-- Must never stop a payment from being saved, so any problem is swallowed.
create or replace function public.trg_job_outflow_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid; v_at timestamptz := coalesce(new.occurred_at, new.received_at);
begin
  if new.device_id is null or coalesce(new.review_reason, '') not in ('cash_in_sent', 'send_money_sent') then return new; end if;
  select id into t_id from public.cashin_jobs
   where device_id = new.device_id and provider = new.provider and status in ('checking', 'mismatch')
     and amount = new.amount and balance_at <= v_at
   order by submitted_at limit 1;
  if t_id is not null then
    update public.cashin_jobs set status = 'verified', payment_id = new.id, diff = 0, checked_at = now() where id = t_id;
    insert into public.events(kind, provider, payment_id, detail)
    values ('cashin_job_verified', new.provider, new.id, jsonb_build_object('job_id', t_id, 'device_id', new.device_id, 'by', 'message'));
    return new;
  end if;
  select id into t_id from public.job_transfers
   where device_id = new.device_id and provider = new.provider and status in ('checking', 'mismatch')
     and amount = new.amount and coalesce(since, base_at, submitted_at) <= v_at
   order by submitted_at limit 1;
  if t_id is not null then
    update public.job_transfers set status = 'verified', payment_id = new.id, diff = 0, checked_at = now() where id = t_id;
    insert into public.events(kind, provider, payment_id, detail)
    values ('job_transfer_verified', new.provider, new.id, jsonb_build_object('transfer_id', t_id, 'device_id', new.device_id, 'by', 'message'));
  end if;
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.trg_job_outflow_check() from public, anon, authenticated;
create trigger payments_job_outflow_check after insert on public.payments
  for each row execute function public.trg_job_outflow_check();

-- ---------------------------------------------------------------- the phone's list (073 + the crypto sync)
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

-- Switching a wallet's job takes effect at once for both kinds.
create or replace function public.set_wallet_job(p_device uuid, p_provider text, p_kind text, p_threshold numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'unknown wallet'; end if;
  if p_kind is not null and p_kind not in ('crypto', 'cashin', 'off') then raise exception 'the job must be crypto, cash in or none'; end if;
  if p_threshold is not null and (p_threshold < 100 or p_threshold > 100000000) then raise exception 'the amount must be at least Tk 100'; end if;
  if not exists (select 1 from public.devices where id = p_device and status = 'approved') then raise exception 'phone not found'; end if;
  insert into public.agent_jobs (device_id, provider, enabled, job_kind, threshold, updated_at, updated_by)
  values (p_device, p_provider, true, p_kind, round(p_threshold, 2), now(), auth.uid())
  on conflict (device_id, provider) do update
    set enabled = true, job_kind = excluded.job_kind, threshold = excluded.threshold, updated_at = now(), updated_by = auth.uid();
  insert into public.events (kind, provider, detail) values ('wallet_job_set', p_provider,
    jsonb_build_object('device_id', p_device, 'job', p_kind, 'threshold', p_threshold, 'by', auth.uid()));
  perform public.cashin_sync(p_device);
  perform public.crypto_job_sync(p_device);
end $$;

-- Every phone's crypto job as it stands now (so the switch to this rule shows no gap before the first heartbeat).
do $$ declare d uuid; begin
  for d in select id from public.devices where status = 'approved' loop perform public.crypto_job_sync(d); end loop;
end $$;

-- ---------------------------------------------------------------- Rocket's agent cash-in, read wrongly until now
update public.payments p
   set status = 'ignored', review_reason = 'cash_in_sent',
       chain_status = case when p.balance_delta is not null and abs(p.balance_delta - (p.commission - p.amount)) < 0.015 then 'ok' else p.chain_status end
 where p.provider = 'rocket' and p.txn_type = 'unknown' and p.status = 'review' and p.review_reason = 'balance_chain_mismatch'
   and p.raw_message ~* 'B2C\s*:?\s*Cash[\s-]*In\s+to\s+A/C'
   and not exists (select 1 from public.orders o where o.payment_id = p.id);
update public.balance_gaps g
   set explained_by = 'owner', explained_kind = 'cash_in_sent', explained_at = now(),
       note = 'Not a gap: a Rocket Cash In message that PayTrace read the wrong way round (fixed 8 Nov)'
 where g.explained_by is null
   and exists (select 1 from public.payments p where p.id = g.payment_id and p.review_reason = 'cash_in_sent' and p.chain_status = 'ok');

-- SADIKUR's Rocket job (shown 8 Nov 7:29 PM, cancelled at 8:02 PM by the old rule when he cashed the money out): back on his
-- phone, so he can tap "I did it". Only if nothing else is live for that wallet and the wallet's job is still Taka.
update public.cashin_jobs j set status = 'open', checked_at = null, note = null
 where j.id = 'a3f58713-08a3-4a5e-983f-ba1fd7fc280a' and j.status = 'cancelled' and j.submitted_at is null
   and (select w.kind from public.wallet_job_of(j.device_id, j.provider) w) = 'cashin'
   and not exists (select 1 from public.cashin_jobs k where k.device_id = j.device_id and k.provider = j.provider
                     and k.status in ('open', 'checking', 'mismatch', 'review'));
