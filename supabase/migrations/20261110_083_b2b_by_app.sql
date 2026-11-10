-- 083: a B2B transfer done by the phone through the bKash APP, told from the dashboard (owner 2026-11-10: "now we will build
-- full b2b perform on app"; the recording followed: Tk 5,000 to the DSO 01324245010, TrxID DKA1AWJZ9L).
--
-- What the recording showed: the bKash app fills in the agent's DSO by itself (one number, no choice), the amount is typed,
-- then the PIN, a sheet with the DSO number and the amount ("tap and hold"), the result with the TrxID and the new balance,
-- and then a question "did you receive Tk 5000 cash from the DSO in person?" which the app insists on before any other
-- transaction. bKash sends NO SMS for a B2B (none arrived for DKA1AWJZ9L).
--
-- * b2b_numbers: the DSO number of each phone's bKash wallet, saved on the dashboard (set_b2b_number). The phone sends only
--   when the app shows exactly that number, so a B2B can never go anywhere else.
-- * queue_b2b(device, provider, amount, cash_ok): admin only; bKash only (the app way); 100 to 250,000; the dashboard's
--   "may send money from this phone" switch must be on; cash_ok must be true: the owner ticks, for every B2B, that the DSO
--   pays the cash, because the phone answers bKash's cash question "yes" on the owner's word.
-- * device_next_command keeps a B2B one-at-a-time with the other menu and app work on a phone.
-- * balance_gap_record and device_day_money count a B2B PayTrace made, like its own cash-ins (no SMS behind either).
-- * A finished B2B asks the phone for an app read at once, so the ledger and the B2B float see it in a minute, not 30.
-- The command kind is "btob" (kind names are letters and _ only). No DROP or DELETE here (083a holds the CHECK changes).

insert into public.phone_command_kinds (kind, needs_wallet) values ('btob', true) on conflict (kind) do nothing;

create table if not exists public.b2b_numbers (
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash')),
  number text not null check (number ~ '^01[0-9]{9}$'),
  set_at timestamptz not null default now(),
  set_by uuid,
  primary key (device_id, provider)
);
alter table public.b2b_numbers enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'b2b_numbers' and policyname = 'b2b_numbers_read') then
    create policy b2b_numbers_read on public.b2b_numbers for select to authenticated using (public.is_admin());
  end if;
end $p$;
grant select on public.b2b_numbers to authenticated;

create or replace function public.set_b2b_number(p_device uuid, p_provider text, p_number text)
returns text language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider is distinct from 'bkash' then raise exception 'b2b_bkash_only'; end if;
  n := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
  if n ~ '^8801[0-9]{9}$' then n := substr(n, 3); end if;
  if n !~ '^01[0-9]{9}$' then raise exception 'bad_number'; end if;
  if not exists (select 1 from public.devices where id = p_device) then raise exception 'phone is not known'; end if;
  insert into public.b2b_numbers (device_id, provider, number, set_at, set_by) values (p_device, p_provider, n, now(), auth.uid())
  on conflict (device_id, provider) do update set number = excluded.number, set_at = now(), set_by = auth.uid();
  insert into public.events (kind, provider, detail) values ('b2b_number_set', p_provider,
    jsonb_build_object('device_id', p_device, 'number', n, 'by', auth.uid()));
  return n;
end $$;
revoke all on function public.set_b2b_number(uuid, text, text) from public, anon;
grant execute on function public.set_b2b_number(uuid, text, text) to authenticated;

create or replace function public.queue_b2b(p_device uuid, p_provider text, p_amount numeric, p_cash_ok boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; n text; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider is distinct from 'bkash' then raise exception 'b2b_bkash_only'; end if;
  if p_cash_ok is distinct from true then raise exception 'b2b_cash_not_confirmed'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 250000 or p_amount <> round(p_amount, 2) then raise exception 'bad_amount'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  if d.allow_cashin is distinct from true then raise exception 'sending_money_off'; end if;
  select number into n from public.b2b_numbers where device_id = p_device and provider = p_provider;
  if n is null then raise exception 'no_dso_number'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by, via)
      values (p_device, 'btob', p_provider, p_amount, n, auth.uid(), 'app') returning id into new_id;
  exception when unique_violation then
    raise exception 'b2b_already_waiting';
  end;
  insert into public.events (kind, provider, detail) values ('phone_command_queued', p_provider,
    jsonb_build_object('device_id', p_device, 'command', 'btob', 'id', new_id, 'amount', p_amount, 'to', n,
                       'cash_confirmed', true, 'by', auth.uid()));
  return new_id;
end $$;
revoke all on function public.queue_b2b(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.queue_b2b(uuid, text, numeric, boolean) to authenticated;

-- A finished B2B asks the phone for an app read straight away (the app lists it with its exact time; bKash sends no SMS).
create or replace function public.phone_commands_b2b_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'btob' and new.status = 'done' and old.status is distinct from 'done' then
    begin
      insert into public.phone_commands (device_id, kind) values (new.device_id, 'appread');
      insert into public.events (kind, provider, detail) values ('app_read_auto', new.provider,
        jsonb_build_object('device_id', new.device_id, 'why', 'b2b', 'command_id', new.id));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'phone_commands_b2b_done') then
    create trigger phone_commands_b2b_done after update on public.phone_commands
      for each row execute function public.phone_commands_b2b_done();
  end if;
end $t$;

-- Patches: one-at-a-time menu work, PayTrace's own B2B in the balance gaps and in the day's money.
do $m$
declare src text; out text;
begin
  src := pg_get_functiondef('public.device_next_command(uuid)'::regprocedure);
  if position('''btob''' in src) = 0 then
    out := replace(src, '''appread'', ''apprecord'')', '''appread'', ''apprecord'', ''btob'')');
    if out = src then raise exception 'device_next_command: anchor not found'; end if;
    execute out;
  end if;

  src := pg_get_functiondef('public.balance_gap_record(uuid)'::regprocedure);
  if position('''btob''' in src) = 0 then
    out := replace(src, 'c.kind = ''cashin'' and c.status = ''done''', 'c.kind in (''cashin'', ''btob'') and c.status = ''done''');
    if out = src then raise exception 'balance_gap_record: anchor not found'; end if;
    execute out;
  end if;

  src := pg_get_functiondef('public.device_day_money(date)'::regprocedure);
  if position('''btob''' in src) = 0 then
    out := replace(src, 'where c.kind in (''cashin'', ''sendmoney'') and c.status = ''done''',
                        'where c.kind in (''cashin'', ''sendmoney'', ''btob'') and c.status = ''done''');
    out := replace(out, 'case when c.kind = ''sendmoney'' then ''send_money_out'' else ''cash_in_sent'' end',
                        'case when c.kind = ''sendmoney'' then ''send_money_out'' when c.kind = ''btob'' then ''b2b_out'' else ''cash_in_sent'' end');
    if position('''b2b_out'' else' in out) = 0 or position('''sendmoney'', ''btob'')' in out) = 0 then
      raise exception 'device_day_money: anchors not found';
    end if;
    execute out;
  end if;
end $m$;
