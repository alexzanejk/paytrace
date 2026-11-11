-- 090: the owner's own search of a phone's bKash app, from the dashboard (owner 2026-11-11: "an option on dashboard so
-- that we can manually search any transaction id on the bKash agent app"; "transaction page and payout page, yes phone
-- number too", "a found TrxID should automatically release a held payment: yes").
--
-- A new command kind `appsearch` carries `query` (a TrxID or an 11-digit number). The phone logs in to the bKash app,
-- searches its Statement for it (the same search the reader already does for held payments), opens a single TrxID row to
-- read its TrxID, and answers with the rows it saw (numbers masked, the same row format as an app read) plus, on its first
-- screen, a summary with the full number for the owner. The rows go into `app_rows` and the opened TrxID onto its row, then
-- `app_confirm_held` runs, so a held payment whose TrxID was found is released by the same exact-TrxID rule as before.
-- Search rows are NOT put into `statement_lines`: a filtered list would number same-day same-amount rows wrongly there.
-- No DROP or DELETE.

insert into public.phone_command_kinds (kind, needs_wallet) values ('appsearch', false) on conflict (kind) do nothing;

alter table public.phone_commands add column if not exists query text;
alter table public.phone_commands add constraint phone_commands_query_shape check (
  (kind = 'appsearch' and query ~ '^([A-Z0-9]{8,12}|01[0-9]{9})$') or (kind <> 'appsearch' and query is null)
) not valid;

-- The phone is given the query in `look`, the field the ingest function already passes for app reads.
create or replace function public.device_next_command(p_device uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands set status = 'running', started_at = now()
  where id = (
    select c.id from public.phone_commands c
    where c.device_id = p_device and c.status = 'queued'
      and not (c.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord', 'btob', 'appsearch')
               and exists (select 1 from public.phone_commands r where r.device_id = p_device and r.status = 'running'
                              and r.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord', 'btob', 'appsearch')))
    order by c.created_at limit 1
  )
  returning jsonb_build_object(
    'id', id, 'kind', kind, 'provider', provider,
    'amount', amount, 'to_number', to_number, 'item', item, 'via', via,
    'look', case when kind = 'appread' then public.app_look(p_device)
                 when kind = 'appsearch' then jsonb_build_object('query', query) end
  ) into v;
  return v;
end $function$;

-- What a finished search found: rows into app_rows, the opened TrxID onto its row, then the held-payment judge.
create or replace function public.app_search_record(p_command uuid, p_device uuid, p_screens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lines jsonb; verdict jsonb := '{}'::jsonb;
begin
  lines := public.app_read_lines(p_screens);
  if jsonb_array_length(lines) > 0 then perform public.app_rows_record(p_command, p_device, lines); end if;
  perform public.app_rows_note_trx(p_device, p_screens);
  begin
    verdict := public.app_confirm_held(p_device, p_command);
  exception when others then
    insert into public.events (kind, provider, detail) values ('app_confirm_failed', 'bkash', jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
  end;
  -- The same event an app read leaves, so the ingest function tells the owner about each payment it released.
  insert into public.events (kind, provider, detail) values ('app_read_recorded', 'bkash',
    jsonb_build_object('device_id', p_device, 'command', p_command, 'rows', jsonb_array_length(lines), 'search', true,
                       'app_confirmed', coalesce(verdict->'confirmed', '[]'::jsonb), 'app_fake', '[]'::jsonb));
  return jsonb_build_object('rows', jsonb_array_length(lines), 'confirmed', coalesce(verdict->'confirmed', '[]'::jsonb));
end $$;
revoke all on function public.app_search_record(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_search_record(uuid, uuid, jsonb) to service_role;

create or replace function public.phone_commands_app_read()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.kind = 'appread' and new.status = 'done' and old.status is distinct from 'done' then
    begin
      perform public.app_lines_record(new.id, new.device_id, new.screens);
      update public.payment_checks set command_id = null where command_id = new.id and status = 'queued';
    exception when others then
      insert into public.events (kind, provider, detail) values ('app_read_record_failed', 'bkash',
        jsonb_build_object('device_id', new.device_id, 'command', new.id, 'error', left(sqlerrm, 200)));
    end;
  end if;
  if new.kind = 'appsearch' and new.status = 'done' and old.status is distinct from 'done' then
    begin
      perform public.app_search_record(new.id, new.device_id, new.screens);
    exception when others then
      insert into public.events (kind, provider, detail) values ('app_read_record_failed', 'bkash',
        jsonb_build_object('device_id', new.device_id, 'command', new.id, 'search', true, 'error', left(sqlerrm, 200)));
    end;
  end if;
  return new;
end $function$;

-- The dashboard's button. A TrxID is upper-cased; a number may be typed as +880 / 880 / 01.
create or replace function public.queue_app_search(p_device uuid, p_query text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; q text; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  q := upper(regexp_replace(coalesce(p_query, ''), '[\s-]', '', 'g'));
  if q ~ '^\+?880[0-9]{10}$' then q := '0' || right(q, 10); end if;
  if not (q ~ '^01[0-9]{9}$' or (q ~ '^[A-Z0-9]{8,12}$' and q ~ '[A-Z]')) then raise exception 'bad_query'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  if d.allow_balance is false then raise exception 'balance_off'; end if;
  if coalesce((d.info->>'app_search')::boolean, false) is not true then raise exception 'app_not_ready'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, query, created_by) values (p_device, 'appsearch', q, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'a search is already waiting for this phone';
  end;
  insert into public.events (kind, provider, detail)
    values ('phone_command_queued', 'bkash', jsonb_build_object('device_id', p_device, 'command', 'appsearch', 'id', new_id, 'by', auth.uid()));
  return new_id;
end $$;
revoke all on function public.queue_app_search(uuid, text) from public, anon;
grant execute on function public.queue_app_search(uuid, text) to authenticated;
