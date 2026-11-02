-- Rocket joins the dashboard's phone commands (owner's own recordings, 2026-11-02).
--
-- Rocket's agent menu, dial *322#:
--   1.Cash-In / 2.Cash-Out / 3.Registration / 4.Payment / 5.My Acc / 0.LogOut
--     -> 5 -> 1.Balance / 2.Statement / 3.Change Pin / 4.Account No / 5.Remittance / 6.Help / 7.Activate Account
--     -> 1 -> "Enter Your 4-digit PIN" -> "Your A/C balance: Tk 546.59, Available balance: Tk 546.59."
--
-- The provider check cannot be widened in place (the MCP hangs on DROP), so the table is renamed and made again,
-- as in 042, 043 and 044. Nothing else about it changes.

alter table public.phone_commands rename to phone_commands_v4;

create table if not exists public.phone_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  kind text not null check (kind in ('balance', 'cashin', 'statement')),
  provider text not null check (provider in ('nagad', 'bkash', 'rocket')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Cash-in only. The cap is part of the table: no setting, no dashboard and no stolen session can raise it.
  amount numeric check (amount is null or (amount > 0 and amount <= 10000)),
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
  constraint phone_commands_cashin_fields check (
    (kind = 'cashin' and amount is not null and to_number is not null) or
    (kind in ('balance', 'statement') and amount is null and to_number is null)
  ),
  constraint phone_commands_item_only_for_statement check (item is null or kind = 'statement')
);

insert into public.phone_commands (id, device_id, kind, provider, status, amount, to_number, item, screens, trx_id, balance, error, created_by, created_at, started_at, finished_at)
select id, device_id, kind, provider, status, amount, to_number, item, screens, trx_id, balance, error, created_by, created_at, started_at, finished_at
from public.phone_commands_v4
on conflict (id) do nothing;

create index if not exists phone_commands_device_idx4 on public.phone_commands (device_id, created_at desc);
create unique index if not exists phone_commands_one_live4 on public.phone_commands (device_id, kind, provider)
  where status in ('queued', 'running');

alter table public.phone_commands enable row level security;

-- The three places that name the wallets. Everything else about them is unchanged.
create or replace function public.queue_phone_command(p_device uuid, p_kind text, p_provider text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_kind <> 'balance' or p_provider not in ('nagad', 'bkash', 'rocket') then raise exception 'unsupported command'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, created_by)
      values (p_device, p_kind, p_provider, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'a check is already waiting for this phone';
  end;
  insert into public.events (kind, provider, detail)
    values ('phone_command_queued', p_provider, jsonb_build_object('device_id', p_device, 'command', p_kind, 'id', new_id, 'by', auth.uid()));
  return new_id;
end $$;
revoke all on function public.queue_phone_command(uuid, text, text) from public, anon;
grant execute on function public.queue_phone_command(uuid, text, text) to authenticated;

create or replace function public.queue_phone_command(p_device uuid, p_kind text, p_provider text, p_amount numeric, p_to_number text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_limit numeric; v_used numeric;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind <> 'cashin' then raise exception 'bad kind'; end if;
  if p_provider not in ('nagad', 'bkash', 'rocket') then raise exception 'bad wallet'; end if;
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

create or replace function public.queue_statement_command(p_device uuid, p_provider text, p_item int)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('nagad', 'bkash', 'rocket') then raise exception 'bad wallet'; end if;
  if p_item is not null and (p_item < 1 or p_item > 40) then raise exception 'bad entry'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, item, created_by)
      values (p_device, 'statement', p_provider, p_item, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'a statement is already waiting for this phone';
  end;
  insert into public.events (kind, provider, detail)
    values ('phone_command_queued', p_provider, jsonb_build_object('device_id', p_device, 'command', 'statement', 'item', p_item, 'id', new_id, 'by', auth.uid()));
  return new_id;
end $$;
revoke all on function public.queue_statement_command(uuid, text, int) from public, anon;
grant execute on function public.queue_statement_command(uuid, text, int) to authenticated;

create policy phone_commands_read4 on public.phone_commands for select to authenticated using (is_admin());
grant select on public.phone_commands to authenticated;
