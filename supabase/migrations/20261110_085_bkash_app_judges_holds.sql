-- 085: the bKash Agent app judges held bKash payments (owner 2026-11-10: "yes build 1-3").
--
-- The SMS stays the first check: a message that fits is credited at once, nothing here touches that path. This is only for
-- a bKash payment HELD because its balance did not follow on from the one before (money moved with no SMS):
--   1. Check at once. payment_check_start no longer starts the *247# balance/statement walk for such a payment when the
--      phone's bKash app can be read (an app read finished there in the last 24 h and the last one was not login_failed);
--      it queues an app read straight away (ingest already wakes the phone).
--   2. One payment, one row. Every row an app read sees is kept in `app_rows` under its own identity (minute, type,
--      signed amount, masked number), because `statement_lines` keys rows by (day, type, amount, occ) and two same-amount
--      rows of a day can overwrite each other there. A held SMS is released only by an app row of the same kind family,
--      the same amount, the same minute (+/- 1) and the same masked number, and a row vouches for ONE payment
--      (`vouches_for`, unique).
--   3. Fakes are flagged. When two finished app reads that both cover the SMS's minute (the read started at least 2 min
--      after it and its oldest row is older than it) do not list it, the payment is marked `not_in_bkash_app`: still held,
--      never credited, the owner can still decide. Only payments of the AGENT account are judged this way (the bKash
--      Business app knows nothing of a personal account). A later read that does list it releases it after all.
-- The older day-count rule no longer releases such a payment (same-amount rows of a day can overwrite each other there).
-- Telegram: the read's `app_read_recorded` event carries the verdicts; ingest (v55) reads it after the result and
-- tells the owner. Also: app_read_tick stops asking a phone whose app build answers `unsupported` (rubel's, every 30 min).
-- No DROP or DELETE.

-- 2. Rows by identity -------------------------------------------------------------------------------------------------
create table if not exists public.app_rows (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null default 'bkash' check (provider in ('bkash')),
  at timestamptz not null,
  type text not null,
  amount numeric(14,2) not null,          -- signed: + came in, - left
  commission numeric(14,2),
  party text,                              -- the masked number the app prints, e.g. 0172XXXX764
  first_command uuid,
  last_command uuid,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  vouches_for uuid references public.payments(id)
);
create unique index if not exists app_rows_key on public.app_rows (device_id, provider, at, type, amount, coalesce(party, ''));
create unique index if not exists app_rows_vouch on public.app_rows (vouches_for) where vouches_for is not null;
create index if not exists app_rows_device_at on public.app_rows (device_id, at);
alter table public.app_rows enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'app_rows' and policyname = 'app_rows_read') then
    create policy app_rows_read on public.app_rows for select to authenticated using (public.is_admin());
  end if;
end $p$;
grant select on public.app_rows to authenticated;

-- The reader now also keeps each row's masked number.
create or replace function public.app_read_lines(p_screens jsonb)
returns jsonb language sql immutable set search_path = public as $$
  with lines as (
    select row_number() over (order by c.o, l.o) as no, l.line
      from jsonb_array_elements_text(case when jsonb_typeof(p_screens) = 'array' then p_screens else '[]'::jsonb end)
           with ordinality as c(chunk, o)
      cross join lateral regexp_split_to_table(c.chunk, E'\n') with ordinality as l(line, o)
     where c.o > 1 and l.line like '%|%'
  ), parts as (
    select no, string_to_array(line, ' | ') as arr from lines
  ), f as (
    select no,
      (select btrim(x) from unnest(arr) x where x ~* '^\s*\d{1,2}:\d{2}\s*[ap]m\s+\d{1,2}/\d{1,2}/\d{2,4}\s*$' limit 1) as t,
      (select btrim(x) from unnest(arr) x where x ~ '^\s*[+-]\s*৳\s*[0-9,]+(\.[0-9]+)?\s*$' limit 1) as a,
      (select x from unnest(arr) x where x ~* '(কমিশন|commission)' limit 1) as cm,
      (select upper(btrim(x)) from unnest(arr) x where upper(btrim(x)) ~ '^01[0-9X]{9}$' limit 1) as party,
      (select btrim(x) from unnest(arr) x
        where x !~* '(কমিশন|commission)' and x !~ '৳' and x !~* '\d{1,2}:\d{2}\s*[ap]m' and x !~ '^[0-9X+ ]+$' and btrim(x) <> ''
        limit 1) as ty
    from parts
  ), g as (
    select no, ty, party,
      (to_timestamp(upper(regexp_replace(t, '\s+', '', 'g')), 'HH12:MIAMDD/MM/YY')::timestamp at time zone 'Asia/Dhaka') as at,
      a ~ '^\s*\+' as incoming,
      replace(substring(a from '([0-9,]+(?:\.[0-9]+)?)'), ',', '')::numeric as amount,
      nullif(replace(substring(cm from '৳\s*([0-9,]+(?:\.[0-9]+)?)'), ',', ''), '')::numeric as commission
    from f where t is not null and a is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', no, 'day', to_char(at at time zone 'Asia/Dhaka', 'YYYY-MM-DD'), 'at', at, 'type', public.app_row_type(ty),
           'amount', amount, 'in', incoming, 'commission', commission, 'party', party) order by no), '[]'::jsonb)
    from g where amount > 0;
$$;

create or replace function public.app_rows_record(p_command uuid, p_device uuid, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
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
    select distinct on (at, type, amount, coalesce(party, '')) p_device, 'bkash', at, type, amount, commission, party, p_command, p_command from l
    on conflict (device_id, provider, at, type, amount, coalesce(party, '')) do update
      set last_command = excluded.last_command, last_seen = now(),
          commission = coalesce(excluded.commission, public.app_rows.commission)
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.app_rows_record(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_rows_record(uuid, uuid, jsonb) to service_role;

-- Helpers ----------------------------------------------------------------------------------------------------------------
-- "01712345678" and "0171XXXX678" are the same customer as far as the app's masking goes.
create or replace function public.mask_bd_number(p text)
returns text language sql immutable as $$
  select case when p ~ '^01[0-9]{9}$' then substr(p, 1, 4) || 'XXXX' || substr(p, 9, 3) else upper(p) end;
$$;

-- Can this phone's bKash app be read? (an app read finished in the last 24 h, and the newest app read was not refused at login)
create or replace function public.app_read_works(p_device uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.phone_commands c where c.device_id = p_device and c.kind = 'appread' and c.status = 'done'
                   and c.finished_at > now() - interval '24 hours')
     and coalesce((select c.error from public.phone_commands c where c.device_id = p_device and c.kind = 'appread'
                    and c.status in ('done', 'failed') order by c.created_at desc limit 1), '') <> 'login_failed';
$$;

-- Is this payment on the bKash AGENT account (the one the bKash Business app shows)?
create or replace function public.app_can_judge(p_payment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p.provider = 'bkash' and p.device_id is not null
     and (public.wallet_account_of(p.device_id, p.provider, p.sim_slot) = 'agent'
          or (public.wallet_account_of(p.device_id, p.provider, p.sim_slot) is null
              and not exists (select 1 from public.devices d,
                                jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
                               where d.id = p.device_id and w->>'provider' = 'bkash' and w->>'kind' = 'personal')))
    from public.payments p where p.id = p_payment;
$$;

-- The one app row that is this payment: same kind family, same amount, same minute (+/- 1), same masked number.
create or replace function public.app_row_for(p_payment uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select r.id
    from public.payments p
    join public.app_rows r on r.device_id = p.device_id and r.provider = p.provider
   where p.id = p_payment
     and (r.vouches_for is null or r.vouches_for = p.id)
     and abs(abs(r.amount) - p.amount) < 0.005
     and public.ledger_match_kind(public.ledger_kind(r.type, r.amount > 0))
         = public.ledger_match_kind(public.payment_ledger_kind(p.txn_type, case when p.status = 'review' then null else p.review_reason end))
     and abs(extract(epoch from date_trunc('minute', r.at) - date_trunc('minute', coalesce(p.occurred_at, p.received_at)))) <= 60
     and (r.party is null or p.counterparty is null or r.party = public.mask_bd_number(p.counterparty))
   order by abs(extract(epoch from date_trunc('minute', r.at) - date_trunc('minute', coalesce(p.occurred_at, p.received_at)))),
            (r.party is not null) desc
   limit 1;
$$;

-- How many finished app reads looked at this payment's minute (began 2+ min after it; oldest row older than it).
create or replace function public.app_reads_covering(p_payment uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.payments p
    join public.phone_commands c on c.device_id = p.device_id and c.kind = 'appread' and c.status = 'done'
   where p.id = p_payment
     and c.started_at >= coalesce(p.occurred_at, p.received_at) + interval '2 minutes'
     and substring(c.screens->>0 from 'oldest: ([0-9]{10,14})') is not null
     and to_timestamp((substring(c.screens->>0 from 'oldest: ([0-9]{10,14})'))::bigint / 1000.0)
         <= coalesce(p.occurred_at, p.received_at) - interval '1 minute';
$$;

-- 2 + 3. The verdicts, run after every app read ----------------------------------------------------------------------
create or replace function public.app_confirm_held(p_device uuid, p_command uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; rid uuid; r public.app_rows; res text; why text; covers int; cmd uuid;
  confirmed jsonb := '[]'::jsonb; fake jsonb := '[]'::jsonb; again jsonb := '[]'::jsonb;
begin
  for p in select * from public.payments x
            where x.device_id = p_device and x.provider = 'bkash' and x.status = 'review'
              and x.review_reason in ('balance_chain_mismatch', 'not_in_bkash_app')
              and x.received_at > now() - interval '3 days'
            order by x.received_at
  loop
    continue when not public.app_can_judge(p.id);
    rid := public.app_row_for(p.id);
    if rid is not null then
      update public.app_rows set vouches_for = p.id where id = rid and (vouches_for is null or vouches_for = p.id) returning * into r;
      continue when r.id is null;
      if p.review_reason = 'not_in_bkash_app' then
        update public.payments set review_reason = 'balance_chain_mismatch' where id = p.id;
      end if;
      why := 'The bKash app lists it: ' || to_char(r.at at time zone 'Asia/Dhaka', 'HH12:MI AM DD/MM') || ', ' || r.type
             || ', Tk ' || abs(r.amount)::text || coalesce(', ' || r.party, '') || '.';
      res := public.payment_check_confirm(p.id, 'statement', why);
      insert into public.events (kind, provider, payment_id, detail) values ('app_row_vouched', 'bkash', p.id,
        jsonb_build_object('device_id', p_device, 'command', p_command, 'row', r.id, 'result', res));
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
        -- One read did not list it: read once more straight away rather than wait for the half hour.
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
  -- A check still pointing at this read was not settled by it: unhook it, so the statement judge in ingest does not
  -- read the app's rows as a *247# statement. The next read that covers the payment settles it.
  update public.payment_checks set command_id = null where command_id = p_command and status = 'queued';
  return jsonb_build_object('confirmed', confirmed, 'fake', fake, 'again', again);
end $$;
revoke all on function public.app_confirm_held(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app_confirm_held(uuid, uuid) to service_role;

-- 1. Check at once ---------------------------------------------------------------------------------------------------------
create or replace function public.payment_check_start(p_payment uuid, p_step text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.payments; d public.devices; cmd uuid; chk uuid;
begin
  if p_step not in ('balance', 'statement') then return jsonb_build_object('error', 'bad_step'); end if;
  select * into p from public.payments where id = p_payment;
  if p.id is null then return jsonb_build_object('error', 'no_payment'); end if;
  if p.status <> 'review' or coalesce(p.review_reason, '') not in ('balance_chain_mismatch', 'not_in_bkash_app') then
    return jsonb_build_object('error', 'not_a_chain_hold');
  end if;
  if p.device_id is null then return jsonb_build_object('error', 'no_phone'); end if;
  if p.provider not in ('nagad', 'bkash') then return jsonb_build_object('error', 'no_flow'); end if; -- Rocket's menu is not known yet
  select * into d from public.devices where id = p.device_id;
  if d.id is null or d.status <> 'approved' then return jsonb_build_object('error', 'phone_not_approved'); end if;
  if d.allow_balance = false then return jsonb_build_object('error', 'balance_checks_off'); end if;
  perform public.phone_commands_tidy(p.device_id);
  -- migration 085: a bKash agent payment on a phone whose bKash app can be read is checked in the app, at once.
  if p.provider = 'bkash' and public.app_can_judge(p.id) and public.app_read_works(p.device_id) then
    begin
      insert into public.phone_commands (device_id, kind) values (p.device_id, 'appread') returning id into cmd;
    exception when unique_violation then
      select c.id into cmd from public.phone_commands c
       where c.device_id = p.device_id and c.kind = 'appread' and c.status in ('queued', 'running') limit 1;
    end;
    insert into public.payment_checks (payment_id, step, command_id) values (p.id, 'statement', cmd) returning id into chk;
    insert into public.events (kind, provider, payment_id, detail)
      values ('payment_check_started', p.provider, p.id, jsonb_build_object('step', 'app', 'command', cmd, 'device_id', p.device_id));
    return jsonb_build_object('check_id', chk, 'command_id', cmd, 'device_id', p.device_id, 'step', 'app');
  end if;
  if p.review_reason = 'not_in_bkash_app' then return jsonb_build_object('error', 'app_not_readable'); end if;
  begin
    insert into public.phone_commands (device_id, kind, provider) values (p.device_id, p_step, p.provider) returning id into cmd;
  exception when unique_violation then
    insert into public.payment_checks (payment_id, step, status, finished_at, detail)
      values (p.id, p_step, 'failed', now(), 'The phone was busy with another command. Ask again in a minute.');
    return jsonb_build_object('error', 'busy');
  end;
  insert into public.payment_checks (payment_id, step, command_id) values (p.id, p_step, cmd) returning id into chk;
  insert into public.events (kind, provider, payment_id, detail)
    values ('payment_check_started', p.provider, p.id, jsonb_build_object('step', p_step, 'command', cmd, 'device_id', p.device_id));
  return jsonb_build_object('check_id', chk, 'command_id', cmd, 'device_id', p.device_id, 'step', p_step);
end $$;

-- Wire it in: app_lines_record keeps rows by identity and runs the verdicts first; the event carries them for ingest.
do $m$
declare src text; out text;
begin
  src := pg_get_functiondef('public.app_lines_record(uuid,uuid,jsonb)'::regprocedure);
  if position('app_confirm_held' in src) = 0 then
    out := replace(src, 'confirmed jsonb := ''[]''::jsonb; gaps jsonb := ''[]''::jsonb;',
                        'confirmed jsonb := ''[]''::jsonb; gaps jsonb := ''[]''::jsonb; verdict jsonb := ''{}''::jsonb;');
    out := replace(out, E'  begin\n    confirmed := public.statement_confirm_held(p_device, ''bkash'');',
                        E'  perform public.app_rows_record(p_command, p_device, lines);\n'
                     || E'  begin\n    verdict := public.app_confirm_held(p_device, p_command);\n'
                     || E'  exception when others then\n'
                     || E'    insert into public.events (kind, provider, detail) values (''app_confirm_failed'', ''bkash'', jsonb_build_object(''device_id'', p_device, ''error'', left(sqlerrm, 200)));\n'
                     || E'  end;\n'
                     || E'  begin\n    confirmed := public.statement_confirm_held(p_device, ''bkash'');');
    out := replace(out, E'''confirmed'', jsonb_array_length(coalesce(confirmed, ''[]''::jsonb)), ''gaps'', gaps));',
                        E'''confirmed'', jsonb_array_length(coalesce(confirmed, ''[]''::jsonb)), ''gaps'', gaps,\n'
                     || E'                       ''app_confirmed'', coalesce(verdict->''confirmed'', ''[]''::jsonb), ''app_fake'', coalesce(verdict->''fake'', ''[]''::jsonb)));');
    if position('app_confirm_held' in out) = 0 or position('app_fake' in out) = 0 or position('verdict jsonb' in out) = 0 then
      raise exception 'app_lines_record: anchors not found';
    end if;
    execute out;
  end if;

  -- A read with no rows at all leaves its checks unhooked too.
  src := pg_get_functiondef('public.phone_commands_app_read()'::regprocedure);
  if position('payment_checks' in src) = 0 then
    out := replace(src, E'      perform public.app_lines_record(new.id, new.device_id, new.screens);',
                        E'      perform public.app_lines_record(new.id, new.device_id, new.screens);\n'
                     || E'      update public.payment_checks set command_id = null where command_id = new.id and status = ''queued'';');
    if out = src then raise exception 'phone_commands_app_read: anchor not found'; end if;
    execute out;
  end if;

  -- The day-count rule (061/081) no longer releases a bKash AGENT payment on a phone whose app can be read: there only
  -- the exact one-row match above may (a count can be fooled when two same-amount rows of a day overwrite each other).
  src := pg_get_functiondef('public.statement_confirm_held(uuid,text)'::regprocedure);
  if position('app_can_judge' in src) = 0 then
    out := replace(src, E'and x.received_at > now() - interval ''30 days''',
                        E'and x.received_at > now() - interval ''30 days''\n'
                     || E'       and not (x.provider = ''bkash'' and public.app_can_judge(x.id) and public.app_read_works(x.device_id))');
    if out = src then raise exception 'statement_confirm_held: anchor not found'; end if;
    execute out;
  end if;

  -- Stop asking a phone whose app build cannot read the bKash app (it answers "unsupported") for a day.
  src := pg_get_functiondef('public.app_read_tick()'::regprocedure);
  if position('''unsupported''' in src) = 0 then
    out := replace(src, 'last.error in (''no_bkash_app'', ''no_pin'', ''not_allowed'')',
                        'last.error in (''no_bkash_app'', ''no_pin'', ''not_allowed'', ''unsupported'')');
    if out = src then raise exception 'app_read_tick: anchor not found'; end if;
    execute out;
  end if;
end $m$;

-- Fill app_rows from the reads already stored (last 3 days), so the first verdicts have history to look at.
do $b$
declare c record;
begin
  for c in select id, device_id, screens from public.phone_commands
            where kind = 'appread' and status = 'done' and finished_at > now() - interval '3 days' order by finished_at
  loop
    perform public.app_rows_record(c.id, c.device_id, public.app_read_lines(c.screens));
  end loop;
end $b$;
