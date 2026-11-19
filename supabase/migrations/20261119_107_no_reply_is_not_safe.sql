-- 107: "the phone did not answer within 3 minutes" is NOT "nothing was sent" (owner 2026-11-19, 8th paid-twice case).
-- phone_commands_tidy marked a running command failed with error 'timeout' after 3 minutes. 'timeout' is also the
-- phone's own word for "the PIN was never typed" and is a payout_safe_error (104), so a payout whose phone simply had
-- not answered yet was marked failed and its transactions freed. On 18 Nov a Tk 425 Cash In from the Realme (rubel)
-- went at 08:54 by the wallet's own clock, the server gave up at 08:57, the SMS arrived only at 09:10, and the
-- same transaction was paid again from the Xiaomi at 09:07.
-- Now the server's give-up is 'no_reply' (not safe: the payout becomes "unsure" and waits for the owner or the SMS),
-- and the SMS rescue also accepts the wallet's own time (occurred_at) inside the command's life, for an SMS that
-- arrives late.

create or replace function public.phone_commands_tidy(p_device uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.phone_commands
     set status = 'cancelled', finished_at = now(), error = 'expired'
   where device_id = p_device and status = 'queued' and created_at < now() - interval '10 minutes';
  update public.phone_commands
     set status = 'failed', finished_at = now(), error = 'no_reply'
   where device_id = p_device and status = 'running' and started_at < now() - interval '3 minutes';
end $$;

create or replace function public.payout_rescue_by_sms(p_payment uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p record; o record; v_method text; v_twice uuid;
begin
  select * into p from public.payments where id = p_payment;
  if not found or p.device_id is null or p.trx_id is null then return null; end if;
  v_method := case coalesce(p.review_reason, '') when 'cash_in_sent' then 'cash_in' when 'send_money_sent' then 'send_money' else null end;
  if v_method is null then return null; end if;
  -- An SMS that already belongs to a payout or a commission payment is that one's, never a second one's.
  if exists (select 1 from public.payouts where upper(trx_id) = upper(p.trx_id))
     or exists (select 1 from public.commission_pays where upper(trx_id) = upper(p.trx_id)) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  select po.id, c.error as cmd_error into o
    from public.payouts po join public.phone_commands c on c.id = po.command_id
   where po.method = v_method and po.status = 'failed' and po.trx_id is null
     and po.device_id = p.device_id and po.provider = p.provider and po.send_amount = p.amount
     and public.number_fits(po.to_number, p.counterparty)
     and (
       -- the SMS arrived while the command ran or within 3 minutes after
       (p.received_at >= c.created_at and p.received_at <= coalesce(c.finished_at, c.created_at) + interval '3 minutes')
       -- or the wallet's own time (to the minute) falls inside the command's life, however late the SMS came
       or (p.occurred_at >= date_trunc('minute', c.created_at) and p.occurred_at <= coalesce(c.finished_at, c.created_at) + interval '1 minute'
           and p.received_at <= coalesce(c.finished_at, c.created_at) + interval '2 hours')
     )
   order by po.created_at desc limit 1;
  if o.id is null then return null; end if;
  select x.payout_id into v_twice
    from public.payout_items i join public.payout_items x on x.payment_id = i.payment_id and x.live and x.payout_id <> i.payout_id
   where i.payout_id = o.id limit 1;
  if v_twice is null then
    update public.payout_items set live = true where payout_id = o.id;
    update public.payouts set status = 'paid', trx_id = left(p.trx_id, 24), balance_after = coalesce(balance_after, p.balance),
           paid_at = coalesce(paid_at, p.received_at), error = null where id = o.id;
    insert into public.events (kind, provider, detail, payment_id)
      values ('payout_rescued_by_sms', p.provider, jsonb_build_object('payout_id', o.id, 'phone_said', o.cmd_error), p.id);
  else
    update public.payouts set status = 'paid', trx_id = left(p.trx_id, 24), balance_after = coalesce(balance_after, p.balance),
           paid_at = coalesce(paid_at, p.received_at), error = 'paid_twice' where id = o.id;
    insert into public.events (kind, provider, detail, payment_id)
      values ('payout_paid_twice', p.provider, jsonb_build_object('payout_id', o.id, 'also_paid_by', v_twice, 'phone_said', o.cmd_error), p.id);
  end if;
  return o.id;
end $$;
revoke all on function public.payout_rescue_by_sms(uuid) from public, anon, authenticated;
grant execute on function public.payout_rescue_by_sms(uuid) to service_role;
