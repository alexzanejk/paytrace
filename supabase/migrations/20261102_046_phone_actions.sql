-- Phone controls from the dashboard (owner request 2026-11-02): five commands that need no wallet.
--
--   restart  stop and start PayTrace's always-on service, re-arm the safety nets. For the phone that says Online but
--            does nothing.
--   inbox    read the phone's SMS inbox now, instead of on the next 5-minute pass. "Did we miss a message?" answered
--            in seconds.
--   resend   send everything still waiting or failed-for-no-internet right now.
--   screen   wake the screen and hold it on for two minutes.
--   ring     sound the alarm tone so a partner notices the phone.
--
-- What is deliberately NOT here, because Android gives no app a way to do it: switching a phone on from off,
-- rebooting it, or toggling Wi-Fi / mobile data / flight mode. The owner was told so before choosing these.
--
-- The table has been remade four times already (042-045) because a CHECK on `kind` cannot be widened through the
-- MCP, which hangs on DROP. This time the list of kinds moves into a small table, so the NEXT command is one INSERT
-- and the phone_commands table is never remade for it again. `provider` becomes nullable: a wallet command still has
-- to name its wallet, a phone control must not.

create table if not exists public.phone_command_kinds (
  kind text primary key check (kind ~ '^[a-z_]{1,20}$'),
  -- True for the commands that walk a wallet's menu and therefore need to know which wallet.
  needs_wallet boolean not null,
  added_at timestamptz not null default now()
);
insert into public.phone_command_kinds (kind, needs_wallet) values
  ('balance', true), ('cashin', true), ('statement', true),
  ('restart', false), ('inbox', false), ('resend', false), ('screen', false), ('ring', false)
on conflict (kind) do nothing;
alter table public.phone_command_kinds enable row level security;
create policy phone_command_kinds_read on public.phone_command_kinds for select to authenticated using (is_admin());
grant select on public.phone_command_kinds to authenticated;

alter table public.phone_commands rename to phone_commands_v5;

create table if not exists public.phone_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  kind text not null references public.phone_command_kinds(kind),
  provider text check (provider is null or provider in ('nagad', 'bkash', 'rocket', 'upay')),
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
  -- A wallet command names its wallet; a phone control never does. The three wallet kinds are spelt out here because a
  -- CHECK cannot look them up; they are the stable ones, and every future kind is a phone control.
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
from public.phone_commands_v5
on conflict (id) do nothing;

create index if not exists phone_commands_device_idx5 on public.phone_commands (device_id, created_at desc);
-- One live command per phone, kind and wallet. coalesce because NULLs would never collide on their own, and two
-- queued restarts for one phone is exactly what this exists to prevent.
create unique index if not exists phone_commands_one_live5 on public.phone_commands (device_id, kind, coalesce(provider, ''))
  where status in ('queued', 'running');

alter table public.phone_commands enable row level security;
create policy phone_commands_read5 on public.phone_commands for select to authenticated using (is_admin());
grant select on public.phone_commands to authenticated;

-- Dashboard: ask an approved phone to do one of the controls above. Admin only; nothing about money or wallets.
create or replace function public.queue_phone_action(p_device uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; new_id uuid; k public.phone_command_kinds;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into k from public.phone_command_kinds where kind = p_kind;
  if k.kind is null or k.needs_wallet then raise exception 'unsupported command'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, created_by)
      values (p_device, p_kind, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'that is already waiting for this phone';
  end;
  insert into public.events (kind, provider, detail)
    values ('phone_command_queued', null, jsonb_build_object('device_id', p_device, 'command', p_kind, 'id', new_id, 'by', auth.uid()));
  return new_id;
end $$;
revoke all on function public.queue_phone_action(uuid, text) from public, anon;
grant execute on function public.queue_phone_action(uuid, text) to authenticated;

-- The existing queue_phone_command / queue_statement_command / device_next_command / device_command_finish /
-- phone_commands_tidy functions all name public.phone_commands and keep working against the remade table unchanged:
-- device_next_command already returns provider (now null for a phone control) and device_command_finish asks for
-- nothing a phone control cannot give.
