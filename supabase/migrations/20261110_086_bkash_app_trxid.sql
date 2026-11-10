-- 086: a held bKash payment is released only by its own TrxID, read on the bKash app (owner 2026-11-10: "yes build both").
--
-- 085 matched a held SMS to its bKash app row by minute, amount, kind and masked number. That is strong but not exact:
-- two same-amount payments from one customer in one minute look identical, and a fake SMS copying a real payment's
-- minute, amount and number could take that payment's row. The list shows no TrxID; a row's detail sheet does.
--
-- * Every app read now gets `look` with its command (device_next_command): read back at least to the oldest held payment
--   of that phone (`back_to`, so a payment held hours ago is reached), and open these rows for their TrxID (`find`, at
--   most 5: TrxID, minute, amount, masked number). The phone opens only a row of that minute, amount and number, reads the
--   TrxID on its sheet, closes it, and reports "opened <minute ms> <amount> <masked number> <TrxID>" (AppLook).
-- * `app_rows.trx_id` keeps what was read. `app_row_for` never offers a row whose TrxID is another one.
-- * On a phone whose app build reads TrxIDs (heartbeat `app_trx`), a held payment is released ONLY when its row's TrxID
--   is the SMS's own. A row found but not yet opened gets another read at once (at most 3 asks per payment); after that it
--   stays held with a note, never flagged fake (the row is there). On an older build the 085 rule stays.
-- * Fakes are still flagged by 085's rule: two reads covering the SMS's minute and no row that can be its own.
-- No DROP or DELETE.

alter table public.app_rows add column if not exists trx_id text check (trx_id is null or trx_id ~ '^[A-Z0-9]{6,24}$');
create index if not exists app_rows_trx on public.app_rows (trx_id) where trx_id is not null;

-- The phone's "opened" lines: which row it opened and the TrxID it read there.
create or replace function public.app_read_opened(p_screens jsonb)
returns table (at timestamptz, amount numeric, party text, trx text)
language sql immutable set search_path = public as $$
  select to_timestamp(m[1]::bigint / 1000.0), m[2]::numeric, nullif(m[3], '-'), nullif(m[4], '-')
    from jsonb_array_elements_text(case when jsonb_typeof(p_screens) = 'array' then p_screens else '[]'::jsonb end) c(chunk)
    cross join lateral regexp_split_to_table(c.chunk, E'\n') l(line)
    cross join lateral regexp_match(btrim(l.line), '^opened ([0-9]{10,14}) ([0-9]+(?:\.[0-9]+)?) (01[0-9X]{9}|-) ([A-Z0-9]{6,24}|-)$') m
   where c.chunk like 'Opened rows:%' and m is not null;
$$;

create or replace function public.app_rows_note_trx(p_device uuid, p_screens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; o record;
begin
  for o in select * from public.app_read_opened(p_screens) where trx is not null loop
    update public.app_rows r set trx_id = o.trx
     where r.device_id = p_device and r.provider = 'bkash' and r.at = o.at
       and abs(abs(r.amount) - o.amount) < 0.005
       and coalesce(r.party, '') = coalesce(o.party, '');
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.app_rows_note_trx(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_rows_note_trx(uuid, jsonb) to service_role;

-- Does this phone's app build read TrxIDs on the bKash app?
create or replace function public.app_reads_trx(p_device uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (d.info->>'app_trx')::boolean from public.devices d where d.id = p_device), false);
$$;
revoke all on function public.app_reads_trx(uuid) from public, anon, authenticated;
grant execute on function public.app_reads_trx(uuid) to service_role;

-- What the next app read on this phone should look for.
create or replace function public.app_look(p_device uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with held as (
    select p.*, coalesce(p.occurred_at, p.received_at) as t
      from public.payments p
     where p.device_id = p_device and p.provider = 'bkash' and p.status = 'review'
       and p.review_reason in ('balance_chain_mismatch', 'not_in_bkash_app')
       and p.received_at > now() - interval '3 days'
       and public.app_can_judge(p.id)
       and not exists (select 1 from public.app_rows r where r.device_id = p.device_id and r.trx_id = p.trx_id)
     order by p.received_at
     limit 5
  )
  select case when count(*) = 0 then null else jsonb_build_object(
           'back_to', (extract(epoch from min(t)) * 1000)::bigint,
           'find', jsonb_agg(jsonb_build_object(
                     'trx', trx_id, 'at', (extract(epoch from date_trunc('minute', t)) * 1000)::bigint,
                     'amount', amount, 'party', public.mask_bd_number(counterparty)) order by t)) end
    from held;
$$;
revoke all on function public.app_look(uuid) from public, anon, authenticated;
grant execute on function public.app_look(uuid) to service_role;

-- A row read with another TrxID is never this payment's.
create or replace function public.app_row_for(p_payment uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select r.id
    from public.payments p
    join public.app_rows r on r.device_id = p.device_id and r.provider = p.provider
   where p.id = p_payment
     and (r.vouches_for is null or r.vouches_for = p.id)
     and (r.trx_id is null or r.trx_id = p.trx_id)
     and abs(abs(r.amount) - p.amount) < 0.005
     and public.ledger_match_kind(public.ledger_kind(r.type, r.amount > 0))
         = public.ledger_match_kind(public.payment_ledger_kind(p.txn_type, case when p.status = 'review' then null else p.review_reason end))
     and abs(extract(epoch from date_trunc('minute', r.at) - date_trunc('minute', coalesce(p.occurred_at, p.received_at)))) <= 60
     and (r.party is null or p.counterparty is null or r.party = public.mask_bd_number(p.counterparty))
   order by (r.trx_id = p.trx_id) desc nulls last,
            abs(extract(epoch from date_trunc('minute', r.at) - date_trunc('minute', coalesce(p.occurred_at, p.received_at)))),
            (r.party is not null) desc
   limit 1;
$$;

create or replace function public.app_confirm_held(p_device uuid, p_command uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; rid uuid; r public.app_rows; res text; why text; covers int; cmd uuid; by_trx boolean; asks int;
  confirmed jsonb := '[]'::jsonb; fake jsonb := '[]'::jsonb; again jsonb := '[]'::jsonb;
begin
  by_trx := public.app_reads_trx(p_device);
  for p in select * from public.payments x
            where x.device_id = p_device and x.provider = 'bkash' and x.status = 'review'
              and x.review_reason in ('balance_chain_mismatch', 'not_in_bkash_app')
              and x.received_at > now() - interval '3 days'
            order by x.received_at
  loop
    continue when not public.app_can_judge(p.id);
    rid := public.app_row_for(p.id);
    if rid is not null then
      select * into r from public.app_rows where id = rid;
      if by_trx and r.trx_id is distinct from p.trx_id then
        -- Its row is there but its TrxID has not been read yet: read again at once (the read opens it), at most 3 times.
        select count(*) into asks from public.events e where e.kind = 'app_trx_ask' and e.payment_id = p.id;
        if asks < 3 then
          cmd := null;
          begin
            insert into public.phone_commands (device_id, kind) values (p_device, 'appread') returning id into cmd;
          exception when unique_violation then
            select c.id into cmd from public.phone_commands c
             where c.device_id = p_device and c.kind = 'appread' and c.status in ('queued', 'running') limit 1;
          end;
          update public.payment_checks set command_id = cmd where payment_id = p.id and status = 'queued';
          insert into public.events (kind, provider, payment_id, detail) values ('app_trx_ask', 'bkash', p.id,
            jsonb_build_object('device_id', p_device, 'command', cmd, 'after', p_command, 'row', r.id));
          again := again || jsonb_build_object('payment_id', p.id, 'command_id', cmd);
        elsif not exists (select 1 from public.payment_checks c where c.payment_id = p.id and c.detail like 'Found in the bKash app%') then
          insert into public.payment_checks (payment_id, step, command_id, status, finished_at, detail)
            values (p.id, 'statement', p_command, 'not_confirmed', now(),
                    'Found in the bKash app (same minute, amount and number), but its TrxID could not be read after 3 tries. Check it in the app.');
        end if;
        continue;
      end if;
      update public.app_rows set vouches_for = p.id where id = rid and (vouches_for is null or vouches_for = p.id) returning * into r;
      continue when r.id is null;
      if p.review_reason = 'not_in_bkash_app' then
        update public.payments set review_reason = 'balance_chain_mismatch' where id = p.id;
      end if;
      why := 'The bKash app lists it: ' || to_char(r.at at time zone 'Asia/Dhaka', 'HH12:MI AM DD/MM') || ', ' || r.type
             || ', Tk ' || abs(r.amount)::text || coalesce(', ' || r.party, '')
             || case when r.trx_id = p.trx_id then ', TrxID ' || r.trx_id || ' (read on the app)' else '' end || '.';
      res := public.payment_check_confirm(p.id, 'statement', why);
      insert into public.events (kind, provider, payment_id, detail) values ('app_row_vouched', 'bkash', p.id,
        jsonb_build_object('device_id', p_device, 'command', p_command, 'row', r.id, 'result', res, 'trx_read', r.trx_id is not null));
      confirmed := confirmed || jsonb_build_object('payment_id', p.id, 'provider', p.provider, 'amount', p.amount,
                                                   'trx_id', p.trx_id, 'detail', why, 'result', res);
    elsif p.review_reason = 'balance_chain_mismatch' then
      covers := public.app_reads_covering(p.id);
      if covers >= 2 then
        why := format('Not in the bKash app: %s app reads that cover %s did not list a %s of Tk %s%s. Likely a fake SMS; it stays held and is not credited.',
                      covers, to_char(coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka', 'HH12:MI AM DD/MM'),
                      case when p.txn_type = 'cash_out' then 'Cash Out' else 'payment' end, p.amount,
                      coalesce(' from ' || public.mask_bd_number(p.counterparty), ''));
        update public.payments set review_reason = 'not_in_bkash_app' where id = p.id and review_reason = 'balance_chain_mismatch';
        update public.payment_checks set status = 'not_confirmed', finished_at = now(), detail = why
         where payment_id = p.id and status = 'queued';
        if not found then
          insert into public.payment_checks (payment_id, step, command_id, status, finished_at, detail)
            values (p.id, 'statement', p_command, 'not_confirmed', now(), why);
        end if;
        insert into public.events (kind, provider, payment_id, detail) values ('not_in_bkash_app', 'bkash', p.id,
          jsonb_build_object('device_id', p_device, 'command', p_command, 'reads', covers));
        fake := fake || jsonb_build_object('payment_id', p.id, 'provider', p.provider, 'amount', p.amount, 'trx_id', p.trx_id, 'detail', why);
      elsif covers = 1 and not exists (select 1 from public.events e where e.kind = 'app_read_again' and e.payment_id = p.id) then
        cmd := null;
        begin
          insert into public.phone_commands (device_id, kind) values (p_device, 'appread') returning id into cmd;
        exception when unique_violation then
          select c.id into cmd from public.phone_commands c
           where c.device_id = p_device and c.kind = 'appread' and c.status in ('queued', 'running') limit 1;
        end;
        update public.payment_checks set command_id = cmd where payment_id = p.id and status = 'queued';
        insert into public.events (kind, provider, payment_id, detail) values ('app_read_again', 'bkash', p.id,
          jsonb_build_object('device_id', p_device, 'command', cmd, 'after', p_command));
        again := again || jsonb_build_object('payment_id', p.id, 'command_id', cmd);
      end if;
    end if;
  end loop;
  update public.payment_checks set command_id = null where command_id = p_command and status = 'queued';
  return jsonb_build_object('confirmed', confirmed, 'fake', fake, 'again', again);
end $$;
revoke all on function public.app_confirm_held(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app_confirm_held(uuid, uuid) to service_role;

do $m$
declare src text; out text;
begin
  -- The read's own "opened" lines are noted before the verdicts.
  src := pg_get_functiondef('public.app_lines_record(uuid,uuid,jsonb)'::regprocedure);
  if position('app_rows_note_trx' in src) = 0 then
    out := replace(src, E'  perform public.app_rows_record(p_command, p_device, lines);',
                        E'  perform public.app_rows_record(p_command, p_device, lines);\n  perform public.app_rows_note_trx(p_device, p_screens);');
    if out = src then raise exception 'app_lines_record: anchor not found'; end if;
    execute out;
  end if;

  -- The phone is told what to look for when it takes an app read.
  src := pg_get_functiondef('public.device_next_command(uuid)'::regprocedure);
  if position('app_look' in src) = 0 then
    out := replace(src, E'''via'', via', E'''via'', via, ''look'', case when kind = ''appread'' then public.app_look(p_device) end');
    if out = src then raise exception 'device_next_command: anchor not found'; end if;
    execute out;
  end if;
end $m$;
