-- 082: Cash In through the bKash APP as well as by USSD, chosen each time (owner 2026-11-10: "for cashin keep both ussd and app,
-- i should be able to select an option when we do cashin, commission payout, payout"; then "yes build it" after the recording).
--
-- What the owner's recording showed (bKash Business 3.10.2, Vivo, Tk 200 to 01320352256, TrxID DKA5A92DQ5): Home > ক্যাশ ইন >
-- number box ("ক্যাশ ইন করুন <number>") > পরবর্তী ধাপে এগিয়ে যান > amount screen (the number again, ব্যবহারযোগ্য ব্যালেন্স) >
-- PIN screen (amount and commission only, NO number) > নিশ্চিত করুন > "ক্যাশ ইন নিশ্চিত করুন" sheet (number, amount, new balance,
-- "ক্যাশ ইন করতে ট্যাপ করে ধরে রাখুন") > result with TrxID, old and new balance. Money moves only on the tap-and-hold, on a
-- screen that shows BOTH the number and the amount; the phone holds only when both match (owner agreed 2026-11-10).
--
-- Server part: phone_commands.via ('ussd' | 'app', default 'ussd', so nothing already queued changes); three admin wrappers that
-- call the existing functions UNCHANGED and then mark the new command, inside the same call, so a phone can never take it
-- half-made; device_next_command hands `via` over and keeps menu work and app work on one phone one at a time; the
-- "nothing was sent" list grows by the app's own stops before the hold. No DROP or DELETE.

alter table public.phone_commands add column if not exists via text not null default 'ussd' check (via in ('ussd', 'app'));

-- A command may go through the app only if it is a bKash agent Cash In and the phone's app build can do it (heartbeat app_cashin).
create or replace function public.phone_command_set_via(p_command uuid, p_via text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; ready boolean;
begin
  if coalesce(p_via, 'ussd') = 'ussd' then return; end if;
  if p_via <> 'app' then raise exception 'bad_via'; end if;
  select * into c from public.phone_commands where id = p_command;
  if c.id is null then raise exception 'app_needs_a_phone_command'; end if;
  if c.kind <> 'cashin' or c.provider <> 'bkash' then raise exception 'app_bkash_cash_in_only'; end if;
  select coalesce((d.info->>'app_cashin')::boolean, false) into ready from public.devices d where d.id = c.device_id;
  if not coalesce(ready, false) then raise exception 'app_not_ready'; end if;
  update public.phone_commands set via = 'app' where id = p_command and status = 'queued';
  if not found then raise exception 'app_command_already_taken'; end if;
end $$;
revoke all on function public.phone_command_set_via(uuid, text) from public, anon, authenticated;
grant execute on function public.phone_command_set_via(uuid, text) to service_role;

create or replace function public.queue_phone_command_via(p_device uuid, p_kind text, p_provider text, p_amount numeric, p_to_number text, p_via text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  v := public.queue_phone_command(p_device, p_kind, p_provider, p_amount, p_to_number);
  perform public.phone_command_set_via(v, p_via);
  return v;
end $$;
revoke all on function public.queue_phone_command_via(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.queue_phone_command_via(uuid, text, text, numeric, text, text) to authenticated;

create or replace function public.create_payout_via(p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric,
                                                    p_from_account text, p_note text, p_via text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  r := public.create_payout(p_payments, p_device, p_provider, p_to_number, p_keep_pct, p_from_account, p_note);
  if coalesce(p_via, 'ussd') = 'app' then
    if r->>'command_id' is null then raise exception 'app_needs_a_phone_command'; end if;
    perform public.phone_command_set_via((r->>'command_id')::uuid, 'app');
  end if;
  return r || jsonb_build_object('via', coalesce(p_via, 'ussd'));
end $$;
revoke all on function public.create_payout_via(uuid[], uuid, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.create_payout_via(uuid[], uuid, text, text, numeric, text, text, text) to authenticated;

create or replace function public.create_commission_pay_via(p_device uuid, p_days date[], p_method text, p_from_device uuid, p_provider text,
                                                            p_note text, p_via text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  r := public.create_commission_pay(p_device, p_days, p_method, p_from_device, p_provider, p_note);
  if coalesce(p_via, 'ussd') = 'app' then
    if r->>'command_id' is null then raise exception 'app_needs_a_phone_command'; end if;
    perform public.phone_command_set_via((r->>'command_id')::uuid, 'app');
  end if;
  return r || jsonb_build_object('via', coalesce(p_via, 'ussd'));
end $$;
revoke all on function public.create_commission_pay_via(uuid, date[], text, uuid, text, text, text) from public, anon;
grant execute on function public.create_commission_pay_via(uuid, date[], text, uuid, text, text, text) to authenticated;

-- The phone is told the way; a phone runs one piece of menu or bKash-app work at a time (the app reader and an app cash-in
-- drive the same app).
create or replace function public.device_next_command(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands set status = 'running', started_at = now()
  where id = (
    select c.id from public.phone_commands c
    where c.device_id = p_device and c.status = 'queued'
      and not (c.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord')
               and exists (select 1 from public.phone_commands r where r.device_id = p_device and r.status = 'running'
                              and r.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord')))
    order by c.created_at limit 1
  )
  returning jsonb_build_object(
    'id', id, 'kind', kind, 'provider', provider,
    'amount', amount, 'to_number', to_number, 'item', item, 'via', via
  ) into v;
  return v;
end $$;

-- Stops of the app way that happen before the tap-and-hold: nothing was sent, so a payout is freed rather than "unsure".
create or replace function public.payout_safe_error(p_error text)
returns boolean language sql immutable as $$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused', 'personal_off', 'no_personal',
    'no_bkash_app', 'app_not_opened', 'login_failed', 'pin_not_entered', 'app_stopped_before_send', 'insufficient_balance',
    'pin_refused');
$$;
