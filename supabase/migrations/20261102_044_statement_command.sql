-- Ask a phone for its wallet's own statement (owner request 2026-11-02).
--
-- WHY: when a phone's balance does not match what PayTrace has stored, the wallet's own statement is the only way to
-- see which transaction never arrived as an SMS. bKash's agent menu has it under My bKash -> Request Statement:
--
--   Statement List:                                  and, choosing an entry:     Cash In Tk -200.00
--   1 02/11/26 Cash In -Tk -200.00                                               Fee Tk 0.00
--   2 29/10/26 Cash Out -Tk 500.00                                               From 01706630756
--   3 28/10/26 Cash Out -Tk 500.00                                               To 01846632612
--   4 28/10/26 Cash Out -Tk 500.00                                               TrxID DK29URXBHB
--   # NEXT                                                                       At 02/11/2026 06:24:45
--
-- The list alone shows a missing transaction; the entry's own screen gives the TrxID that proves it. So a statement
-- command is either "bring back the list" (item is null) or "open entry N" (item is 1 and up).
--
-- This only READS. No money moves, so there is no limit to set and no switch to turn on: the phone's existing
-- balance-check switch already governs whether it answers the dashboard at all.
--
-- The phone sends back the screens as they were WRITTEN, not as it understood them, so the reading can be corrected
-- later without a new app on every phone - the same reason the SMS parser lives on the server.
--
-- The kind check cannot be widened in place (the MCP hangs on DROP), so the table is renamed and made again, as in 043.

alter table public.phone_commands rename to phone_commands_v3;

create table if not exists public.phone_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  kind text not null check (kind in ('balance', 'cashin', 'statement')),
  provider text not null check (provider in ('nagad', 'bkash')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Cash-in only. The cap is part of the table: no setting, no dashboard and no stolen session can raise it.
  amount numeric check (amount is null or (amount > 0 and amount <= 10000)),
  to_number text check (to_number is null or to_number ~ '^01[0-9]{9}$'),
  -- Statement only: which entry to open, counting from 1 as the wallet numbers them. Null means "just the list".
  item int check (item is null or (item >= 1 and item <= 40)),
  -- Statement only: the screens the wallet showed, word for word, newest page first as they were read.
  screens jsonb check (screens is null or (jsonb_typeof(screens) = 'array' and jsonb_array_length(screens) <= 12)),
  trx_id text check (trx_id is null or trx_id ~ '^[A-Za-z0-9]{1,24}$'),
  balance numeric check (balance is null or (balance >= 0 and balance < 1000000000)),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- A cash-in must say how much and to whom; the two read-only commands must say neither.
  constraint phone_commands_cashin_fields check (
    (kind = 'cashin' and amount is not null and to_number is not null) or
    (kind in ('balance', 'statement') and amount is null and to_number is null)
  ),
  -- Only a statement command may name an entry.
  constraint phone_commands_item_only_for_statement check (item is null or kind = 'statement')
);

insert into public.phone_commands (id, device_id, kind, provider, status, amount, to_number, trx_id, balance, error, created_by, created_at, started_at, finished_at)
select id, device_id, kind, provider, status, amount, to_number, trx_id, balance, error, created_by, created_at, started_at, finished_at
from public.phone_commands_v3
on conflict (id) do nothing;

create index if not exists phone_commands_device_idx3 on public.phone_commands (device_id, created_at desc);
-- One live command per phone, kind and wallet, as before. A list and an entry are both 'statement', so asking for one
-- while the other is still running is refused, which is what we want: the phone runs one menu session at a time.
create unique index if not exists phone_commands_one_live3 on public.phone_commands (device_id, kind, provider)
  where status in ('queued', 'running');

alter table public.phone_commands enable row level security;

-- Ask a phone for the statement list, or for one entry of it. Admin-only, like every other command.
create or replace function public.queue_statement_command(p_device uuid, p_provider text, p_item int)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('nagad', 'bkash') then raise exception 'bad wallet'; end if;
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

-- The phone takes its next command on the heartbeat reply. A statement also carries which entry to open, if any.
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
    'amount', amount, 'to_number', to_number, 'item', item
  ) into v;
  return v;
end $$;

-- The phone reports back. Same as device_command_result, plus the statement screens. A separate name because a
-- seventh argument with a default would make every existing six-argument call ambiguous.
create or replace function public.device_command_finish(
  p_device uuid, p_id uuid, p_ok boolean, p_balance numeric, p_trx text, p_screens jsonb, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int; v_screens jsonb;
begin
  -- Keep at most 12 screens of at most 2000 characters each: enough for every page the wallet shows, and a hard stop
  -- on anything a phone might send by mistake.
  if p_screens is not null and jsonb_typeof(p_screens) = 'array' then
    select jsonb_agg(left(s.v, 2000) order by s.n) into v_screens
    from jsonb_array_elements_text(p_screens) with ordinality as s(v, n)
    where s.n <= 12;
  end if;
  update public.phone_commands
  set status = case when p_ok then 'done' else 'failed' end,
      balance = case when p_ok and p_balance is not null then p_balance else balance end,
      trx_id = case when p_ok and p_trx ~ '^[A-Za-z0-9]{1,24}$' then p_trx else trx_id end,
      screens = case when v_screens is not null then v_screens else screens end,
      error = case when p_ok then null else coalesce(nullif(p_error, ''), 'failed') end,
      finished_at = now()
  where id = p_id and device_id = p_device and status in ('queued', 'running');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- Admins read the commands from the dashboard; only the RPCs above ever write them.
create policy phone_commands_read3 on public.phone_commands for select to authenticated using (is_admin());
grant select on public.phone_commands to authenticated;
