-- 084: the B2B's DSO comes from the bKash app, not from the dashboard (owner 2026-11-10: "we don't need to save the DSO number,
-- it comes from the bKash app; we just put the amount and the PIN and continue").
--
-- * A `btob` command carries an amount and NO number; the phone takes the one DSO number the bKash app fills in, and holds
--   the send button only on the sheet that shows that same number and the amount.
-- * queue_b2b no longer asks for a saved DSO number (b2b_numbers / set_b2b_number stay, unused, nothing is removed).
-- * When the phone finishes, the DSO number it saw ("to DSO: 01…" in its summary screen) is written into to_number, so the
--   history still says where each B2B went.
-- The CHECK change is the only removal, as in 083a.

alter table public.phone_commands drop constraint if exists phone_commands_money_fields;
alter table public.phone_commands add constraint phone_commands_money_fields check (
  (kind in ('cashin', 'sendmoney') and amount is not null and to_number is not null)
  or (kind = 'btob' and amount is not null)
  or (kind not in ('cashin', 'sendmoney', 'btob') and amount is null and to_number is null));

create or replace function public.queue_b2b(p_device uuid, p_provider text, p_amount numeric, p_cash_ok boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider is distinct from 'bkash' then raise exception 'b2b_bkash_only'; end if;
  if p_cash_ok is distinct from true then raise exception 'b2b_cash_not_confirmed'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 250000 or p_amount <> round(p_amount, 2) then raise exception 'bad_amount'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  if d.allow_cashin is distinct from true then raise exception 'sending_money_off'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, amount, created_by, via)
      values (p_device, 'btob', p_provider, p_amount, auth.uid(), 'app') returning id into new_id;
  exception when unique_violation then
    raise exception 'b2b_already_waiting';
  end;
  insert into public.events (kind, provider, detail) values ('phone_command_queued', p_provider,
    jsonb_build_object('device_id', p_device, 'command', 'btob', 'id', new_id, 'amount', p_amount,
                       'cash_confirmed', true, 'by', auth.uid()));
  return new_id;
end $$;

create or replace function public.phone_commands_b2b_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'btob' and new.to_number is null and new.screens is not null and jsonb_typeof(new.screens) = 'array' then
    new.to_number := substring(new.screens->>0 from 'to DSO: (01[0-9]{9})');
  end if;
  return new;
end $$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'phone_commands_b2b_number') then
    create trigger phone_commands_b2b_number before update on public.phone_commands
      for each row execute function public.phone_commands_b2b_number();
  end if;
end $t$;
