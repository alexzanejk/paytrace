-- 122: the "payout sent" notice goes to the person's PRIVATE chat only; nothing in the group (owner 2026-11-20:
-- "don't send the message on the group, only private"). A person who has not opened the bot gets no notice, and the
-- History says so. The group fallback stays as a switch (telegram_settings.payout_group_fallback), OFF from now on.
alter table public.telegram_settings add column if not exists payout_group_fallback boolean not null default false;
update public.telegram_settings set payout_group_fallback = false where id;

create or replace function public.tg_set_group_fallback(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_settings set payout_group_fallback = coalesce(p_on, false), updated_at = now() where id;
  insert into public.events (kind, detail) values ('telegram_group_fallback_set', jsonb_build_object('on', p_on, 'by', auth.uid()));
end $$;
grant execute on function public.tg_set_group_fallback(boolean) to authenticated;

-- The notice: with the group fallback OFF, a person with no private chat gets a row marked failed at once (the History
-- shows why), nothing is sent anywhere; a person with a private chat gets the private text as before.
create or replace function public.tg_payout_paid_notice(p_payout uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  s public.telegram_settings; p public.payouts; u public.telegram_users;
  v_user bigint; v_reply bigint; v_who text; v_num text; v_trxs text; v_n int; v_text text; v_dm text; v_amount text; v_dm_chat bigint;
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
    -- Private only and no private chat: recorded as not sent, so the History says why; nothing goes to the group.
    insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text, status, tries, error)
    values (s.group_chat_id, v_reply, v_user, 'payout_paid', left(v_text, 1000), p_payout, null, left(v_dm, 1000), 'failed', 0,
            case when u.dm_blocked_at is not null then 'not sent: the person blocked the bot (group replies are off)' else 'not sent: the person has not opened the bot (group replies are off)' end)
    on conflict (payout_id) where payout_id is not null do nothing;
    return;
  end if;
  insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text)
  values (s.group_chat_id, v_reply, v_user, 'payout_paid', left(v_text, 1000), p_payout, v_dm_chat, left(v_dm, 1000))
  on conflict (payout_id) where payout_id is not null do nothing;
end $$;

-- The function's queue, now saying whether the group may be used when the private chat is refused.
create or replace function public.tg_outbox_next3(p_limit int default 5)
returns table (id uuid, chat_id bigint, reply_to bigint, text text, dm_chat_id bigint, dm_text text, group_ok boolean)
language sql security definer set search_path = public as $$
  select o.id, o.chat_id, o.reply_to, o.text, o.dm_chat_id, o.dm_text,
         -- a copy to the owner (copy_of set) is a plain message to the owner's chat, always allowed
         (o.copy_of is not null or coalesce((select payout_group_fallback from public.telegram_settings where id limit 1), false)) as group_ok
    from public.telegram_outbox o
   where o.status = 'queued' and o.tries < 3 order by o.created_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_outbox_next3(int) from public, anon, authenticated;
grant execute on function public.tg_outbox_next3(int) to service_role;

-- A row given up on at once (the private chat was refused and the group is off): failed, with the reason, no retries.
create or replace function public.tg_outbox_skip(p_id uuid, p_error text, p_dm_refused boolean) returns void language plpgsql security definer set search_path = public as $$
declare o public.telegram_outbox;
begin
  update public.telegram_outbox set status = 'failed', tries = tries + 1, error = left(coalesce(p_error, 'not sent'), 200), dm_error = left(p_error, 200),
         dm_chat_id = case when coalesce(p_dm_refused, false) then null else dm_chat_id end
   where id = p_id returning * into o;
  if coalesce(p_dm_refused, false) and o.tg_user_id is not null then
    update public.telegram_users set dm_blocked_at = now(), dm_blocked_why = left(coalesce(p_error, 'refused'), 120) where tg_user_id = o.tg_user_id;
  end if;
end $$;
revoke all on function public.tg_outbox_skip(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tg_outbox_skip(uuid, text, boolean) to service_role;

-- The person's timeline: a notice that was not sent shows the reason.
create or replace function public.tg_person_history(p_user bigint, p_from timestamptz default now() - interval '30 days')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(e order by e->>'at' desc), '[]'::jsonb) from (
    select e from (
      select jsonb_build_object('at', c.sent_at, 'kind', 'post', 'status', c.status, 'trx', pay.trx_id, 'amount', pay.amount, 'provider', pay.provider,
                                'detail', c.note, 'message_id', c.message_id, 'photo', c.kind = 'photo', 'reacted', c.reacted_at is not null, 'reply', c.reply_kind, 'id', c.id) e
        from public.telegram_claims c left join public.payments pay on pay.id = c.payment_id
       where c.tg_user_id = p_user and c.sent_at >= p_from
      union all
      select jsonb_build_object('at', pl.created_at, 'kind', 'plan_queued', 'status', pl.status, 'count', pl.count, 'amount', pl.total, 'to', pl.to_number, 'id', pl.id)
        from public.payout_plans pl where pl.tg_user_id = p_user and pl.created_at >= p_from
      union all
      select jsonb_build_object('at', pl.finished_at, 'kind', 'plan_' || pl.status, 'status', pl.status, 'count', pl.count, 'amount', pl.total, 'to', pl.to_number, 'detail', pl.error, 'id', pl.id)
        from public.payout_plans pl where pl.tg_user_id = p_user and pl.finished_at is not null and pl.finished_at >= p_from
      union all
      select jsonb_build_object('at', coalesce(p.paid_at, p.created_at), 'kind', 'payout', 'status', p.status, 'amount', p.send_amount, 'to', p.to_number, 'trx', p.trx_id,
                                'method', p.method, 'count', (select count(*) from public.payout_items i where i.payout_id = p.id), 'detail', p.error, 'id', p.id)
        from public.payouts p where p.created_at >= p_from and public.tg_payout_person(p.id) = p_user
      union all
      select jsonb_build_object('at', coalesce(o.sent_at, o.created_at), 'kind', 'reply', 'status', o.status, 'where', o.sent_where,
                                'detail', case when o.status = 'failed' then coalesce(o.error, 'not sent') when o.sent_where = 'private' then o.dm_text else o.text end, 'id', o.id)
        from public.telegram_outbox o where o.tg_user_id = p_user and o.created_at >= p_from and o.copy_of is null
    ) x
    where public.is_admin()
    limit 400
  ) y;
$$;
grant execute on function public.tg_person_history(bigint, timestamptz) to authenticated;
