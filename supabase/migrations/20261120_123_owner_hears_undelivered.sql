-- 123: the owner gets the message even when the person could not (owner 2026-11-20: "owner gets the message even if
-- they don't"). One helper writes the owner's copy for every outcome: sent privately ("📋 sent privately to @x"), or not
-- sent ("⚠️ NOT sent to @x: has not opened the bot / blocked the bot"), always with the full private text.
create or replace function public.tg_owner_copy(p_of uuid, p_header text) returns void language plpgsql security definer set search_path = public as $$
declare o public.telegram_outbox; s public.telegram_settings;
begin
  select * into o from public.telegram_outbox where id = p_of;
  if o.id is null or o.copy_of is not null then return; end if;
  select * into s from public.telegram_settings where id;
  if s.owner_chat_id is null or not coalesce(s.owner_copy, true) then return; end if;
  if o.dm_chat_id is not null and o.dm_chat_id = s.owner_chat_id then return; end if;
  if exists (select 1 from public.telegram_outbox where copy_of = p_of) then return; end if;
  insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text, copy_of)
  values (s.owner_chat_id, null, o.tg_user_id, 'payout_paid', left(p_header || E'\n\n' || coalesce(o.dm_text, o.text), 1000), null, null, null, p_of);
end $$;
revoke all on function public.tg_owner_copy(uuid, text) from public, anon, authenticated;
grant execute on function public.tg_owner_copy(uuid, text) to service_role;

create or replace function public.tg_who(p_user bigint) returns text language sql stable security definer set search_path = public as $$
  select case when nullif(trim(u.username), '') is not null then '@' || trim(u.username) else coalesce(nullif(trim(u.name), ''), 'user ' || p_user) end
    from public.telegram_users u where u.tg_user_id = p_user;
$$;
revoke all on function public.tg_who(bigint) from public, anon, authenticated;
grant execute on function public.tg_who(bigint) to service_role;

-- Sent privately: the copy as before, through the helper.
create or replace function public.tg_outbox_done2(p_id uuid, p_ok boolean, p_error text, p_message_id bigint, p_where text, p_dm_error text, p_dm_refused boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o public.telegram_outbox; v_who text;
begin
  update public.telegram_outbox
     set tries = tries + 1,
         status = case when p_ok then 'sent' when tries + 1 >= 3 then 'failed' else status end,
         sent_at = case when p_ok then now() else sent_at end,
         sent_where = case when p_ok and p_where in ('private', 'group') then p_where else sent_where end,
         tg_message_id = case when p_ok then p_message_id else tg_message_id end,
         error = case when p_ok then null else left(coalesce(p_error, 'failed'), 200) end,
         dm_error = coalesce(left(p_dm_error, 200), dm_error),
         dm_chat_id = case when coalesce(p_dm_refused, false) then null else dm_chat_id end
   where id = p_id returning * into o;
  if coalesce(p_dm_refused, false) and o.tg_user_id is not null then
    update public.telegram_users set dm_blocked_at = now(), dm_blocked_why = left(coalesce(p_dm_error, 'refused'), 120) where tg_user_id = o.tg_user_id;
  end if;
  v_who := coalesce(public.tg_who(o.tg_user_id), 'user ' || coalesce(o.tg_user_id::text, '?'));
  if p_ok and p_where = 'private' and o.copy_of is null then
    perform public.tg_owner_copy(o.id, '📋 ' || v_who || ' কে ব্যক্তিগতভাবে পাঠানো হয়েছে / sent privately to ' || v_who || ':');
  elsif p_ok and p_where = 'group' and o.copy_of is null then
    perform public.tg_owner_copy(o.id, '📋 ' || v_who || ' কে গ্রুপে পাঠানো হয়েছে (ব্যক্তিগত চ্যাট নেই) / sent in the GROUP to ' || v_who || ' (no private chat):');
  end if;
end $$;

-- Refused at send time (group off): failed, and the owner hears it.
create or replace function public.tg_outbox_skip(p_id uuid, p_error text, p_dm_refused boolean) returns void language plpgsql security definer set search_path = public as $$
declare o public.telegram_outbox; v_who text;
begin
  update public.telegram_outbox set status = 'failed', tries = tries + 1, error = left(coalesce(p_error, 'not sent'), 200), dm_error = left(p_error, 200),
         dm_chat_id = case when coalesce(p_dm_refused, false) then null else dm_chat_id end
   where id = p_id returning * into o;
  if coalesce(p_dm_refused, false) and o.tg_user_id is not null then
    update public.telegram_users set dm_blocked_at = now(), dm_blocked_why = left(coalesce(p_error, 'refused'), 120) where tg_user_id = o.tg_user_id;
  end if;
  v_who := coalesce(public.tg_who(o.tg_user_id), 'user ' || coalesce(o.tg_user_id::text, '?'));
  perform public.tg_owner_copy(o.id, '⚠️ ' || v_who || ' কে পাঠানো যায়নি (বট ব্লক করেছে বা খোলেনি) / NOT sent to ' || v_who || ' (Telegram refused the private chat):');
end $$;

-- Not sent at once (no private chat, group off): the notice function now also tells the owner.
create or replace function public.tg_payout_paid_notice(p_payout uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  s public.telegram_settings; p public.payouts; u public.telegram_users;
  v_user bigint; v_reply bigint; v_who text; v_num text; v_trxs text; v_n int; v_text text; v_dm text; v_amount text; v_dm_chat bigint; v_row uuid;
begin
  select * into s from public.telegram_settings where id limit 1;
  if s.group_chat_id is null or not coalesce(s.payout_reply, true) then return; end if;
  select * into p from public.payouts where id = p_payout;
  if p.id is null or p.status <> 'paid' or coalesce(p.error, '') = 'paid_twice' or coalesce(p.extra, false) then return; end if;
  v_user := public.tg_payout_person(p_payout);
  if v_user is null then return; end if;
  select * into u from public.telegram_users where tg_user_id = v_user;
  v_who := case when nullif(trim(u.username), '') is not null then '@' || trim(u.username) else coalesce(nullif(trim(u.name), ''), 'user ' || v_user) end;
  v_num := case when p.to_number is null then null else public.mask_bd_number(p.to_number) end;
  v_amount := to_char(p.send_amount, 'FM999,999,990');
  select string_agg(pay.trx_id, ', ' order by pay.occurred_at), count(*) into v_trxs, v_n
    from public.payout_items i join public.payments pay on pay.id = i.payment_id where i.payout_id = p_payout;
  select c.message_id into v_reply from public.telegram_claims c
   where c.chat_id = s.group_chat_id and c.tg_user_id = v_user
     and c.payment_id in (select payment_id from public.payout_items where payout_id = p_payout)
   order by c.sent_at desc limit 1;
  if v_reply is null then
    select c.message_id into v_reply from public.telegram_claims c where c.chat_id = s.group_chat_id and c.tg_user_id = v_user order by c.sent_at desc limit 1;
  end if;
  v_text := '✅ ' || v_who || ', পেমেন্ট পাঠানো হয়েছে: Tk ' || v_amount
         || case when v_num is not null then ' → ' || v_num else '' end
         || case when p.trx_id is not null then ' (TrxID ' || p.trx_id || ')' else '' end || '।'
         || case when v_n > 0 and v_n <= 6 then E'\nলেনদেন: ' || v_trxs when v_n > 6 then E'\n' || v_n || ' টি লেনদেন' else '' end
         || E'\nPaid: Tk ' || v_amount || case when v_num is not null then ' sent to ' || v_num else '' end
         || case when p.trx_id is not null then ', TrxID ' || p.trx_id else '' end || '.';
  v_dm := '✅ আপনার পেমেন্ট পাঠানো হয়েছে: Tk ' || v_amount
         || case when p.to_number is not null then ' → ' || p.to_number else '' end
         || case when p.trx_id is not null then ' (TrxID ' || p.trx_id || ')' else '' end || '।'
         || case when v_n > 0 and v_n <= 6 then E'\nলেনদেন: ' || v_trxs when v_n > 6 then E'\n' || v_n || ' টি লেনদেন' else '' end
         || E'\nYour payment was sent: Tk ' || v_amount || case when p.to_number is not null then ' to ' || p.to_number else '' end
         || case when p.trx_id is not null then ', TrxID ' || p.trx_id else '' end || '.';
  v_dm_chat := case when u.dm_chat_id is not null and u.dm_blocked_at is null then u.dm_chat_id end;
  if v_dm_chat is null and not coalesce(s.payout_group_fallback, false) then
    insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text, status, tries, error)
    values (s.group_chat_id, v_reply, v_user, 'payout_paid', left(v_text, 1000), p_payout, null, left(v_dm, 1000), 'failed', 0,
            case when u.dm_blocked_at is not null then 'not sent: the person blocked the bot (group replies are off)' else 'not sent: the person has not opened the bot (group replies are off)' end)
    on conflict (payout_id) where payout_id is not null do nothing
    returning id into v_row;
    if v_row is not null then
      perform public.tg_owner_copy(v_row, case when u.dm_blocked_at is not null
        then '⚠️ ' || v_who || ' কে পাঠানো যায়নি (বট ব্লক করেছে) / NOT sent to ' || v_who || ' (they blocked the bot):'
        else '⚠️ ' || v_who || ' কে পাঠানো যায়নি (বট এখনো খোলেনি) / NOT sent to ' || v_who || ' (they have not opened the bot yet):' end);
    end if;
    return;
  end if;
  insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text)
  values (s.group_chat_id, v_reply, v_user, 'payout_paid', left(v_text, 1000), p_payout, v_dm_chat, left(v_dm, 1000))
  on conflict (payout_id) where payout_id is not null do nothing;
end $$;
