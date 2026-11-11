-- 089: a bKash balance check through the bKash APP as well as by USSD, chosen each time (owner 2026-11-11: "yes build
-- balance check in app"). The app's Home shows "Tap for Balance" (`tag_tap_for_balance`); after a tap the figure appears
-- in `tag_balance_amount` for a few seconds (owner's recordings 573a9296 and 41cae20d: 11,923.83, then 11,674.77 after a
-- Tk 250 Cash In with 0.94 commission). Only reads; nothing is sent.
--
-- Same pattern as 082: the command is made by the existing queue_phone_command UNCHANGED and then marked via = 'app' in
-- the same call, and only for a phone whose app build reported `app_balance` in its heartbeat (an older build would
-- ignore `via` and walk *247#, which is harmless but would not be what the owner chose). No DROP or DELETE.

create or replace function public.phone_command_set_via(p_command uuid, p_via text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; ready boolean;
begin
  if coalesce(p_via, 'ussd') = 'ussd' then return; end if;
  if p_via <> 'app' then raise exception 'bad_via'; end if;
  select * into c from public.phone_commands where id = p_command;
  if c.id is null then raise exception 'app_needs_a_phone_command'; end if;
  if c.provider is distinct from 'bkash' or c.kind not in ('cashin', 'balance') then raise exception 'app_bkash_cash_in_only'; end if;
  select coalesce((d.info->>(case when c.kind = 'balance' then 'app_balance' else 'app_cashin' end))::boolean, false)
    into ready from public.devices d where d.id = c.device_id;
  if not coalesce(ready, false) then raise exception 'app_not_ready'; end if;
  update public.phone_commands set via = 'app' where id = p_command and status = 'queued';
  if not found then raise exception 'app_command_already_taken'; end if;
end $$;
revoke all on function public.phone_command_set_via(uuid, text) from public, anon, authenticated;
grant execute on function public.phone_command_set_via(uuid, text) to service_role;

create or replace function public.queue_balance_via(p_device uuid, p_provider text, p_via text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  v := public.queue_phone_command(p_device, 'balance', p_provider);
  perform public.phone_command_set_via(v, p_via);
  return v;
end $$;
revoke all on function public.queue_balance_via(uuid, text, text) from public, anon;
grant execute on function public.queue_balance_via(uuid, text, text) to authenticated;
