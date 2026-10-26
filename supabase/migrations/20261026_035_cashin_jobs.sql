-- Cash-in jobs (owner request 2026-10-26). When an agent wallet's balance reaches the owner's amount (default 8,000 Tk), the partner gets a job:
-- "cash in to this personal number". The number comes from a list the owner saves per provider (bKash, Nagad, Rocket, Upay); a bKash wallet
-- gets a bKash number, and when there are several the least recently handed out one is used (rotation). The partner cashes in outside the app,
-- then types the cash-in amount and the commission they earned on it. PayTrace remembers the wallet's balance at that moment and checks it against
-- the NEXT Cash Out message for the same wallet:
--   balance printed in that message - cash-out amount - cash-out commission  =  balance before the cash-out  =  old balance - cash-in + cash-in commission
-- Same rules as the sent-money check (migration 024): exact to 1 paisa when the message prints its commission (Nagad, Rocket), a plausible
-- bKash commission (0.30% to 0.60% of the cash-out, +/- 0.50) when it does not. One correction, then the owner decides.
-- Assumption: the cash-in commission is credited to the wallet balance right away, like cash-out commission is.
-- Additive only (the Supabase MCP hangs on statements that remove things, so none are used).

create table public.cashin_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  threshold numeric(14, 2) not null default 8000 check (threshold > 0 and threshold <= 100000000),
  urgency text not null default 'urgent' check (urgency in ('normal', 'urgent', 'critical')),
  instruction text not null default 'Cash in from your {provider} agent wallet to this personal number, then tap "I did it" and type the cash-in amount and your commission.'
    check (char_length(instruction) <= 1000)
);
insert into public.cashin_settings (id) values (true);

create table public.cashin_numbers (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  number text not null check (number ~ '^01[0-9]{9}$'),
  label text check (label is null or char_length(label) <= 40),
  enabled boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, number)
);

create table public.cashin_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  number text not null,
  balance numeric(14, 2) not null,
  balance_at timestamptz not null,
  urgency text not null default 'urgent',
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'checking', 'mismatch', 'review', 'verified', 'rejected', 'cancelled')),
  amount numeric(14, 2) check (amount is null or (amount > 0 and amount <= 100000000)),
  commission numeric(14, 2) check (commission is null or (commission >= 0 and commission <= 1000000)),
  base_balance numeric(14, 2),
  base_at timestamptz,
  submitted_at timestamptz,
  attempts int not null default 1 check (attempts between 1 and 2),
  payment_id uuid references public.payments(id),
  prior_balance numeric(14, 2),
  diff numeric(14, 2),
  checked_at timestamptz,
  resolved_by uuid,
  note text
);
-- one live job per phone wallet: two requests at the same moment cannot make two
create unique index cashin_jobs_one_live on public.cashin_jobs (device_id, provider) where status in ('open', 'checking', 'mismatch', 'review');
create index cashin_jobs_device_idx on public.cashin_jobs (device_id, provider, created_at desc);

alter table public.cashin_settings enable row level security;
alter table public.cashin_numbers enable row level security;
alter table public.cashin_jobs enable row level security;
create policy cashin_settings_read on public.cashin_settings for select to authenticated using (public.is_admin());
create policy cashin_numbers_read on public.cashin_numbers for select to authenticated using (public.is_admin());
create policy cashin_jobs_read on public.cashin_jobs for select to authenticated using (public.is_admin());
revoke all on public.cashin_settings, public.cashin_numbers, public.cashin_jobs from anon, authenticated;
grant select on public.cashin_settings, public.cashin_numbers, public.cashin_jobs to authenticated;

-- ============ Owner: settings and the list of personal numbers ============
create or replace function public.set_cashin_settings(p_enabled boolean, p_threshold numeric, p_instruction text, p_urgency text)
returns void language plpgsql security definer set search_path = public as $$
declare txt text := btrim(coalesce(p_instruction, ''));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_threshold is null or p_threshold <= 0 or p_threshold > 100000000 then raise exception 'the amount must be more than zero'; end if;
  if p_urgency is null or p_urgency not in ('normal', 'urgent', 'critical') then raise exception 'urgency must be normal, urgent or critical'; end if;
  if txt = '' or char_length(txt) > 1000 then raise exception 'write the instruction (up to 1000 characters)'; end if;
  update public.cashin_settings set enabled = coalesce(p_enabled, false), threshold = p_threshold, instruction = txt, urgency = p_urgency where id;
  insert into public.events(kind, detail) values ('cashin_settings_set', jsonb_build_object('enabled', p_enabled, 'threshold', p_threshold, 'by', auth.uid()));
end $$;
revoke all on function public.set_cashin_settings(boolean, numeric, text, text) from public, anon;
grant execute on function public.set_cashin_settings(boolean, numeric, text, text) to authenticated;

create or replace function public.add_cashin_number(p_provider text, p_number text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g'); lab text := left(nullif(btrim(coalesce(p_label, '')), ''), 40);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'choose bKash, Nagad, Rocket or Upay'; end if;
  if left(d, 3) = '880' and char_length(d) = 13 then d := '0' || substr(d, 4); end if;
  if d !~ '^01[0-9]{9}$' then raise exception 'a mobile number has 11 digits and starts with 01'; end if;
  insert into public.cashin_numbers (provider, number, label) values (p_provider, d, lab)
    on conflict (provider, number) do update set enabled = true, label = coalesce(excluded.label, public.cashin_numbers.label);
  insert into public.events(kind, provider, detail) values ('cashin_number_added', p_provider, jsonb_build_object('by', auth.uid()));
end $$;
revoke all on function public.add_cashin_number(text, text, text) from public, anon;
grant execute on function public.add_cashin_number(text, text, text) to authenticated;

create or replace function public.set_cashin_number_enabled(p_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.cashin_numbers set enabled = coalesce(p_enabled, false) where id = p_id;
  if not found then raise exception 'number not found'; end if;
end $$;
revoke all on function public.set_cashin_number_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_cashin_number_enabled(uuid, boolean) to authenticated;

-- ============ The check ============
create or replace function public.cashin_fits(p_job public.cashin_jobs, p_pay public.payments)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  expected numeric := p_job.base_balance - p_job.amount + p_job.commission;
  commission numeric;
  prior numeric;
  fits boolean;
begin
  if coalesce(p_pay.commission, 0) > 0 then
    prior := p_pay.balance - p_pay.amount - p_pay.commission;
    fits := abs(prior - expected) < 0.015;
    return jsonb_build_object('fits', fits, 'prior', prior, 'diff', prior - expected);
  end if;
  commission := p_pay.balance - p_pay.amount - expected;
  fits := commission >= p_pay.amount * 0.003 - 0.5 and commission <= p_pay.amount * 0.006 + 0.5;
  return jsonb_build_object('fits', fits, 'prior', p_pay.balance - p_pay.amount - commission,
                            'diff', case when fits then 0 else commission - p_pay.amount * 0.0045 end);
end $$;

create or replace function public.cashin_judge(p_id uuid, p_payment uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t public.cashin_jobs; p public.payments; r jsonb; s text;
begin
  select * into t from public.cashin_jobs where id = p_id for update;
  select * into p from public.payments where id = p_payment;
  if t.id is null or p.id is null then return 'missing'; end if;
  r := public.cashin_fits(t, p);
  if (r ->> 'fits')::boolean then s := 'verified';
  elsif t.attempts >= 2 then s := 'review';
  else s := 'mismatch';
  end if;
  update public.cashin_jobs
     set status = s, payment_id = p.id, prior_balance = (r ->> 'prior')::numeric, diff = (r ->> 'diff')::numeric, checked_at = now()
   where id = t.id;
  insert into public.events(kind, provider, payment_id, detail)
  values ('cashin_job_' || s, t.provider, p.id, jsonb_build_object('job_id', t.id, 'device_id', t.device_id, 'diff', (r ->> 'diff')::numeric));
  return s;
end $$;
revoke all on function public.cashin_judge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cashin_judge(uuid, uuid) to service_role;

-- Runs on every stored message; must never stop a payment from being saved, so any problem is swallowed.
create or replace function public.trg_cashin_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid;
begin
  if new.source = 'app' and new.txn_type = 'cash_out' and new.device_id is not null and new.balance is not null then
    select id into t_id from public.cashin_jobs
     where device_id = new.device_id and provider = new.provider and status = 'checking'
       and submitted_at < coalesce(new.occurred_at, new.received_at)
     order by submitted_at limit 1;
    if t_id is not null then perform public.cashin_judge(t_id, new.id); end if;
  end if;
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.trg_cashin_check() from public, anon, authenticated;
create trigger payments_cashin_check after insert on public.payments
  for each row execute function public.trg_cashin_check();

-- ============ Making the job appear ============
-- Called with every jobs request from the phone. A wallet at or above the owner's amount gets ONE job with ONE number (the least recently given
-- number of the same provider). It does not come back for the same balance message: a new job needs a newer balance reading. An unstarted job whose
-- wallet has gone under the amount (or the feature was switched off) is cancelled.
create or replace function public.cashin_sync(p_device uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.cashin_settings; r record; n record; rows int;
begin
  select * into s from public.cashin_settings where id;
  update public.cashin_jobs j set status = 'cancelled', checked_at = now()
   where j.device_id = p_device and j.status = 'open'
     and (not s.enabled or coalesce((select b.balance from public.device_balances b where b.device_id = j.device_id and b.provider = j.provider), 0) < s.threshold);
  if not s.enabled then return; end if;
  for r in
    select b.provider, b.balance, b.at
      from public.device_balances b
      join public.devices d on d.id = b.device_id and d.status = 'approved'
     where b.device_id = p_device and b.balance >= s.threshold
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
revoke all on function public.cashin_sync(uuid) from public, anon, authenticated;
grant execute on function public.cashin_sync(uuid) to service_role;

-- ============ The partner's side ============
create or replace function public.device_cashin_sent(p_device uuid, p_provider text, p_amount numeric, p_commission numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.cashin_jobs; b record; c numeric := coalesce(p_commission, 0);
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
  if p_amount > b.balance then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  update public.cashin_jobs
     set status = 'checking', amount = p_amount, commission = c, base_balance = b.balance, base_at = b.at, submitted_at = now()
   where id = j.id;
  insert into public.events(kind, provider, detail)
  values ('cashin_job_submitted', p_provider, jsonb_build_object('job_id', j.id, 'device_id', p_device, 'amount', p_amount, 'commission', c));
  return jsonb_build_object('ok', true, 'id', j.id);
end $$;
revoke all on function public.device_cashin_sent(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_cashin_sent(uuid, text, numeric, numeric) to service_role;

create or replace function public.device_cashin_fix(p_device uuid, p_id uuid, p_amount numeric, p_commission numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.cashin_jobs; c numeric := coalesce(p_commission, 0); s text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 or c > p_amount then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  select * into t from public.cashin_jobs where id = p_id and device_id = p_device for update;
  if t.id is null or t.status <> 'mismatch' or t.attempts >= 2 or t.payment_id is null then return jsonb_build_object('ok', false, 'error', 'not_fixable'); end if;
  if p_amount > t.base_balance then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  update public.cashin_jobs set amount = p_amount, commission = c, attempts = 2 where id = t.id;
  s := public.cashin_judge(t.id, t.payment_id);
  return jsonb_build_object('ok', true, 'status', s);
end $$;
revoke all on function public.device_cashin_fix(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_cashin_fix(uuid, uuid, numeric, numeric) to service_role;

-- The owner settles a cash-in by hand, or cancels one the partner has not started.
create or replace function public.resolve_cashin_job(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_decision not in ('verified', 'rejected', 'cancelled') then raise exception 'choose verified, rejected or cancelled'; end if;
  update public.cashin_jobs
     set status = p_decision, resolved_by = auth.uid(), checked_at = now(), note = left(nullif(btrim(coalesce(p_note, '')), ''), 300)
   where id = p_id and ((p_decision = 'cancelled' and status = 'open') or (p_decision <> 'cancelled' and status in ('checking', 'mismatch', 'review')));
  if not found then raise exception 'that one cannot be changed that way'; end if;
  insert into public.events(kind, detail) values ('cashin_job_' || p_decision || '_by_owner', jsonb_build_object('job_id', p_id));
end $$;
revoke all on function public.resolve_cashin_job(uuid, text, text) from public, anon;
grant execute on function public.resolve_cashin_job(uuid, text, text) to authenticated;

-- A crypto send must not start while a cash-in for the same wallet is waiting for its cash-out message (the two checks would share one message).
create or replace function public.device_job_sent(p_device uuid, p_provider text, p_amount numeric, p_charge numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; v_id uuid; c numeric := coalesce(p_charge, 0);
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then return jsonb_build_object('ok', false, 'error', 'bad_provider'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if exists (select 1 from public.job_transfers where device_id = p_device and provider = p_provider and status in ('checking', 'mismatch'))
     or exists (select 1 from public.cashin_jobs where device_id = p_device and provider = p_provider and status in ('checking', 'mismatch')) then
    return jsonb_build_object('ok', false, 'error', 'already_waiting');
  end if;
  select balance, at into b from public.device_balances where device_id = p_device and provider = p_provider;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_balance'); end if;
  if p_amount + c > b.balance then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  insert into public.job_transfers(device_id, provider, amount, charge, base_balance, base_at)
  values (p_device, p_provider, p_amount, c, b.balance, b.at) returning id into v_id;
  insert into public.job_completions(device_id, provider, balance) values (p_device, p_provider, b.balance);
  insert into public.events(kind, provider, detail)
  values ('job_transfer_submitted', p_provider, jsonb_build_object('transfer_id', v_id, 'device_id', p_device, 'amount', p_amount, 'charge', c));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.device_job_sent(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_job_sent(uuid, text, numeric, numeric) to service_role;

-- The phone's list: the owner's balance jobs (kind "send"), then the cash-in jobs (kind "cashin", wallet = the personal number), and the recent
-- submissions of both kinds. For a cash-in the "charge" field carries the partner's commission.
create or replace function public.device_jobs(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    null; -- a problem here must never hide the owner's other jobs
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
           'threshold', s.threshold,
           'wallet', c.number,
           'network', '',
           'instruction', replace(replace(replace(replace(s.instruction, '{agent}', coalesce(nullif(d.name, ''), d.pair_code)),
                                  '{provider}', coalesce(names ->> c.provider, c.provider)),
                                  '{balance}', 'Tk ' || to_char(c.balance, 'FM999,999,999,990.00')),
                                  '{number}', c.number)
         ) order by case c.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, c.balance desc), '[]'::jsonb)
    into v_cash
    from public.cashin_jobs c join public.devices d on d.id = c.device_id
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
revoke all on function public.device_jobs(uuid) from public, anon, authenticated;
grant execute on function public.device_jobs(uuid) to service_role;
