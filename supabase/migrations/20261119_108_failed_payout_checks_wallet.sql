-- 108: a payout the phone calls "failed" is checked against the wallet itself before its transactions are released
-- (owner 2026-11-19: "when failed it check the statement to confirm"; "yes build it"). Eight payouts went out twice
-- because a "failed" answer released the transactions while the money had in fact gone (106/107). And a Cash In
-- sent through the bKash app sends NO SMS (0 of 7), so for those the wallet's own list is the only proof.
--
-- Now, when a dashboard Cash In / Send Money fails AFTER it may have reached the wallet:
--   * the payout (or commission payment) stays taken: status 'sending' (or 'unsure' when the phone stopped after the
--     PIN), check_since set; the dashboard shows "Checking the wallet";
--   * payout_checks_tick() (pg_cron every minute) asks the phone to read the wallet's list: the bKash / Nagad agent
--     app list when that works on the phone (exact minute and number), else the *247# / *167# statement;
--   * FOUND (an SMS, or an app row, of exactly this amount to this number, timed inside the command's life, that no
--     other send explains) -> paid; NOT FOUND in a fresh app list (and, for a USSD send, no SMS 3 minutes after) ->
--     released as before ("failed"), or left "unsure" when the phone had stopped after the PIN; no answer within 15
--     minutes -> "unsure" for the owner. It never releases a payout without the wallet's own word.
-- Failures that cannot have reached the wallet at all (no PIN saved, switch off, phone locked, dialer blocked, ...)
-- are released at once, as before.

alter table public.payouts
  add column if not exists check_since timestamptz,
  add column if not exists check_error text,
  add column if not exists check_read uuid,
  add column if not exists check_tries int not null default 0,
  add column if not exists check_done_at timestamptz,
  add column if not exists check_note text;
alter table public.commission_pays
  add column if not exists check_since timestamptz,
  add column if not exists check_error text,
  add column if not exists check_read uuid,
  add column if not exists check_tries int not null default 0,
  add column if not exists check_done_at timestamptz,
  add column if not exists check_note text;

-- Errors the phone reports before anything could reach the wallet.
create or replace function public.payout_never_started(p_error text)
returns boolean language sql immutable as $$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'cash_in_off', 'no_pin', 'no_accessibility',
    'accessibility_not_running', 'no_call_permission', 'unsupported', 'bad_cash_in', 'personal_off', 'no_personal',
    'phone_locked', 'dialer_blocked', 'too_soon', 'no_bkash_app', 'no_nagad_app', 'sim_not_found', 'sim_no_service',
    'dial_failed', 'app_not_opened', 'login_failed', 'pin_not_entered', 'secure_keyboard');
$$;

-- Did this send reach the wallet? A TrxID ('' = found without one) or null.
create or replace function public.payout_check_found(p_dev uuid, p_provider text, p_amount numeric, p_to text,
                                                     p_t0 timestamptz, p_t1 timestamptz, p_cmd uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := date_trunc('minute', p_t0); v_to timestamptz := p_t1 + interval '2 minutes';
        n_other int; n_other_notrx int; n_sms int; n_app int; v_trx text; v_day date; n_lines int; n_known int;
begin
  -- Other sends of the same amount to the same number, running at the same time, that DID go: each explains one entry.
  select count(*), count(*) filter (where x.trx_id is null) into n_other, n_other_notrx from public.phone_commands x
   where x.id <> p_cmd and x.device_id = p_dev and x.provider = p_provider and x.kind in ('cashin', 'sendmoney')
     and x.amount = p_amount and public.number_fits(x.to_number, p_to)
     and x.created_at <= v_to and coalesce(x.finished_at, x.created_at) >= v_from
     and (x.status = 'done'
          or exists (select 1 from public.payouts po where po.command_id = x.id and po.status = 'paid')
          or exists (select 1 from public.commission_pays cp where cp.command_id = x.id and cp.status = 'paid'));

  -- The wallet's SMS, by its own clock; an SMS that carries another send's TrxID is that send's.
  select count(*), max(p.trx_id) into n_sms, v_trx from public.payments p
   where p.device_id = p_dev and p.provider = p_provider and p.review_reason in ('cash_in_sent', 'send_money_sent')
     and p.amount = p_amount and public.number_fits(p_to, p.counterparty)
     and coalesce(p.occurred_at, p.received_at) between v_from and v_to
     and not exists (select 1 from public.phone_commands x where x.id <> p_cmd and upper(x.trx_id) = upper(p.trx_id))
     and not exists (select 1 from public.payouts x where upper(x.trx_id) = upper(p.trx_id) and x.command_id is distinct from p_cmd)
     and not exists (select 1 from public.commission_pays x where upper(x.trx_id) = upper(p.trx_id) and x.command_id is distinct from p_cmd);
  if n_sms > n_other_notrx then return coalesce(v_trx, ''); end if;

  -- The wallet app's own list (exact minute, number with hidden middle; usually no TrxID, so every other send counts).
  select count(*), max(r.trx_id) into n_app, v_trx from public.app_rows r
   where r.device_id = p_dev and r.provider = p_provider and r.type = 'Cash In' and r.amount = -p_amount
     and public.number_fits(p_to, r.party) and r.at between v_from and v_to
     and (r.trx_id is null or (not exists (select 1 from public.phone_commands x where x.id <> p_cmd and upper(x.trx_id) = upper(r.trx_id))
                               and not exists (select 1 from public.payouts x where upper(x.trx_id) = upper(r.trx_id) and x.command_id is distinct from p_cmd)
                               and not exists (select 1 from public.commission_pays x where upper(x.trx_id) = upper(r.trx_id) and x.command_id is distinct from p_cmd)));
  if n_app > n_other then return coalesce(v_trx, ''); end if;

  -- The *247# / *167# statement (dates only): more Cash Ins of this amount that day, in a pull made after the send,
  -- than every send PayTrace knows of that day.
  v_day := (p_t0 at time zone 'Asia/Dhaka')::date;
  select count(*) into n_lines from public.statement_lines s
   where s.device_id = p_dev and s.provider = p_provider and s.day = v_day and s.source = 'ussd'
     and s.amount = -p_amount and public.ledger_kind(s.type, s.amount > 0) = 'cash_in_sent' and s.seen_at >= p_t1;
  if n_lines > 0 then
    select count(*) into n_known from (
      select p.id from public.payments p
       where p.device_id = p_dev and p.provider = p_provider and p.review_reason = 'cash_in_sent' and p.amount = p_amount
         and (coalesce(p.occurred_at, p.received_at) at time zone 'Asia/Dhaka')::date = v_day
      union all
      select c.id from public.phone_commands c
       where c.device_id = p_dev and c.provider = p_provider and c.kind = 'cashin' and c.status = 'done' and c.amount = p_amount
         and c.id <> p_cmd and (c.finished_at at time zone 'Asia/Dhaka')::date = v_day
         and not exists (select 1 from public.payments p where upper(p.trx_id) = upper(c.trx_id))
    ) k;
    if n_lines > n_known then return ''; end if;
  end if;
  return null;
end $$;
revoke all on function public.payout_check_found(uuid, text, numeric, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.payout_check_found(uuid, text, numeric, text, timestamptz, timestamptz, uuid) to service_role;

-- Ask the phone to read the wallet's list. The app list when it works there, else the USSD statement.
create or replace function public.payout_check_queue(p_dev uuid, p_provider text, p_personal boolean, p_no_app boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.devices; k text; cid uuid;
begin
  select * into d from public.devices where id = p_dev;
  if d.id is null or d.status <> 'approved' or coalesce(d.allow_balance, false) = false then return null; end if;
  if p_personal or p_provider not in ('bkash', 'nagad') then return null; end if;
  if not p_no_app and p_provider = 'bkash' and public.app_read_works(p_dev) and not public.app_login_blocked(p_dev, 'bkash') then
    k := 'appread';
  elsif not p_no_app and p_provider = 'nagad' and coalesce(d.info->>'app_nagad', '') = 'true' and not public.app_login_blocked(p_dev, 'nagad')
        and exists (select 1 from public.phone_commands c where c.device_id = p_dev and c.kind = 'nagadread' and c.status = 'done'
                      and c.finished_at > now() - interval '24 hours') then
    k := 'nagadread';
  else
    k := 'statement';
  end if;
  -- A read of that kind already waiting runs after the failure anyway: use it.
  select c.id into cid from public.phone_commands c
   where c.device_id = p_dev and c.kind = k and c.status = 'queued' and (k <> 'statement' or c.provider = p_provider)
   order by c.created_at desc limit 1;
  if cid is not null then return cid; end if;
  if exists (select 1 from public.phone_commands c where c.device_id = p_dev and c.kind = k and c.status = 'running') then return null; end if;
  begin
    if k = 'statement' then
      insert into public.phone_commands (device_id, kind, provider) values (p_dev, 'statement', p_provider) returning id into cid;
    else
      insert into public.phone_commands (device_id, kind) values (p_dev, k) returning id into cid;
    end if;
  exception when unique_violation then
    return null;
  end;
  insert into public.events (kind, provider, detail)
    values ('payout_check_read', p_provider, jsonb_build_object('device_id', p_dev, 'kind', k, 'command_id', cid));
  return cid;
end $$;
revoke all on function public.payout_check_queue(uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.payout_check_queue(uuid, text, boolean, boolean) to service_role;

-- A command's answer: done = paid; nothing could have reached the wallet = released; anything else = check the wallet.
create or replace function public.payouts_follow_command()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status or new.status not in ('done', 'failed', 'cancelled') then return new; end if;
  begin
    if new.status = 'done' then
      update public.payouts set status = 'paid', trx_id = coalesce(new.trx_id, trx_id), balance_after = new.balance, paid_at = coalesce(paid_at, now()),
             check_done_at = case when check_since is not null then coalesce(check_done_at, now()) else check_done_at end
       where command_id = new.id and status in ('sending', 'unsure');
    elsif new.status = 'cancelled' or public.payout_never_started(new.error) then
      update public.payouts set status = 'failed', error = coalesce(new.error, 'cancelled') where command_id = new.id and status = 'sending';
      update public.payout_items i set live = false from public.payouts o
       where o.id = i.payout_id and o.command_id = new.id and o.status = 'failed';
    else
      update public.payouts
         set status = case when public.payout_safe_error(new.error) then 'sending' else 'unsure' end,
             error = coalesce(new.error, 'failed'), check_since = now(), check_error = coalesce(new.error, 'failed'),
             check_note = 'Checking the wallet''s own list before deciding.'
       where command_id = new.id and status = 'sending';
    end if;
  exception when others then
    insert into public.events (kind, detail) values ('payout_follow_failed', jsonb_build_object('command_id', new.id, 'error', left(sqlerrm, 200)));
  end;
  return new;
end $$;

create or replace function public.commission_pays_follow_command()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.status is not distinct from old.status or new.status not in ('done', 'failed', 'cancelled') then return new; end if;
  begin
    select id into v_id from public.commission_pays where command_id = new.id and status in ('sending', 'unsure');
    if v_id is null then return new; end if;
    if new.status = 'done' then
      perform public.commission_pay_settle(v_id, new.trx_id, new.balance);
      update public.commission_pays set check_done_at = coalesce(check_done_at, now()) where id = v_id and check_since is not null;
    elsif new.status = 'cancelled' or public.payout_never_started(new.error) then
      update public.commission_pays set status = 'failed', error = coalesce(new.error, 'cancelled') where id = v_id and status = 'sending';
      update public.commission_pay_days set live = false where pay_id = v_id and exists (select 1 from public.commission_pays where id = v_id and status = 'failed');
    else
      update public.commission_pays
         set status = case when public.payout_safe_error(new.error) then 'sending' else 'unsure' end,
             error = coalesce(new.error, 'failed'), check_since = now(), check_error = coalesce(new.error, 'failed'),
             check_note = 'Checking the wallet''s own list before deciding.'
       where id = v_id and status = 'sending';
    end if;
  exception when others then
    insert into public.events (kind, detail) values ('commission_pay_follow_failed', jsonb_build_object('command_id', new.id, 'error', left(sqlerrm, 200)));
  end;
  return new;
end $$;

-- Every minute: move each check one step.
create or replace function public.payout_checks_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_trx text; rd public.phone_commands; v_neg boolean; v_oldest text; v_cid uuid; n int := 0;
        v_verdict text; v_note text;
begin
  for r in
    select 'payout'::text as k, o.id, o.device_id as dev, o.provider, o.send_amount as amt, o.to_number, o.status,
           o.check_since, o.check_error, o.check_read, o.check_tries, (o.from_account = 'personal') as personal,
           o.command_id as cmd, c.created_at as t0, coalesce(c.finished_at, c.created_at) as t1, coalesce(c.via, 'ussd') as via
      from public.payouts o join public.phone_commands c on c.id = o.command_id
     where o.check_since is not null and o.check_done_at is null
    union all
    select 'commission', o.id, o.from_device_id, o.provider, o.send_amount, o.to_number, o.status,
           o.check_since, o.check_error, o.check_read, o.check_tries, (o.method = 'send_money'),
           o.command_id, c.created_at, coalesce(c.finished_at, c.created_at), coalesce(c.via, 'ussd')
      from public.commission_pays o join public.phone_commands c on c.id = o.command_id
     where o.check_since is not null and o.check_done_at is null
  loop
    n := n + 1;
    v_verdict := null; v_note := null; v_trx := null;
    begin
      if r.status not in ('sending', 'unsure') then
        v_verdict := 'settled_elsewhere';
      else
        v_trx := public.payout_check_found(r.dev, r.provider, r.amt, r.to_number, r.t0, r.t1, r.cmd);
        if v_trx is not null then
          v_verdict := 'paid';
          v_note := 'Found in the wallet' || case when v_trx <> '' then ' (TrxID ' || v_trx || ')' else '' end || ': the money went.';
        else
          -- Ask for a read if none is on the way.
          if r.check_read is null then
            v_cid := public.payout_check_queue(r.dev, r.provider, r.personal, r.check_tries >= 1);
            if v_cid is not null then
              if r.k = 'payout' then update public.payouts set check_read = v_cid, check_tries = check_tries + 1 where id = r.id;
              else update public.commission_pays set check_read = v_cid, check_tries = check_tries + 1 where id = r.id; end if;
            end if;
          else
            select * into rd from public.phone_commands where id = r.check_read;
            if rd.status in ('failed', 'cancelled') then
              -- One more try (the USSD statement this time), then wait for the deadline.
              if r.check_tries < 2 then
                if r.k = 'payout' then update public.payouts set check_read = null where id = r.id;
                else update public.commission_pays set check_read = null where id = r.id; end if;
              end if;
            elsif rd.status = 'done' and rd.started_at >= r.t1 then
              v_neg := false;
              if rd.kind in ('appread', 'nagadread') then
                -- The list must reach back to before the send started.
                v_oldest := substring(rd.screens->>0 from 'oldest: ([0-9]{10,14})');
                v_neg := (v_oldest is not null and to_timestamp(v_oldest::bigint / 1000.0) <= date_trunc('minute', r.t0))
                      or exists (select 1 from public.app_rows a where a.device_id = r.dev and a.provider = r.provider
                                   and a.last_command = rd.id and a.at < date_trunc('minute', r.t0));
              elsif rd.kind = 'statement' then
                v_neg := true;
              end if;
              -- A USSD send also gives the SMS a few minutes to arrive.
              if v_neg and (r.via = 'app' or now() > r.t1 + interval '3 minutes') then
                if public.payout_safe_error(r.check_error) then
                  v_verdict := 'released';
                  v_note := case when r.via = 'app' then 'Not in the wallet''s own list: nothing was sent.' else 'Not in the wallet''s own list and no SMS: nothing was sent.' end;
                else
                  v_verdict := 'unsure';
                  v_note := 'Not found in the wallet''s list, but the phone stopped after the PIN. Check the wallet.';
                end if;
              end if;
            end if;
          end if;
          if v_verdict is null and now() > r.check_since + interval '15 minutes' then
            v_verdict := 'unsure';
            v_note := 'The wallet could not be checked in 15 minutes. Check the wallet, then say whether it was sent.';
          end if;
        end if;
      end if;

      if v_verdict is not null then
        perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
        if r.k = 'payout' then
          if v_verdict = 'paid' then
            update public.payouts set status = 'paid', trx_id = coalesce(trx_id, nullif(v_trx, '')), paid_at = coalesce(paid_at, now()),
                   error = null, check_done_at = now(), check_note = v_note where id = r.id and status in ('sending', 'unsure');
          elsif v_verdict = 'released' then
            update public.payouts set status = 'failed', error = r.check_error, check_done_at = now(), check_note = v_note
             where id = r.id and status = 'sending';
            update public.payout_items set live = false where payout_id = r.id
               and exists (select 1 from public.payouts where id = r.id and status = 'failed');
          elsif v_verdict = 'unsure' then
            update public.payouts set status = 'unsure', check_done_at = now(), check_note = v_note where id = r.id and status in ('sending', 'unsure');
          else
            update public.payouts set check_done_at = now() where id = r.id;
          end if;
        else
          if v_verdict = 'paid' then
            perform public.commission_pay_settle(r.id, nullif(v_trx, ''), null);
            update public.commission_pays set error = null, check_done_at = now(), check_note = v_note where id = r.id;
          elsif v_verdict = 'released' then
            update public.commission_pays set status = 'failed', error = r.check_error, check_done_at = now(), check_note = v_note
             where id = r.id and status = 'sending';
            update public.commission_pay_days set live = false where pay_id = r.id
               and exists (select 1 from public.commission_pays where id = r.id and status = 'failed');
          elsif v_verdict = 'unsure' then
            update public.commission_pays set status = 'unsure', check_done_at = now(), check_note = v_note where id = r.id and status in ('sending', 'unsure');
          else
            update public.commission_pays set check_done_at = now() where id = r.id;
          end if;
        end if;
        if v_verdict <> 'settled_elsewhere' then
          insert into public.events (kind, provider, detail)
            values ('payout_check_' || v_verdict, r.provider, jsonb_build_object(r.k || '_id', r.id, 'command_id', r.cmd, 'note', v_note));
        end if;
      end if;
    exception when others then
      insert into public.events (kind, detail) values ('payout_check_error', jsonb_build_object('id', r.id, 'error', left(sqlerrm, 200)));
    end;
  end loop;
  return n;
end $$;
revoke all on function public.payout_checks_tick() from public, anon, authenticated;
grant execute on function public.payout_checks_tick() to service_role;

select cron.schedule('paytrace-payout-check', '* * * * *', $cron$select public.payout_checks_tick()$cron$);

-- 9th likely double payment, found by the check while testing it on history (statement count): Vivo, Nagad, 14 Nov
-- 15:51, Tk 420 to 01710111731 failed 'unexpected_screen', but one statement pull listed three Tk 420 Cash Ins that
-- day where PayTrace knew two; the transaction was paid again. Marked for the owner to verify.
update public.payouts set status = 'paid', error = 'paid_twice', paid_at = coalesce(paid_at, now()),
       check_note = 'Likely: the Nagad statement of 14 Nov lists three Tk 420 Cash Ins where PayTrace knew two. Check the Vivo''s Nagad statement for 01710111731 at 15:51.'
 where command_id = 'ac9d386b-8b49-4d71-91c6-8ef7b8e683cf' and status = 'failed';
