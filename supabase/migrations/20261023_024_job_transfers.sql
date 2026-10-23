-- Sent-money check (owner request 2026-10-23). When an agent sends money out to the owner's wallet there is no SMS in the phone's inbox, so
-- PayTrace cannot see it. Instead the partner types what they sent (amount and the P2P charge) in the app. PayTrace remembers the wallet's
-- last known balance, works out what the balance should be after the send, and checks it against the NEXT Cash Out message for that wallet:
--   balance printed in that message - cash-out amount - commission  =  balance before the cash-out  =  old balance - amount sent - charge
-- Match = verified (green). No match = one correction by the partner, then the owner's Review (red).
-- Nagad and Rocket print the commission (stored as 0 when a message has none), so the match is exact (1 paisa). bKash does not, so the leftover must be a normal bKash commission
-- (0.30% to 0.60% of the cash-out, plus 50 paisa for rounding); real bKash commission measured 0.40%.
-- Additive only. No DROP or DELETE (the Supabase MCP hangs on them).

create table public.job_transfers (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000),
  charge numeric(14, 2) not null default 0 check (charge >= 0 and charge <= 1000000),
  base_balance numeric(14, 2) not null,
  base_at timestamptz,
  submitted_at timestamptz not null default now(),
  status text not null default 'checking' check (status in ('checking', 'mismatch', 'review', 'verified', 'rejected')),
  attempts int not null default 1 check (attempts between 1 and 2),
  payment_id uuid references public.payments(id),
  prior_balance numeric(14, 2),
  diff numeric(14, 2),
  checked_at timestamptz,
  resolved_by uuid,
  note text
);
create index job_transfers_device_idx on public.job_transfers (device_id, provider, submitted_at desc);
create index job_transfers_open_idx on public.job_transfers (device_id, provider, submitted_at) where status in ('checking', 'mismatch');

alter table public.job_transfers enable row level security;
create policy job_transfers_read on public.job_transfers for select to authenticated using (public.is_admin());
revoke all on public.job_transfers from anon, authenticated;
grant select on public.job_transfers to authenticated;

-- Does this cash-out message fit the send the partner typed? Returns the leftover (what the message implies minus what was expected).
create or replace function public.job_transfer_fits(p_transfer public.job_transfers, p_pay public.payments)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  expected numeric := p_transfer.base_balance - p_transfer.amount - p_transfer.charge;
  commission numeric;
  prior numeric;
  fits boolean;
begin
  if coalesce(p_pay.commission, 0) > 0 then
    prior := p_pay.balance - p_pay.amount - p_pay.commission;
    commission := p_pay.commission;
    fits := abs(prior - expected) < 0.015;
    return jsonb_build_object('fits', fits, 'prior', prior, 'diff', prior - expected);
  end if;
  -- commission not printed: the leftover IS the commission, and must look like one
  commission := p_pay.balance - p_pay.amount - expected;
  prior := expected;
  fits := commission >= p_pay.amount * 0.003 - 0.5 and commission <= p_pay.amount * 0.006 + 0.5;
  return jsonb_build_object('fits', fits, 'prior', p_pay.balance - p_pay.amount - commission,
                            'diff', case when fits then 0 else commission - p_pay.amount * 0.0045 end);
end $$;

-- Judges one waiting send against one cash-out message and records the result.
create or replace function public.job_transfer_judge(p_id uuid, p_payment uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t public.job_transfers; p public.payments; r jsonb; s text;
begin
  select * into t from public.job_transfers where id = p_id for update;
  select * into p from public.payments where id = p_payment;
  if t.id is null or p.id is null then return 'missing'; end if;
  r := public.job_transfer_fits(t, p);
  if (r ->> 'fits')::boolean then s := 'verified';
  elsif t.attempts >= 2 then s := 'review';
  else s := 'mismatch';
  end if;
  update public.job_transfers
     set status = s, payment_id = p.id, prior_balance = (r ->> 'prior')::numeric, diff = (r ->> 'diff')::numeric, checked_at = now()
   where id = t.id;
  insert into public.events(kind, provider, payment_id, detail)
  values ('job_transfer_' || s, t.provider, p.id, jsonb_build_object('transfer_id', t.id, 'device_id', t.device_id, 'diff', (r ->> 'diff')::numeric));
  return s;
end $$;
revoke all on function public.job_transfer_judge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.job_transfer_judge(uuid, uuid) to service_role;

-- Runs on every stored message: a Cash Out with a balance settles the oldest send still waiting for this phone and wallet.
-- It must never stop a payment from being saved, so any problem is swallowed.
create or replace function public.trg_job_transfer_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid;
begin
  if new.source = 'app' and new.txn_type = 'cash_out' and new.device_id is not null and new.balance is not null then
    select id into t_id from public.job_transfers
     where device_id = new.device_id and provider = new.provider and status = 'checking'
       and submitted_at < coalesce(new.occurred_at, new.received_at)
     order by submitted_at limit 1;
    if t_id is not null then perform public.job_transfer_judge(t_id, new.id); end if;
  end if;
  return new;
exception when others then
  return new;
end $$;
create trigger payments_job_transfer_check after insert on public.payments
  for each row execute function public.trg_job_transfer_check();

-- The partner says: I sent this much, with this charge.
create or replace function public.device_job_sent(p_device uuid, p_provider text, p_amount numeric, p_charge numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; v_id uuid; c numeric := coalesce(p_charge, 0);
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then return jsonb_build_object('ok', false, 'error', 'bad_provider'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if exists (select 1 from public.job_transfers where device_id = p_device and provider = p_provider and status in ('checking', 'mismatch')) then
    return jsonb_build_object('ok', false, 'error', 'already_waiting');
  end if;
  select balance, at into b from public.device_balances where device_id = p_device and provider = p_provider;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_balance'); end if;
  if p_amount + c > b.balance then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  insert into public.job_transfers(device_id, provider, amount, charge, base_balance, base_at)
  values (p_device, p_provider, p_amount, c, b.balance, b.at) returning id into v_id;
  -- the job is hidden until a newer balance message arrives, exactly like Done
  insert into public.job_completions(device_id, provider, balance) values (p_device, p_provider, b.balance);
  insert into public.events(kind, provider, detail)
  values ('job_transfer_submitted', p_provider, jsonb_build_object('transfer_id', v_id, 'device_id', p_device, 'amount', p_amount, 'charge', c));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.device_job_sent(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_job_sent(uuid, text, numeric, numeric) to service_role;

-- One correction: the partner retypes the numbers and the SAME cash-out message is judged again. A second miss goes to the owner.
create or replace function public.device_job_fix(p_device uuid, p_id uuid, p_amount numeric, p_charge numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.job_transfers; c numeric := coalesce(p_charge, 0); s text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or c < 0 or c > 1000000 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  select * into t from public.job_transfers where id = p_id and device_id = p_device for update;
  if t.id is null or t.status <> 'mismatch' or t.attempts >= 2 or t.payment_id is null then return jsonb_build_object('ok', false, 'error', 'not_fixable'); end if;
  if p_amount + c > t.base_balance then return jsonb_build_object('ok', false, 'error', 'too_much'); end if;
  update public.job_transfers set amount = p_amount, charge = c, attempts = 2 where id = t.id;
  s := public.job_transfer_judge(t.id, t.payment_id);
  return jsonb_build_object('ok', true, 'status', s);
end $$;
revoke all on function public.device_job_fix(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.device_job_fix(uuid, uuid, numeric, numeric) to service_role;

-- The owner settles a send by hand (a mismatch they have looked into, or one that never got its cash-out message).
create or replace function public.resolve_job_transfer(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'choose verified or rejected'; end if;
  update public.job_transfers
     set status = p_decision, resolved_by = auth.uid(), checked_at = now(), note = left(nullif(btrim(coalesce(p_note, '')), ''), 300)
   where id = p_id and status in ('checking', 'mismatch', 'review');
  if not found then raise exception 'that one is already settled'; end if;
  insert into public.events(kind, detail) values ('job_transfer_' || p_decision || '_by_owner', jsonb_build_object('transfer_id', p_id));
end $$;
revoke all on function public.resolve_job_transfer(uuid, text, text) from public, anon;
grant execute on function public.resolve_job_transfer(uuid, text, text) to authenticated;

-- The phone's list also carries its recent sends (no leftover numbers: the partner must not be able to tune the numbers to fit).
create or replace function public.device_jobs(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb;
  v_transfers jsonb;
  names constant jsonb := '{"bkash":"bKash","nagad":"Nagad","rocket":"Rocket","upay":"Upay"}'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
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
           'id', x.id, 'provider', x.provider, 'amount', x.amount, 'charge', x.charge, 'status', x.status,
           'attempts', x.attempts, 'submitted_at', x.submitted_at) order by x.submitted_at desc), '[]'::jsonb)
    into v_transfers
    from (select * from public.job_transfers
           where device_id = p_device and submitted_at > now() - interval '3 days'
           order by submitted_at desc limit 8) x;
  return jsonb_build_object('jobs', v_jobs, 'transfers', v_transfers);
end $$;
revoke all on function public.device_jobs(uuid) from public, anon, authenticated;
grant execute on function public.device_jobs(uuid) to service_role;
