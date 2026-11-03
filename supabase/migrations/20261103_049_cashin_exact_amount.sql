-- 049: manual cash-in from the dashboard with an EXACT amount (owner 2026-11-04): 100 to 50,000 Tk, typed, and the
-- receiving number chosen from the owner's SAVED cash-in numbers (cashin_numbers, enabled) instead of typed free.
-- The partner-side cash-in JOBS (threshold, "I did it") are untouched.
--
-- The per-command cap lives in a CHECK on phone_commands, and a CHECK cannot be widened through the MCP (DROP hangs),
-- so the table is remade once more (v6), exactly as 046 did, with the new bounds. The view device_day_flows follows a
-- renamed table by identity, so it is created again at the end to point at the new one.

alter table public.phone_commands rename to phone_commands_v6;

create table if not exists public.phone_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  kind text not null references public.phone_command_kinds(kind),
  provider text check (provider is null or provider in ('nagad', 'bkash', 'rocket', 'upay')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Cash-in only. The bounds are part of the table: no setting, no dashboard and no stolen session can move them.
  amount numeric check (amount is null or (amount >= 100 and amount <= 50000)),
  to_number text check (to_number is null or to_number ~ '^01[0-9]{9}$'),
  item int check (item is null or (item >= 1 and item <= 40)),
  screens jsonb check (screens is null or (jsonb_typeof(screens) = 'array' and jsonb_array_length(screens) <= 12)),
  trx_id text check (trx_id is null or trx_id ~ '^[A-Za-z0-9]{1,24}$'),
  balance numeric check (balance is null or (balance >= 0 and balance < 1000000000)),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint phone_commands_wallet_or_not check (
    (kind in ('balance', 'cashin', 'statement') and provider is not null) or
    (kind not in ('balance', 'cashin', 'statement') and provider is null)
  ),
  constraint phone_commands_cashin_fields check (
    (kind = 'cashin' and amount is not null and to_number is not null) or
    (kind <> 'cashin' and amount is null and to_number is null)
  ),
  constraint phone_commands_item_only_for_statement check (item is null or kind = 'statement')
);

insert into public.phone_commands (id, device_id, kind, provider, status, amount, to_number, item, screens, trx_id, balance, error, created_by, created_at, started_at, finished_at)
select id, device_id, kind, provider, status, amount, to_number, item, screens, trx_id, balance, error, created_by, created_at, started_at, finished_at
from public.phone_commands_v6
on conflict (id) do nothing;

create index if not exists phone_commands_device_idx6 on public.phone_commands (device_id, created_at desc);
create unique index if not exists phone_commands_one_live6 on public.phone_commands (device_id, kind, coalesce(provider, ''))
  where status in ('queued', 'running');

alter table public.phone_commands enable row level security;
create policy phone_commands_read6 on public.phone_commands for select to authenticated using (is_admin());
grant select on public.phone_commands to authenticated;

-- The dashboard's manual cash-in. New rules: 100..50,000, and the number must be one of the owner's saved, enabled
-- cash-in numbers for that wallet (so a typo can never send money to a stranger). The daily limit still applies.
create or replace function public.queue_phone_command(p_device uuid, p_kind text, p_provider text, p_amount numeric, p_to_number text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_limit numeric; v_used numeric;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind <> 'cashin' then raise exception 'bad kind'; end if;
  if p_provider not in ('nagad', 'bkash') then raise exception 'bad wallet'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 50000 then raise exception 'the amount must be between 100 and 50,000'; end if;
  if p_to_number is null or p_to_number !~ '^01[0-9]{9}$' then raise exception 'bad number'; end if;
  if not exists (select 1 from public.cashin_numbers where provider = p_provider and number = p_to_number and enabled) then
    raise exception 'that number is not one of the saved cash-in numbers for this wallet';
  end if;
  if not exists (select 1 from public.devices where id = p_device and status = 'approved') then
    raise exception 'unknown phone';
  end if;

  select daily_limit into v_limit from public.cashin_limits where id;
  if coalesce(v_limit, 0) <= 0 then raise exception 'cash in is switched off'; end if;
  select public.cashin_sent_today(p_device) into v_used;
  if v_used + p_amount > v_limit then raise exception 'over the daily limit'; end if;

  perform public.phone_commands_tidy(p_device);
  insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by)
  values (p_device, 'cashin', p_provider, round(p_amount, 2), p_to_number, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.queue_phone_command(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.queue_phone_command(uuid, text, text, numeric, text) to authenticated;

-- Point the money-flow view at the new table (it followed the rename).
create or replace view public.device_day_flows with (security_invoker = true) as
select day, device_id, provider, kind, count(*)::int as n, sum(amount) as amount
  from (
    select (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date as day, device_id, provider,
           case when review_reason = 'b2b_transfer_out' then 'b2b_out' else 'cash_out' end as kind, amount
      from public.payments
     where source = 'app'
       and ((txn_type = 'cash_out' and status in ('unmatched', 'matched', 'tracked_only')) or review_reason = 'b2b_transfer_out')
    union all
    select (coalesce(finished_at, created_at) at time zone 'Asia/Dhaka')::date, device_id, provider, 'cash_in', amount
      from public.phone_commands
     where kind = 'cashin' and status = 'done' and amount is not null and provider is not null
    union all
    select (coalesce(submitted_at, checked_at, created_at) at time zone 'Asia/Dhaka')::date, device_id, provider, 'cash_in', amount
      from public.cashin_jobs
     where status = 'verified' and amount is not null
  ) x
 group by 1, 2, 3, 4;
revoke all on public.device_day_flows from anon;
grant select on public.device_day_flows to authenticated;
