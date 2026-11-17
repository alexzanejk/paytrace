-- Which personal account (owner 2026-11-17: "if I have two bKash ... payout from my personal account ... show phone name,
-- bKash 1, bKash 2"). A phone may hold two personal bKash accounts (one per SIM, app build 1.0.24x). Until now a Send Money
-- payout always went from personal account 1 and the balance check read both. A command may now name the account.
--
-- Safety: an app build that does not know this field sends from account 1 whatever was chosen, so account 2 is accepted
-- only from a phone whose heartbeat lists a personal account WITH its number (n = 2), which only builds that read the
-- field send. Nothing else about money changes: create_payout / create_commission_pay make the command exactly as before.

alter table public.phone_commands add column if not exists account smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'phone_commands_account_check') then
    alter table public.phone_commands add constraint phone_commands_account_check
      check (account is null or (account in (1, 2) and kind in ('sendmoney', 'pbalance')));
  end if;
end $$;

-- Marks a queued command for one personal account. null / 1 on a Send Money = the old behaviour (account 1).
create or replace function public.phone_command_set_account(p_command uuid, p_account int)
returns void language plpgsql security definer set search_path to 'public' as $$
declare c record; has_n boolean;
begin
  if p_account is null then return; end if;
  if p_account not in (1, 2) then raise exception 'bad_account'; end if;
  select * into c from public.phone_commands where id = p_command;
  if c.id is null then raise exception 'no_command'; end if;
  if c.kind not in ('sendmoney', 'pbalance') then raise exception 'account_only_for_personal'; end if;
  if p_account = 2 then
    select exists (
      select 1 from public.devices d, jsonb_array_elements(coalesce(d.info->'wallets', '[]'::jsonb)) w
      where d.id = c.device_id and w->>'kind' = 'personal' and w->>'provider' = 'bkash' and w->>'n' = '2'
    ) into has_n;
    if not has_n then raise exception 'account_2_not_on_phone'; end if;
  end if;
  update public.phone_commands set account = p_account where id = p_command and status = 'queued';
  if not found then raise exception 'command_already_taken'; end if;
end $$;
revoke all on function public.phone_command_set_account(uuid, int) from public, anon, authenticated;

-- Payout from a chosen personal account (agent payouts pass null and nothing changes).
create or replace function public.create_payout_via_account(p_payments uuid[], p_device uuid, p_provider text, p_to_number text,
  p_keep_pct numeric, p_from_account text, p_note text, p_via text, p_account int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  r := public.create_payout_via(p_payments, p_device, p_provider, p_to_number, p_keep_pct, p_from_account, p_note, p_via);
  if p_account is not null and p_from_account = 'personal' then
    if r->>'command_id' is null then raise exception 'no_command'; end if;
    perform public.phone_command_set_account((r->>'command_id')::uuid, p_account);
  end if;
  return r || jsonb_build_object('account', p_account);
end $$;
grant execute on function public.create_payout_via_account(uuid[], uuid, text, text, numeric, text, text, text, int) to authenticated;

create or replace function public.create_commission_pay_via_account(p_device uuid, p_days date[], p_method text, p_from_device uuid,
  p_provider text, p_note text, p_via text, p_account int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  r := public.create_commission_pay_via(p_device, p_days, p_method, p_from_device, p_provider, p_note, p_via);
  if p_account is not null and p_method = 'send_money' then
    if r->>'command_id' is null then raise exception 'no_command'; end if;
    perform public.phone_command_set_account((r->>'command_id')::uuid, p_account);
  end if;
  return r || jsonb_build_object('account', p_account);
end $$;
grant execute on function public.create_commission_pay_via_account(uuid, date[], text, uuid, text, text, text, int) to authenticated;

-- Balance of one personal account (p_account 1 or 2), or of every one (null), as before.
create or replace function public.queue_personal_balance(p_device uuid, p_account int)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  id := public.queue_phone_action(p_device, 'pbalance');
  perform public.phone_command_set_account(id, p_account);
  return id;
end $$;
grant execute on function public.queue_personal_balance(uuid, int) to authenticated;

-- The phone is told which account (patched in place: one field added to the answer, nothing else changes).
do $$
declare d text;
begin
  select pg_get_functiondef('public.device_next_command(uuid)'::regprocedure) into d;
  if position('''account'', account' in d) = 0 then
    if position('''via'', via,' in d) = 0 then raise exception 'device_next_command: via field not found'; end if;
    d := replace(d, '''via'', via,', '''via'', via, ''account'', account,');
    execute d;
  end if;
end $$;
