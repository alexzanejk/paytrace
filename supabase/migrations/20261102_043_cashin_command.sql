-- Cash-in by USSD, told from the dashboard (owner request 2026-11-02).
--
-- The balance check only reads. This one MOVES MONEY, so the limits live here, in the database, where the dashboard
-- cannot talk its way past them, and the phone checks them again before it types the PIN.
--
--   * at most 10,000 Tk in one command (a hard check on the column, not a setting);
--   * a daily limit the owner sets, counted per phone over a Bangladesh day; 0 means cash-in is OFF, which is the start;
--   * the receiving number must look like a Bangladesh mobile number;
--   * one live command per phone, kind and wallet, as before.
--
-- The kind check cannot be widened in place (the MCP hangs on DROP), so the table is renamed and made again, as in 042.

alter table public.phone_commands rename to phone_commands_v2;

create table if not exists public.phone_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  kind text not null check (kind in ('balance', 'cashin')),
  provider text not null check (provider in ('nagad', 'bkash')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Cash-in only. The cap is part of the table: no setting, no dashboard and no stolen session can raise it.
  amount numeric check (amount is null or (amount > 0 and amount <= 10000)),
  to_number text check (to_number is null or to_number ~ '^01[0-9]{9}$'),
  trx_id text check (trx_id is null or trx_id ~ '^[A-Za-z0-9]{1,24}$'),
  balance numeric check (balance is null or (balance >= 0 and balance < 1000000000)),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- A cash-in must say how much and to whom; a balance check must say neither.
  constraint phone_commands_cashin_fields check (
    (kind = 'cashin' and amount is not null and to_number is not null) or
    (kind = 'balance' and amount is null and to_number is null)
  )
);

insert into public.phone_commands (id, device_id, kind, provider, status, balance, error, created_by, created_at, started_at, finished_at)
select id, device_id, kind, provider, status, balance, error, created_by, created_at, started_at, finished_at
from public.phone_commands_v2
on conflict (id) do nothing;

create index if not exists phone_commands_device_idx2 on public.phone_commands (device_id, created_at desc);
create unique index if not exists phone_commands_one_live2 on public.phone_commands (device_id, kind, provider)
  where status in ('queued', 'running');

alter table public.phone_commands enable row level security;

-- The owner's daily allowance for cash-in commands, per phone. 0 (the start) means no cash-in command can be made at all.
create table if not exists public.cashin_limits (
  id boolean primary key default true check (id),
  daily_limit numeric not null default 0 check (daily_limit >= 0 and daily_limit <= 1000000),
  updated_at timestamptz not null default now()
);
insert into public.cashin_limits (id) values (true) on conflict (id) do nothing;
alter table public.cashin_limits enable row level security;

create or replace function public.set_cashin_command_limit(p_daily numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_daily is null or p_daily < 0 or p_daily > 1000000 then raise exception 'bad limit'; end if;
  update public.cashin_limits set daily_limit = round(p_daily, 2), updated_at = now() where id;
  return p_daily;
end $$;
revoke all on function public.set_cashin_command_limit(numeric) from public, anon;
grant execute on function public.set_cashin_command_limit(numeric) to authenticated;

-- What a phone has already sent (or is about to send) today, Bangladesh time.
create or replace function public.cashin_sent_today(p_device uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.phone_commands
  where device_id = p_device and kind = 'cashin'
    and status in ('queued', 'running', 'done')
    and (created_at at time zone 'Asia/Dhaka')::date = (now() at time zone 'Asia/Dhaka')::date
$$;
revoke all on function public.cashin_sent_today(uuid) from public, anon;
grant execute on function public.cashin_sent_today(uuid) to authenticated;

create or replace function public.queue_phone_command(p_device uuid, p_kind text, p_provider text, p_amount numeric, p_to_number text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_limit numeric; v_used numeric;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind <> 'cashin' then raise exception 'bad kind'; end if;
  if p_provider not in ('nagad', 'bkash') then raise exception 'bad wallet'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then raise exception 'bad amount'; end if;
  if p_to_number is null or p_to_number !~ '^01[0-9]{9}$' then raise exception 'bad number'; end if;
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

-- The phone takes its next command on the heartbeat reply. A cash-in also carries the amount and the number.
create or replace function public.device_next_command(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands set status = 'running', started_at = now()
  where id = (
    select id from public.phone_commands
    where device_id = p_device and status = 'queued'
    order by created_at limit 1
  )
  returning jsonb_build_object(
    'id', id, 'kind', kind, 'provider', provider,
    'amount', amount, 'to_number', to_number
  ) into v;
  return v;
end $$;

-- The phone reports back. A cash-in that worked also carries the wallet's own TrxID.
create or replace function public.device_command_result(p_device uuid, p_id uuid, p_ok boolean, p_balance numeric, p_trx text, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  update public.phone_commands
  set status = case when p_ok then 'done' else 'failed' end,
      balance = case when p_ok then p_balance else balance end,
      trx_id = case when p_ok and p_trx ~ '^[A-Za-z0-9]{1,24}$' then p_trx else trx_id end,
      error = case when p_ok then null else coalesce(nullif(p_error, ''), 'failed') end,
      finished_at = now()
  where id = p_id and device_id = p_device and status in ('queued', 'running');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- Admins read the commands and the limit from the dashboard; only the RPCs above ever write them.
create policy phone_commands_read2 on public.phone_commands for select to authenticated using (is_admin());
create policy cashin_limits_read on public.cashin_limits for select to authenticated using (is_admin());
grant select on public.phone_commands to authenticated;
grant select on public.cashin_limits to authenticated;
