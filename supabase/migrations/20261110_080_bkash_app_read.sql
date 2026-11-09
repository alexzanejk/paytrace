-- 080: read the bKash Agent APP's transaction list every 30 minutes (owner 2026-11-10: "yes same pin, every 30 minutes,
-- build it", after the read-only test on the Vivo showed PayTrace can read the app: bKash Business 3.10.2, rows like
-- "ক্যাশ ইন | 0173XXXX653 | 01:20am 09/11/26 | - ৳21,250 | কমিশন: + ৳79.69").
--
-- WHY: the *247# statement shows only the newest few entries, dates without times, so a busy day's Cash Ins and B2B sends
-- (no SMS PayTrace can rely on) were never all seen: on 8 Nov the Vivo's bKash had 8 Cash Ins (Tk 12,420) and a B2B send
-- of Tk 5,000 that only the app showed, which is exactly the Tk -12,370 balance gap that stayed open.
--
-- HOW: the phone control "appread" (AppReader.kt) opens the app, logs in with the saved bKash PIN (typed ONCE; a second
-- login screen = login_failed, and then this file stops queuing for that phone until the owner presses the button), reads
-- ইনবক্স > লেনদেনসমূহ back to its last read, and sends every row word for word in the command's screens. A trigger on
-- phone_commands reads the rows HERE (no edge-function change) and stores them in statement_lines, the same table the
-- *247# statement fills, under the same type names ("Cash Out", "Cash In", "B2B Transfer", "Agent Cash Out"), so the
-- ledger, the balance-gap explanation, the held-payment release and the day check use them unchanged. New columns:
-- `at` (the row's exact time), `commission`, `source` ('ussd' | 'app'). Then the same follow-ups as a statement pull
-- run: statement_confirm_held and balance_gap_explain. Because the app covers whole days, the "as many entries that day
-- as PayTrace holds" rule in statement_confirm_held can now actually be met on a busy day.
--
-- No DROP or DELETE (the Supabase MCP hangs on them).

insert into public.phone_command_kinds (kind, needs_wallet) values ('appread', false) on conflict (kind) do nothing;

alter table public.statement_lines add column if not exists at timestamptz;
alter table public.statement_lines add column if not exists commission numeric(14, 2);
alter table public.statement_lines add column if not exists source text not null default 'ussd';

-- The app's row type, as the *247# statement names it (so one entry seen both ways is one line).
create or replace function public.app_row_type(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when t ~ '(এজেন্ট ক্যাশ আউট|agent cash ?out)' then 'Agent Cash Out'
    when t ~ '(ক্যাশ আউট|cash ?out)' then 'Cash Out'
    when t ~ '(ক্যাশ ইন|cash ?in)' then 'Cash In'
    when t ~ '(বিটুবি|b2b)' then 'B2B Transfer'
    else left(btrim(coalesce(p, '')), 60) end
  from (select lower(btrim(coalesce(p, ''))) as t) x;
$$;

-- The rows the phone sent (screens[1] is a header; each later line is one row, "word | word | ..."), newest first.
-- Returns [{no, day, at, type, amount (always positive), in, commission}]. A line without a row time or a signed taka
-- amount is left out. Pure.
create or replace function public.app_read_lines(p_screens jsonb) returns jsonb
language sql immutable set search_path = public as $$
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
      (select btrim(x) from unnest(arr) x
        where x !~* '(কমিশন|commission)' and x !~ '৳' and x !~* '\d{1,2}:\d{2}\s*[ap]m' and x !~ '^[0-9X+ ]+$' and btrim(x) <> ''
        limit 1) as ty
    from parts
  ), g as (
    select no, ty,
      (to_timestamp(upper(regexp_replace(t, '\s+', '', 'g')), 'HH12:MIAMDD/MM/YY')::timestamp at time zone 'Asia/Dhaka') as at,
      a ~ '^\s*\+' as incoming,
      replace(substring(a from '([0-9,]+(?:\.[0-9]+)?)'), ',', '')::numeric as amount,
      nullif(replace(substring(cm from '৳\s*([0-9,]+(?:\.[0-9]+)?)'), ',', ''), '')::numeric as commission
    from f where t is not null and a is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', no, 'day', to_char(at at time zone 'Asia/Dhaka', 'YYYY-MM-DD'), 'at', at, 'type', public.app_row_type(ty),
           'amount', amount, 'in', incoming, 'commission', commission) order by no), '[]'::jsonb)
    from g where amount > 0;
$$;

-- Stores one app read (bKash agent wallet of that phone) like a statement pull, then runs the same follow-ups.
create or replace function public.app_lines_record(p_command uuid, p_device uuid, p_screens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lines jsonb; wsim smallint; n int := 0; total int := 0; confirmed jsonb := '[]'::jsonb; gaps jsonb := '[]'::jsonb;
begin
  lines := public.app_read_lines(p_screens);
  total := jsonb_array_length(lines);
  if total = 0 then
    insert into public.events (kind, provider, detail) values ('app_read_recorded', 'bkash', jsonb_build_object('device_id', p_device, 'command', p_command, 'rows', 0));
    return jsonb_build_object('rows', 0);
  end if;
  wsim := public.sim_of_wallet(p_device, 'bkash');
  with l as (
    select (x->>'no')::int as no, (x->>'day')::date as day, left(x->>'type', 60) as type, (x->>'at')::timestamptz as at,
           case when (x->>'in')::boolean then (x->>'amount')::numeric else -((x->>'amount')::numeric) end as amount,
           nullif(x->>'commission', '')::numeric as commission
      from jsonb_array_elements(lines) x
  ), ranked as (
    select l.*, row_number() over (partition by l.day, l.type, l.amount order by l.no) as occ, l.no - 1 as list_pos from l
  ), ins as (
    insert into public.statement_lines (device_id, provider, sim_slot, day, type, amount, occ, list_pos, command_id, at, commission, source)
    select p_device, 'bkash', wsim, r.day, r.type, r.amount, r.occ, r.list_pos, p_command, r.at, r.commission, 'app' from ranked r
    on conflict (device_id, provider, day, type, amount, occ) do update
      set list_pos = excluded.list_pos, command_id = excluded.command_id, seen_at = now(),
          at = coalesce(excluded.at, public.statement_lines.at),
          commission = coalesce(excluded.commission, public.statement_lines.commission),
          source = 'app',
          sim_slot = coalesce(excluded.sim_slot, public.statement_lines.sim_slot)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into n from ins;
  begin
    confirmed := public.statement_confirm_held(p_device, 'bkash');
  exception when others then
    insert into public.events (kind, provider, detail) values ('statement_confirm_failed', 'bkash', jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
  end;
  begin
    gaps := public.balance_gap_explain(p_device, 'bkash');
  exception when others then
    insert into public.events (kind, provider, detail) values ('balance_gap_explain_failed', 'bkash', jsonb_build_object('device_id', p_device, 'error', left(sqlerrm, 200)));
  end;
  insert into public.events (kind, provider, detail) values ('app_read_recorded', 'bkash',
    jsonb_build_object('device_id', p_device, 'command', p_command, 'rows', total, 'new', n,
                       'confirmed', jsonb_array_length(coalesce(confirmed, '[]'::jsonb)), 'gaps', gaps));
  return jsonb_build_object('rows', total, 'new', n, 'confirmed', confirmed, 'gaps', gaps);
end $$;

revoke all on function public.app_lines_record(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_lines_record(uuid, uuid, jsonb) to service_role;

-- A finished "appread" is read at once, inside the database. Wrapped: a reading problem never undoes the command's result.
create or replace function public.phone_commands_app_read() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'appread' and new.status = 'done' and old.status is distinct from 'done' then
    begin
      perform public.app_lines_record(new.id, new.device_id, new.screens);
    exception when others then
      insert into public.events (kind, provider, detail) values ('app_read_record_failed', 'bkash',
        jsonb_build_object('device_id', new.device_id, 'command', new.id, 'error', left(sqlerrm, 200)));
    end;
  end if;
  return new;
end $$;

create trigger phone_commands_app_read after update of status on public.phone_commands
  for each row execute function public.phone_commands_app_read();

-- Every 30 minutes: one "appread" per approved phone that has a bKash AGENT wallet saved in its app, is online, and may be
-- read (allow_balance). Never after a login_failed (bKash locks after wrong PINs): only the owner's button starts again.
-- A phone with no bKash app or no saved PIN is left alone for a day.
create or replace function public.app_read_tick() returns int
language plpgsql security definer set search_path = public as $$
declare d record; last record; n int := 0;
begin
  for d in
    select v.id from public.devices v
     where v.status = 'approved' and coalesce(v.allow_balance, false)
       and v.last_seen_at > now() - interval '3 minutes'
       and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v.info->'wallets') = 'array' then v.info->'wallets' else '[]'::jsonb end) w
                    where w->>'provider' = 'bkash' and coalesce(w->>'kind', 'agent') = 'agent')
  loop
    select c.status, c.error, c.created_at into last from public.phone_commands c
     where c.device_id = d.id and c.kind = 'appread' order by c.created_at desc limit 1;
    if last.status in ('queued', 'running') then continue; end if;
    if last.created_at > now() - interval '25 minutes' then continue; end if;
    if last.error = 'login_failed' then continue; end if;
    if last.error in ('no_bkash_app', 'no_pin', 'not_allowed') and last.created_at > now() - interval '24 hours' then continue; end if;
    if exists (select 1 from public.phone_commands c where c.device_id = d.id and c.status = 'running') then continue; end if;
    begin
      insert into public.phone_commands (device_id, kind) values (d.id, 'appread');
      n := n + 1;
    exception when unique_violation then
      null;
    end;
  end loop;
  return n;
end $$;

revoke all on function public.app_read_tick() from public, anon, authenticated;
grant execute on function public.app_read_tick() to service_role;

select cron.schedule('paytrace-app-read', '3,33 * * * *', $$select public.app_read_tick()$$);
