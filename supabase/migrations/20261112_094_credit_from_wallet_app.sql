-- 094: a deposit is credited from the wallet's OWN app when the wallet sent no SMS (owner 2026-11-12: "yes build both",
-- after DKB1CVD04L: a real Tk 500 bKash Cash Out at 6:58 PM that the bKash app listed but whose SMS never came, so
-- 777bajii's order GW-94481D963F expired), and "An error occurred" after the PIN is no longer read as a wrong PIN.
--
-- The rule (exact, no guessing): a deposit order a customer typed a TrxID on, with NO payment of that TrxID, is credited
-- only when the wallet app on THAT order's phone shows a money-in Cash Out row whose own TrxID (read from the row's
-- details, never guessed from a minute or number) is exactly the typed one, whose amount is exactly the order's, and
-- whose time is within the order's life (5 minutes before it was made up to 10 minutes after it expired). The payment is
-- then written as if the SMS had come (marked in its text as read from the app, `confirmed_by` 'statement') and goes
-- through reconcile_payment, the one crediting path, with all its rules. A fake TrxID cannot be in the wallet's own app.
--
-- To find such a row without waiting for luck, every 5 minutes the server asks the order's phone to SEARCH its wallet app
-- for the typed TrxID (bKash: appsearch; Nagad: nagadsearch), once, and a second time only if the first search did not
-- run. The search opens the one row and reads its TrxID, which is what the rule needs.
--
-- Nothing is removed.

-- A wallet app run that stopped on the wallet's own error before anything was sent is safe for a payout.
create or replace function public.payout_safe_error(p_error text)
 returns boolean language sql immutable
as $function$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused', 'personal_off', 'no_personal',
    'no_bkash_app', 'app_not_opened', 'login_failed', 'pin_not_entered', 'app_stopped_before_send', 'insufficient_balance',
    'pin_refused', 'no_nagad_app', 'app_error');
$function$;

create or replace function public.app_credit_from_app(p_device uuid, p_provider text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare o record; r public.app_rows; pid uuid; res text; label text; credited jsonb := '[]'::jsonb;
begin
  label := case when p_provider = 'nagad' then 'Nagad' else 'bKash' end;
  for o in
    select x.* from public.orders x
     where x.kind = 'deposit' and x.device_id = p_device and x.claimed_provider = p_provider
       and x.claimed_trx_id is not null and coalesce(x.wallet_method, '') = 'cash_out'
       and (x.status in ('pending', 'review') or (x.status = 'expired' and x.expires_at > now() - interval '24 hours'))
       and not exists (select 1 from public.payments p where p.provider = x.claimed_provider and p.trx_id = x.claimed_trx_id)
     order by x.created_at
  loop
    select * into r from public.app_rows a
     where a.device_id = p_device and a.provider = p_provider and a.trx_id = o.claimed_trx_id
       and a.amount > 0 and abs(a.amount - o.expected_amount) < 0.005
       and a.type in ('Cash Out', 'Agent Cash Out')
       and a.at >= o.created_at - interval '5 minutes' and a.at <= o.expires_at + interval '10 minutes'
       and a.vouches_for is null
     limit 1;
    continue when r.id is null;
    pid := null;
    begin
      insert into public.payments (provider, txn_type, trx_id, amount, commission, counterparty, occurred_at, raw_message,
                                   status, chain_status, device_id, confirmed_by, sim_slot)
      values (p_provider, 'cash_out', o.claimed_trx_id, r.amount, coalesce(r.commission, 0), r.party, r.at,
              format('Read from the %s app on the phone (no SMS arrived): %s Tk %s from %s at %s, TrxID %s.', label, r.type,
                     r.amount, coalesce(r.party, '?'), to_char(r.at at time zone 'Asia/Dhaka', 'HH12:MI AM DD/MM/YYYY'), r.trx_id),
              'tracked_only', 'unverified', p_device, 'statement', public.sim_of_wallet(p_device, p_provider))
      returning id into pid;
    exception when unique_violation then
      continue;  -- the SMS arrived at the same moment: it takes the ordinary path
    end;
    update public.app_rows set vouches_for = pid where id = r.id;
    res := public.reconcile_payment(pid);
    insert into public.events (kind, provider, payment_id, order_id, detail) values ('paid_from_app', p_provider, pid, o.id,
      jsonb_build_object('device_id', p_device, 'row', r.id, 'trx_id', r.trx_id, 'amount', r.amount, 'at', r.at, 'result', res));
    credited := credited || jsonb_build_object('payment_id', pid, 'order_id', o.id, 'trx_id', r.trx_id, 'amount', r.amount, 'result', res);
  end loop;
  return credited;
end $function$;
revoke all on function public.app_credit_from_app(uuid, text) from public, anon, authenticated;

-- Every finished read or search of a wallet app also tries the rule above.
create or replace function public.phone_commands_app_read()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare prov text;
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.kind in ('appread', 'appsearch', 'nagadread', 'nagadsearch') then
    prov := case when new.kind like 'nagad%' then 'nagad' else 'bkash' end;
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
      insert into public.events (kind, provider, detail) values ('app_read_record_failed', prov,
        jsonb_build_object('device_id', new.device_id, 'command', new.id, 'search', new.kind like '%search', 'error', left(sqlerrm, 200)));
    end;
    begin
      perform public.app_credit_from_app(new.device_id, prov);
    exception when others then
      insert into public.events (kind, provider, detail) values ('paid_from_app_failed', prov,
        jsonb_build_object('device_id', new.device_id, 'command', new.id, 'error', left(sqlerrm, 200)));
    end;
  end if;
  return new;
end $function$;

-- Every 5 minutes: a typed TrxID with no SMS 5+ minutes after it was typed is searched for in the order's phone's wallet app.
create or replace function public.app_search_unpaid_tick()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare o record; d public.devices; k text; tries int; last_cmd record; cid uuid; n int := 0;
begin
  for o in
    select x.*, (select max(e.at) from public.events e where e.kind = 'claim' and e.order_id = x.id) as claimed_at
      from public.orders x
     where x.kind = 'deposit' and x.claimed_trx_id is not null and coalesce(x.wallet_method, '') = 'cash_out'
       and x.claimed_provider in ('bkash', 'nagad') and x.device_id is not null
       and x.created_at > now() - interval '24 hours'
       and (x.status in ('pending', 'review') or (x.status = 'expired' and x.expires_at > now() - interval '24 hours'))
       and ((x.claimed_provider = 'bkash' and x.claimed_trx_id ~ '^[A-Z0-9]{10}$')
            or (x.claimed_provider = 'nagad' and x.claimed_trx_id ~ '^[A-Z0-9]{8}$'))
       and x.claimed_trx_id ~ '[A-Z]'
       and not exists (select 1 from public.payments p where p.provider = x.claimed_provider and p.trx_id = x.claimed_trx_id)
       and not exists (select 1 from public.app_rows a where a.provider = x.claimed_provider and a.trx_id = x.claimed_trx_id)
     order by x.created_at
     limit 20
  loop
    continue when o.claimed_at is null or o.claimed_at > now() - interval '5 minutes';
    k := case when o.claimed_provider = 'nagad' then 'nagadsearch' else 'appsearch' end;
    select * into d from public.devices where id = o.device_id;
    continue when d.id is null or d.status <> 'approved' or d.allow_balance is false;
    continue when d.last_seen_at is null or d.last_seen_at < now() - interval '3 minutes';
    continue when coalesce((d.info->>(case when k = 'nagadsearch' then 'app_nagad' else 'app_search' end))::boolean, false) is not true;
    select count(*) into tries from public.events e where e.kind = 'app_search_auto' and e.order_id = o.id;
    continue when tries >= 2;
    if tries = 1 then
      -- A second search only when the first did not run (failed, cancelled, or never reached the search box).
      select c.status, c.error, c.screens, c.created_at into last_cmd from public.phone_commands c
       where c.id = (select (e.detail->>'command')::uuid from public.events e where e.kind = 'app_search_auto' and e.order_id = o.id order by e.at desc limit 1);
      continue when last_cmd.status in ('queued', 'running');
      continue when last_cmd.created_at > now() - interval '10 minutes';
      continue when last_cmd.status = 'done' and coalesce(last_cmd.screens->>0, '') ~ 'outcome: (found|nothing found)';
    end if;
    -- One search of each kind at a time per phone; the phone takes app work one at a time anyway.
    continue when exists (select 1 from public.phone_commands c where c.device_id = d.id and c.kind = k and c.status in ('queued', 'running'));
    cid := null;
    begin
      if k = 'appsearch' then
        insert into public.phone_commands (device_id, kind, query) values (d.id, k, o.claimed_trx_id) returning id into cid;
      else
        insert into public.phone_commands (device_id, kind, app_query) values (d.id, k, o.claimed_trx_id) returning id into cid;
      end if;
    exception when unique_violation then
      continue;
    end;
    insert into public.events (kind, provider, order_id, detail) values ('app_search_auto', o.claimed_provider, o.id,
      jsonb_build_object('device_id', d.id, 'command', cid, 'trx_id', o.claimed_trx_id, 'try', tries + 1));
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.app_search_unpaid_tick() from public, anon, authenticated;

select cron.schedule('paytrace-app-search-unpaid', '*/5 * * * *', 'select public.app_search_unpaid_tick()');
