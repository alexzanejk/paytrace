-- 093: the Nagad AGENT app ("নগদ উদ্যোক্তা"), driven by the phone like the bKash app (owner 2026-11-11, screen video of a
-- Xiaomi): balance, reading the statement list, searching it for a TrxID or number, Cash In, and a 10-minute recorder.
--
-- The Nagad read / search / recorder are their OWN command kinds (nagadread, nagadsearch, nagadrecord), never the bKash
-- kinds with a flag: every bKash rule that counts or queues 'appread' (the "not in the bKash app" judge, the half-hourly
-- tick, a held payment's check) keeps meaning bKash only, and a Nagad read never blocks a bKash one (one live command per
-- phone and kind). Balance and Cash In keep their kinds (balance, cashin) with provider nagad and via 'app'.
--
-- Nothing is removed (the MCP cannot run a statement that removes something).

insert into public.phone_command_kinds (kind, needs_wallet) values
  ('nagadread', false), ('nagadsearch', false), ('nagadrecord', false)
on conflict (kind) do nothing;

-- The TrxID or number a Nagad search looks for (the bKash search's `query` column is tied to kind appsearch by a CHECK).
alter table public.phone_commands add column if not exists app_query text;
do $$ begin
  alter table public.phone_commands add constraint phone_commands_app_query_shape check (
    (kind = 'nagadsearch' and app_query ~ '^([A-Z0-9]{8,12}|01[0-9]{9})$') or (kind <> 'nagadsearch' and app_query is null));
exception when duplicate_object then null; end $$;

-- A phone hands over one app or menu command at a time; a Nagad read is told how far back a held Nagad payment needs it
-- to go, a Nagad search what to search for.
create or replace function public.app_look_nagad(p_device uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when count(*) = 0 then null else jsonb_build_object(
           'back_to', (extract(epoch from min(coalesce(p.occurred_at, p.received_at))) * 1000)::bigint, 'find', '[]'::jsonb) end
    from public.payments p
   where p.device_id = p_device and p.provider = 'nagad' and p.status = 'review'
     and p.review_reason = 'balance_chain_mismatch' and p.received_at > now() - interval '3 days'
     and not exists (select 1 from public.app_rows r where r.device_id = p.device_id and r.provider = 'nagad' and r.trx_id = p.trx_id);
$$;
revoke all on function public.app_look_nagad(uuid) from public, anon, authenticated;

create or replace function public.device_next_command(p_device uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands set status = 'running', started_at = now()
  where id = (
    select c.id from public.phone_commands c
    where c.device_id = p_device and c.status = 'queued'
      and not (c.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord', 'btob', 'appsearch', 'nagadread', 'nagadsearch', 'nagadrecord')
               and exists (select 1 from public.phone_commands r where r.device_id = p_device and r.status = 'running'
                              and r.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord', 'btob', 'appsearch', 'nagadread', 'nagadsearch', 'nagadrecord')))
    order by c.created_at limit 1
  )
  returning jsonb_build_object(
    'id', id, 'kind', kind, 'provider', provider,
    'amount', amount, 'to_number', to_number, 'item', item, 'via', via,
    'look', case when kind = 'appread' then public.app_look(p_device)
                 when kind = 'appsearch' then jsonb_build_object('query', query)
                 when kind = 'nagadread' then public.app_look_nagad(p_device)
                 when kind = 'nagadsearch' then jsonb_build_object('query', app_query) end
  ) into v;
  return v;
end $function$;

-- The recorder's screens are accepted for a Nagad recording too.
create or replace function public.app_screen_add(p_device uuid, p_command uuid, p_seq integer, p_pkg text, p_screen text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.phone_commands c
                  where c.id = p_command and c.device_id = p_device and c.kind in ('apprecord', 'nagadrecord')
                    and c.created_at > now() - interval '20 minutes') then
    return jsonb_build_object('ok', false, 'error', 'not_recording');
  end if;
  if p_seq is null or p_seq < 1 or p_seq > 600 or p_screen is null or length(p_screen) = 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_screen');
  end if;
  insert into public.app_screens (command_id, device_id, seq, pkg, screen)
    values (p_command, p_device, p_seq, left(p_pkg, 120), left(p_screen, 9000))
    on conflict (command_id, seq) do nothing;
  return jsonb_build_object('ok', true);
end $function$;

-- The app way for Nagad: a balance or a Cash In with provider nagad, only to a phone whose build reported app_nagad.
create or replace function public.phone_command_set_via(p_command uuid, p_via text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare c record; ready boolean; flag text;
begin
  if coalesce(p_via, 'ussd') = 'ussd' then return; end if;
  if p_via <> 'app' then raise exception 'bad_via'; end if;
  select * into c from public.phone_commands where id = p_command;
  if c.id is null then raise exception 'app_needs_a_phone_command'; end if;
  if coalesce(c.provider, '') not in ('bkash', 'nagad') or c.kind not in ('cashin', 'balance') then raise exception 'app_bkash_cash_in_only'; end if;
  flag := case when c.provider = 'nagad' then 'app_nagad' when c.kind = 'balance' then 'app_balance' else 'app_cashin' end;
  select coalesce((d.info->>flag)::boolean, false) into ready from public.devices d where d.id = c.device_id;
  if not coalesce(ready, false) then raise exception 'app_not_ready'; end if;
  update public.phone_commands set via = 'app' where id = p_command and status = 'queued';
  if not found then raise exception 'app_command_already_taken'; end if;
end $function$;

-- The owner's own search of the Nagad app (dashboard), like queue_app_search for bKash.
create or replace function public.queue_nagad_search(p_device uuid, p_query text)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare d public.devices; q text; new_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  q := upper(regexp_replace(coalesce(p_query, ''), '[\s-]', '', 'g'));
  if q ~ '^\+?880[0-9]{10}$' then q := '0' || right(q, 10); end if;
  if not (q ~ '^01[0-9]{9}$' or (q ~ '^[A-Z0-9]{8,12}$' and q ~ '[A-Z]')) then raise exception 'bad_query'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'phone is not approved'; end if;
  if d.allow_balance is false then raise exception 'balance_off'; end if;
  if coalesce((d.info->>'app_nagad')::boolean, false) is not true then raise exception 'app_not_ready'; end if;
  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, app_query, created_by) values (p_device, 'nagadsearch', q, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'a search is already waiting for this phone';
  end;
  insert into public.events (kind, provider, detail)
    values ('phone_command_queued', 'nagad', jsonb_build_object('device_id', p_device, 'command', 'nagadsearch', 'id', new_id, 'by', auth.uid()));
  return new_id;
end $function$;
revoke all on function public.queue_nagad_search(uuid, text) from public, anon;
grant execute on function public.queue_nagad_search(uuid, text) to authenticated;

-- Rows of a wallet app read, for any wallet (the bKash ones are unchanged and keep 'bkash' built in).
create or replace function public.app_rows_record_p(p_command uuid, p_device uuid, p_lines jsonb, p_provider text)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  with l as (
    select (x->>'at')::timestamptz as at, left(x->>'type', 60) as type,
           case when (x->>'in')::boolean then (x->>'amount')::numeric else -((x->>'amount')::numeric) end as amount,
           nullif(x->>'commission', '')::numeric as commission, nullif(x->>'party', '') as party
      from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) x
     where x->>'at' is not null
  ), ins as (
    insert into public.app_rows (device_id, provider, at, type, amount, commission, party, first_command, last_command)
    select distinct on (at, type, amount, coalesce(party, '')) p_device, p_provider, at, type, amount, commission, party, p_command, p_command from l
    on conflict (device_id, provider, at, type, amount, coalesce(party, '')) do update
      set last_command = excluded.last_command, last_seen = now(),
          commission = coalesce(excluded.commission, public.app_rows.commission)
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $function$;

create or replace function public.app_rows_note_trx_p(p_device uuid, p_screens jsonb, p_provider text)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; o record;
begin
  for o in select * from public.app_read_opened(p_screens) where trx is not null loop
    update public.app_rows r set trx_id = o.trx
     where r.device_id = p_device and r.provider = p_provider and r.at = o.at
       and abs(abs(r.amount) - o.amount) < 0.005
       and coalesce(r.party, '') = coalesce(o.party, '');
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;

-- A held payment the wallet's own app lists with ITS OWN TrxID and amount, as money in, is real: released. Nothing else
-- (minute, amount or number alone) releases a Nagad payment.
create or replace function public.app_confirm_by_trx(p_device uuid, p_provider text, p_command uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare p record; r public.app_rows; res text; why text; confirmed jsonb := '[]'::jsonb; label text;
begin
  label := case when p_provider = 'nagad' then 'Nagad' else initcap(p_provider) end;
  for p in select * from public.payments x
            where x.device_id = p_device and x.provider = p_provider and x.status = 'review'
              and x.review_reason = 'balance_chain_mismatch' and x.received_at > now() - interval '7 days'
            order by x.received_at
  loop
    select * into r from public.app_rows a
     where a.device_id = p_device and a.provider = p_provider and a.trx_id = p.trx_id
       and a.amount > 0 and abs(a.amount - p.amount) < 0.005
       and (a.vouches_for is null or a.vouches_for = p.id)
     limit 1;
    continue when r.id is null;
    update public.app_rows set vouches_for = p.id where id = r.id;
    why := 'The ' || label || ' app lists it with its own TrxID ' || r.trx_id || ': ' || to_char(r.at at time zone 'Asia/Dhaka', 'HH12:MI AM DD/MM')
           || ', ' || r.type || ', Tk ' || abs(r.amount)::text || coalesce(', ' || r.party, '') || '.';
    res := public.payment_check_confirm(p.id, 'statement', why);
    insert into public.events (kind, provider, payment_id, detail) values ('app_row_vouched', p_provider, p.id,
      jsonb_build_object('device_id', p_device, 'command', p_command, 'row', r.id, 'result', res, 'trx_read', true));
    confirmed := confirmed || jsonb_build_object('payment_id', p.id, 'provider', p.provider, 'amount', p.amount,
                                                 'trx_id', p.trx_id, 'detail', why, 'result', res);
  end loop;
  return jsonb_build_object('confirmed', confirmed);
end $function$;
revoke all on function public.app_confirm_by_trx(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.app_lines_record_p(p_command uuid, p_device uuid, p_screens jsonb, p_provider text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare lines jsonb; wsim smallint; n int := 0; total int := 0; confirmed jsonb := '[]'::jsonb; gaps jsonb := '[]'::jsonb; verdict jsonb := '{}'::jsonb;
begin
  lines := public.app_read_lines(p_screens);
  total := jsonb_array_length(lines);
  if total > 0 then
    wsim := public.sim_of_wallet(p_device, p_provider);
    with l as (
      select (x->>'no')::int as no, (x->>'day')::date as day, left(x->>'type', 60) as type, (x->>'at')::timestamptz as at,
             case when (x->>'in')::boolean then (x->>'amount')::numeric else -((x->>'amount')::numeric) end as amount,
             nullif(x->>'commission', '')::numeric as commission
        from jsonb_array_elements(lines) x
    ), ranked as (
      select l.*, row_number() over (partition by l.day, l.type, l.amount order by l.no) as occ, l.no - 1 as list_pos from l
    ), ins as (
      insert into public.statement_lines (device_id, provider, sim_slot, day, type, amount, occ, list_pos, command_id, at, commission, source)
      select p_device, p_provider, wsim, r.day, r.type, r.amount, r.occ, r.list_pos, p_command, r.at, r.commission, 'app' from ranked r
      on conflict (device_id, provider, day, type, amount, occ) do update
        set list_pos = excluded.list_pos, command_id = excluded.command_id, seen_at = now(),
            at = coalesce(excluded.at, public.statement_lines.at),
            commission = coalesce(excluded.commission, public.statement_lines.commission),
            source = 'app',
            sim_slot = coalesce(excluded.sim_slot, public.statement_lines.sim_slot)
      returning (xmax = 0) as inserted
    )
    select count(*) filter (where inserted) into n from ins;
    perform public.app_rows_record_p(p_command, p_device, lines, p_provider);
  end if;
  perform public.app_rows_note_trx_p(p_device, p_screens, p_provider);
  begin
    verdict := public.app_confirm_by_trx(p_device, p_provider, p_command);
  exception when others then
    insert into public.events (kind, provider, detail) values ('app_confirm_failed', p_provider, jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
  end;
  if total > 0 then
    begin
      confirmed := public.statement_confirm_held(p_device, p_provider);
    exception when others then
      insert into public.events (kind, provider, detail) values ('statement_confirm_failed', p_provider, jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
    end;
    begin
      gaps := public.balance_gap_explain(p_device, p_provider);
    exception when others then
      insert into public.events (kind, provider, detail) values ('balance_gap_explain_failed', p_provider, jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
    end;
  end if;
  insert into public.events (kind, provider, detail) values ('app_read_recorded', p_provider,
    jsonb_build_object('device_id', p_device, 'command', p_command, 'rows', total, 'new', n,
                       'confirmed', jsonb_array_length(coalesce(confirmed, '[]'::jsonb)), 'gaps', gaps,
                       'app_confirmed', coalesce(verdict->'confirmed', '[]'::jsonb), 'app_fake', '[]'::jsonb));
  return jsonb_build_object('rows', total, 'new', n, 'confirmed', confirmed, 'gaps', gaps);
end $function$;
revoke all on function public.app_lines_record_p(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.app_rows_record_p(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.app_rows_note_trx_p(uuid, jsonb, text) from public, anon, authenticated;

-- A search's rows go to app_rows only (a filtered list must not number the statement's same-day entries), as for bKash.
create or replace function public.app_search_record_p(p_command uuid, p_device uuid, p_screens jsonb, p_provider text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare lines jsonb; verdict jsonb := '{}'::jsonb;
begin
  lines := public.app_read_lines(p_screens);
  if jsonb_array_length(lines) > 0 then perform public.app_rows_record_p(p_command, p_device, lines, p_provider); end if;
  perform public.app_rows_note_trx_p(p_device, p_screens, p_provider);
  begin
    verdict := public.app_confirm_by_trx(p_device, p_provider, p_command);
  exception when others then
    insert into public.events (kind, provider, detail) values ('app_confirm_failed', p_provider, jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
  end;
  insert into public.events (kind, provider, detail) values ('app_read_recorded', p_provider,
    jsonb_build_object('device_id', p_device, 'command', p_command, 'rows', jsonb_array_length(lines), 'search', true,
                       'app_confirmed', coalesce(verdict->'confirmed', '[]'::jsonb), 'app_fake', '[]'::jsonb));
  return jsonb_build_object('rows', jsonb_array_length(lines), 'confirmed', coalesce(verdict->'confirmed', '[]'::jsonb));
end $function$;
revoke all on function public.app_search_record_p(uuid, uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.phone_commands_app_read()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.kind in ('appread', 'appsearch', 'nagadread', 'nagadsearch') then
    begin
      if new.kind = 'appread' then
        perform public.app_lines_record(new.id, new.device_id, new.screens);
        update public.payment_checks set command_id = null where command_id = new.id and status = 'queued';
      elsif new.kind = 'appsearch' then
        perform public.app_search_record(new.id, new.device_id, new.screens);
      elsif new.kind = 'nagadread' then
        perform public.app_lines_record_p(new.id, new.device_id, new.screens, 'nagad');
      else
        perform public.app_search_record_p(new.id, new.device_id, new.screens, 'nagad');
      end if;
    exception when others then
      insert into public.events (kind, provider, detail) values ('app_read_record_failed',
        case when new.kind like 'nagad%' then 'nagad' else 'bkash' end,
        jsonb_build_object('device_id', new.device_id, 'command', new.id, 'search', new.kind like '%search', 'error', left(sqlerrm, 200)));
    end;
  end if;
  return new;
end $function$;

-- Every 30 minutes (at :18 and :48, between the bKash reads at :03 and :33) each phone with a Nagad agent wallet set up
-- in the app and a build that drives the Nagad app reads its Nagad statement list.
create or replace function public.app_read_tick_nagad()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare d record; last record; n int := 0;
begin
  for d in
    select v.id from public.devices v
     where v.status = 'approved' and coalesce(v.allow_balance, false)
       and coalesce((v.info->>'app_nagad')::boolean, false)
       and v.last_seen_at > now() - interval '3 minutes'
       and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v.info->'wallets') = 'array' then v.info->'wallets' else '[]'::jsonb end) w
                    where w->>'provider' = 'nagad' and coalesce(w->>'kind', 'agent') = 'agent')
  loop
    last := null;
    select c.status, c.error, c.created_at into last from public.phone_commands c
     where c.device_id = d.id and c.kind = 'nagadread' order by c.created_at desc limit 1;
    if last.status in ('queued', 'running') then continue; end if;
    if last.created_at > now() - interval '25 minutes' then continue; end if;
    if last.error = 'login_failed' then continue; end if;
    if last.error in ('no_nagad_app', 'no_pin', 'not_allowed', 'unsupported') and last.created_at > now() - interval '24 hours' then continue; end if;
    if exists (select 1 from public.phone_commands c where c.device_id = d.id and c.status = 'running') then continue; end if;
    begin
      insert into public.phone_commands (device_id, kind) values (d.id, 'nagadread');
      n := n + 1;
    exception when unique_violation then
      null;
    end;
  end loop;
  return n;
end $function$;
revoke all on function public.app_read_tick_nagad() from public, anon, authenticated;

select cron.schedule('paytrace-app-read-nagad', '18,48 * * * *', 'select public.app_read_tick_nagad()');

-- A Nagad app run that stops before "হ্যাঁ" sends nothing: such a payout is failed and its transactions freed.
create or replace function public.payout_safe_error(p_error text)
 returns boolean language sql immutable
as $function$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused', 'personal_off', 'no_personal',
    'no_bkash_app', 'app_not_opened', 'login_failed', 'pin_not_entered', 'app_stopped_before_send', 'insufficient_balance',
    'pin_refused', 'no_nagad_app');
$function$;

-- 093a (applied as its own step): app_rows was bKash-only by a CHECK; the Nagad app's rows need it too.
alter table public.app_rows drop constraint app_rows_provider_check;
alter table public.app_rows add constraint app_rows_provider_check2 check (provider in ('bkash', 'nagad'));
