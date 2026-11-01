-- Commands the owner sends to a phone from the dashboard. Step 1: read the Nagad balance by USSD (no money moves).
-- Later kinds (cash in) are added the same way, each with its own checks. The PIN never reaches the server: it lives
-- only on the phone, encrypted. The server stores what was asked and what came back.
create table if not exists public.phone_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id),
  kind text not null check (kind in ('balance')),
  provider text not null check (provider in ('nagad')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  balance numeric check (balance is null or (balance >= 0 and balance < 1000000000)),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists phone_commands_device_idx on public.phone_commands (device_id, created_at desc);
-- One live command per phone, kind and wallet: pressing the button twice cannot queue two.
create unique index if not exists phone_commands_one_live
  on public.phone_commands (device_id, kind, provider) where status in ('queued', 'running');

alter table public.phone_commands enable row level security;
create policy phone_commands_read on public.phone_commands for select to authenticated using (public.is_admin());
revoke all on public.phone_commands from anon, authenticated;
grant select on public.phone_commands to authenticated;

-- Old waiting commands are cancelled and stuck running ones are marked failed, so nothing waits for ever.
create or replace function public.phone_commands_tidy(p_device uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.phone_commands
     set status = 'cancelled', finished_at = now(), error = 'expired'
   where device_id = p_device and status = 'queued' and created_at < now() - interval '10 minutes';
  update public.phone_commands
     set status = 'failed', finished_at = now(), error = 'timeout'
   where device_id = p_device and status = 'running' and started_at < now() - interval '3 minutes';
end $$;
revoke all on function public.phone_commands_tidy(uuid) from public, anon, authenticated;

-- Dashboard: ask an approved phone to read its balance.
create or replace function public.queue_phone_command(p_device uuid, p_kind text, p_provider text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_kind <> 'balance' or p_provider <> 'nagad' then raise exception 'unsupported command'; end if;
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
revoke all on function public.queue_phone_command(uuid, text, text) from public, anon, authenticated;
grant execute on function public.queue_phone_command(uuid, text, text) to authenticated;

-- Phone (through the ingest function, service role only): take the oldest waiting command, marking it running.
create or replace function public.device_next_command(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands p
     set status = 'running', started_at = now()
   where p.id = (
     select id from public.phone_commands
      where device_id = p_device and status = 'queued'
      order by created_at limit 1 for update skip locked)
  returning p.id, p.kind, p.provider into c;
  if c.id is null then return null; end if;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'provider', c.provider);
end $$;
revoke all on function public.device_next_command(uuid) from public, anon, authenticated;
grant execute on function public.device_next_command(uuid) to service_role;

-- Phone: what came back. Only the phone that was given the command can answer it, and only once.
create or replace function public.device_command_result(p_device uuid, p_id uuid, p_ok boolean, p_balance numeric, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer; err text;
begin
  err := case when p_ok then null when coalesce(p_error, '') ~ '^[a-z_]{1,40}$' then p_error else 'failed' end;
  update public.phone_commands
     set status = case when p_ok then 'done' else 'failed' end,
         balance = case when p_ok then p_balance else null end,
         error = err, finished_at = now()
   where id = p_id and device_id = p_device and status = 'running';
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.events (kind, detail)
      values ('phone_command_result', jsonb_build_object('device_id', p_device, 'id', p_id, 'ok', p_ok, 'error', err));
  end if;
  return n > 0;
end $$;
revoke all on function public.device_command_result(uuid, uuid, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.device_command_result(uuid, uuid, boolean, numeric, text) to service_role;
