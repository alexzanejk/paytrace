-- 125: a failed payout on a wallet PayTrace cannot read goes to the owner at once, and the owner may decide while a check runs.
-- Owner 2026-11-21: a Tk 5,900 personal bKash Send Money failed 'wallet_refused' and read "Checking the wallet..." for
-- 15 minutes with no button, although a personal account has no list the phone can read (no app, no *247# statement):
-- the check could only wait for an SMS that never comes when nothing was sent.
-- (1) payout_check_possible = the gates of payout_check_queue; when false and no SMS proves the send, the tick marks the
--     payout 'unsure' on its first run (transactions stay taken; an SMS arriving later still marks it paid, 065/067).
-- (2) resolve_payout / resolve_commission_pay also take a 'sending' row whose check is running: the owner's answer ends it.
-- Everything else in payout_checks_tick is 108's text unchanged. No DROP, no DELETE (MCP rule).

create or replace function public.payout_check_possible(p_dev uuid, p_provider text, p_personal boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.devices d where d.id = p_dev and d.status = 'approved' and coalesce(d.allow_balance, false))
     and not coalesce(p_personal, false) and p_provider in ('bkash', 'nagad');
$$;
revoke all on function public.payout_check_possible(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.payout_check_possible(uuid, text, boolean) to service_role;

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
            if not public.payout_check_possible(r.dev, r.provider, r.personal) then
              -- 125: a wallet the phone cannot read (a personal account, Rocket/Upay, balance reads off) is the owner's call at once.
              v_verdict := 'unsure';
              v_note := 'PayTrace cannot read this wallet (' || case when r.personal then 'a personal account' when r.provider not in ('bkash','nagad') then 'no list for ' || r.provider else 'balance reads are off for this phone' end
                        || '): check it yourself, then say whether it was sent.';
            else
              v_cid := public.payout_check_queue(r.dev, r.provider, r.personal, r.check_tries >= 1);
              if v_cid is not null then
                if r.k = 'payout' then update public.payouts set check_read = v_cid, check_tries = check_tries + 1 where id = r.id;
                else update public.commission_pays set check_read = v_cid, check_tries = check_tries + 1 where id = r.id; end if;
              end if;
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

-- The owner's answer while the check is still running (status 'sending', check_since set, check_done_at null).
create or replace function public.resolve_payout(p_payout uuid, p_sent boolean, p_trx text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.payouts; v_trx text; v_checking boolean;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into o from public.payouts where id = p_payout for update;
  if o.id is null then raise exception 'no such payout'; end if;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_checking := (o.status = 'sending' and o.check_since is not null and o.check_done_at is null);
  if o.status = 'unsure' or v_checking then
    if p_sent then
      update public.payouts set status = 'paid', trx_id = coalesce(left(v_trx, 24), trx_id), paid_at = now(), resolved_by = auth.uid(), resolved_at = now(),
             check_done_at = case when v_checking then now() else check_done_at end,
             check_note = case when v_checking then 'Decided by you before the check finished: it was sent.' else check_note end
       where id = o.id;
    else
      update public.payouts set status = 'failed', resolved_by = auth.uid(), resolved_at = now(),
             check_done_at = case when v_checking then now() else check_done_at end,
             check_note = case when v_checking then 'Decided by you before the check finished: it was NOT sent.' else check_note end
       where id = o.id;
      update public.payout_items set live = false where payout_id = o.id;
    end if;
  elsif o.status = 'paid' and o.method = 'manual' and not p_sent then
    update public.payouts set status = 'cancelled', resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    update public.payout_items set live = false where payout_id = o.id;
  else
    raise exception 'only an unsure payout, one still being checked, or one recorded by hand, can be changed';
  end if;
  insert into public.events (kind, detail) values ('payout_resolved', jsonb_build_object('payout_id', o.id, 'sent', p_sent, 'trx', v_trx, 'by', auth.uid(), 'while_checking', v_checking));
end $$;
revoke all on function public.resolve_payout(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_payout(uuid, boolean, text) to authenticated;

create or replace function public.resolve_commission_pay(p_pay uuid, p_sent boolean, p_trx text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.commission_pays; v_trx text; v_checking boolean;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into o from public.commission_pays where id = p_pay for update;
  if o.id is null then raise exception 'no such payment'; end if;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_checking := (o.status = 'sending' and o.check_since is not null and o.check_done_at is null);
  if (o.status = 'unsure' or v_checking) and p_sent then
    update public.commission_pays set resolved_by = auth.uid(), resolved_at = now(),
           check_done_at = case when v_checking then now() else check_done_at end,
           check_note = case when v_checking then 'Decided by you before the check finished: it was sent.' else check_note end
     where id = o.id;
    perform public.commission_pay_settle(o.id, v_trx, null);
  elsif o.status = 'unsure' or v_checking then
    update public.commission_pays set status = 'failed', resolved_by = auth.uid(), resolved_at = now(),
           check_done_at = case when v_checking then now() else check_done_at end,
           check_note = case when v_checking then 'Decided by you before the check finished: it was NOT sent.' else check_note end
     where id = o.id;
    update public.commission_pay_days set live = false where pay_id = o.id;
  elsif o.status = 'paid' and o.method = 'manual' and not p_sent then
    update public.commission_pays set status = 'cancelled', resolved_by = auth.uid(), resolved_at = now() where id = o.id;
    update public.commission_pay_days set live = false where pay_id = o.id;
    update public.commission_payouts set voided_at = now() where pay_id = o.id and voided_at is null;
  else
    raise exception 'only an unsure payment, one still being checked, or one marked paid by hand, can be changed';
  end if;
  insert into public.events (kind, detail) values ('commission_pay_resolved', jsonb_build_object('pay_id', o.id, 'sent', p_sent, 'trx', v_trx, 'by', auth.uid(), 'while_checking', v_checking));
end $$;
revoke all on function public.resolve_commission_pay(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_commission_pay(uuid, boolean, text) to authenticated;
