-- 070: "We just did a B2B / Cash In" -> read the wallet's statement now (owner 2026-11-08: "B2B is done by us; when a B2B
-- happens we tell the system by clicking a button on the app and the dashboard ... on cash-in we tell the system to run
-- the statement"; then: "phone gets only B2B, dashboard gets B2B and Cash In").
--
-- Why: a B2B or a hand-made cash-in sends no SMS (or none PayTrace can rely on), so the money is only found when the next
-- SMS shows the balance jumped (balance_gap_record, migration 063) or at the midnight read. Late in the day that can be
-- hours. The button asks for the statement at once, so the entry is saved before it can scroll off the wallet's list.
-- Nothing here moves money or changes a figure by itself: the statement is read and matched exactly like any other pull.

create or replace function public.statement_now(p_device uuid, p_provider text, p_why text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.devices; cmd uuid;
begin
  if p_provider not in ('bkash', 'nagad') then return jsonb_build_object('ok', false, 'reason', 'no_flow'); end if;
  if p_why not in ('b2b', 'cashin') or p_by not in ('app', 'dashboard') then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if d.allow_balance = false then return jsonb_build_object('ok', false, 'reason', 'balance_off'); end if;
  -- A phone's button can be pressed again and again: one read per wallet every 2 minutes is plenty.
  if p_by = 'app' and exists (select 1 from public.events e where e.kind = 'statement_pull_auto' and e.provider = p_provider
                                 and e.detail->>'device_id' = p_device::text and e.detail->>'by' = 'app'
                                 and e.at > now() - interval '2 minutes') then
    return jsonb_build_object('ok', true, 'queued', false, 'reason', 'just_asked');
  end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider) values (p_device, 'statement', p_provider) returning id into cmd;
  exception when unique_violation then
    -- One is already waiting or running on this phone: it will bring the entry back just the same.
    return jsonb_build_object('ok', true, 'queued', false, 'reason', 'already_reading');
  end;
  insert into public.events (kind, provider, detail) values ('statement_pull_auto', p_provider,
    jsonb_build_object('device_id', p_device, 'hour', extract(hour from (now() at time zone 'Asia/Dhaka'))::int,
                       'why', p_why || '_button', 'by', p_by, 'command_id', cmd));
  return jsonb_build_object('ok', true, 'queued', true, 'command_id', cmd);
end $$;

revoke all on function public.statement_now(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.statement_now(uuid, text, text, text) to service_role;

-- The dashboard's buttons (B2B and Cash In), admin only.
create or replace function public.ask_statement_now(p_device uuid, p_provider text, p_why text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return public.statement_now(p_device, p_provider, p_why, 'dashboard');
end $$;

revoke all on function public.ask_statement_now(uuid, text, text) from public, anon;
grant execute on function public.ask_statement_now(uuid, text, text) to authenticated, service_role;
