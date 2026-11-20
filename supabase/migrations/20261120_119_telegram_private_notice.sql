-- 119: the "payout sent" notice goes to the person's PRIVATE Telegram inbox first, the group reply is the fallback
-- (owner 2026-11-20: "yes private first, group fallback, full number").
-- Telegram's rule: a bot may write to a person privately only after that person opened the bot and pressed Start (or
-- sent it any message) once. So (1) every private message a person sends the bot is recorded here (tg_private_seen:
-- the private chat's id, which equals the person's id); (2) a notice for such a person carries a private text with the
-- FULL number (nobody else sees it) beside the group text with the hidden number; (3) the telegram function tries the
-- private chat first and, when Telegram refuses (never started the bot, blocked it), posts the group text as before and
-- remembers the refusal (dm_blocked_at) until the person writes to the bot again. Nothing about money changes.
alter table public.telegram_users add column if not exists dm_chat_id bigint;
alter table public.telegram_users add column if not exists dm_since timestamptz;
alter table public.telegram_users add column if not exists dm_blocked_at timestamptz;
alter table public.telegram_users add column if not exists dm_blocked_why text;

-- A private message from a person (the function calls it for every message in a private chat). Returns whether this is
-- the first time the person can be messaged privately (the function then sends a short welcome).
create or replace function public.tg_private_seen(p_user_id bigint, p_chat_id bigint, p_username text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  if p_user_id is null or p_chat_id is null then return jsonb_build_object('first', false); end if;
  -- First time = the person had no private chat recorded before this message.
  select (u.dm_since is null) into v_first from public.telegram_users u where u.tg_user_id = p_user_id;
  insert into public.telegram_users (tg_user_id, username, name, claims, dm_chat_id, dm_since)
  values (p_user_id, nullif(left(coalesce(p_username, ''), 64), ''), nullif(left(coalesce(p_name, ''), 120), ''), 0, p_chat_id, now())
  on conflict (tg_user_id) do update
    set username = coalesce(excluded.username, public.telegram_users.username), name = coalesce(excluded.name, public.telegram_users.name),
        last_seen_at = now(), dm_chat_id = excluded.dm_chat_id,
        dm_since = coalesce(public.telegram_users.dm_since, now()),
        dm_blocked_at = null, dm_blocked_why = null;
  return jsonb_build_object('first', coalesce(v_first, true));
end $$;
revoke all on function public.tg_private_seen(bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.tg_private_seen(bigint, bigint, text, text) to service_role;

alter table public.telegram_outbox add column if not exists dm_chat_id bigint;
alter table public.telegram_outbox add column if not exists dm_text text;
alter table public.telegram_outbox add column if not exists sent_where text check (sent_where in ('private', 'group'));
alter table public.telegram_outbox add column if not exists dm_error text;

-- Queue the "payout sent" notice for a PAID payout: a private text (full number) when the person can be messaged
-- privately, and the group text (hidden number) as the fallback. One row per payout, safe to call twice.
create or replace function public.tg_payout_paid_notice(p_payout uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  s public.telegram_settings; p public.payouts; u public.telegram_users;
  v_user bigint; v_reply bigint; v_who text; v_num text; v_trxs text; v_n int; v_text text; v_dm text; v_amount text;
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
  -- The group text: the number stays hidden, everyone in the group can read it.
  v_text := '✅ ' || v_who || ', পেমেন্ট পাঠানো হয়েছে: Tk ' || v_amount
         || case when v_num is not null then ' → ' || v_num else '' end
         || case when p.trx_id is not null then ' (TrxID ' || p.trx_id || ')' else '' end || '।'
         || case when v_n > 0 and v_n <= 6 then E'\nলেনদেন: ' || v_trxs when v_n > 6 then E'\n' || v_n || ' টি লেনদেন' else '' end
         || E'\nPaid: Tk ' || v_amount || case when v_num is not null then ' sent to ' || v_num else '' end
         || case when p.trx_id is not null then ', TrxID ' || p.trx_id else '' end || '.';
  -- The private text: the full number, only the person reads it.
  v_dm := '✅ আপনার পেমেন্ট পাঠানো হয়েছে: Tk ' || v_amount
         || case when p.to_number is not null then ' → ' || p.to_number else '' end
         || case when p.trx_id is not null then ' (TrxID ' || p.trx_id || ')' else '' end || '।'
         || case when v_n > 0 and v_n <= 6 then E'\nলেনদেন: ' || v_trxs when v_n > 6 then E'\n' || v_n || ' টি লেনদেন' else '' end
         || E'\nYour payment was sent: Tk ' || v_amount || case when p.to_number is not null then ' to ' || p.to_number else '' end
         || case when p.trx_id is not null then ', TrxID ' || p.trx_id else '' end || '.';
  insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text)
  values (s.group_chat_id, v_reply, v_user, 'payout_paid', left(v_text, 1000), p_payout,
          case when u.dm_chat_id is not null and u.dm_blocked_at is null then u.dm_chat_id end, left(v_dm, 1000))
  on conflict (payout_id) where payout_id is not null do nothing;
end $$;

-- The function's queue, now with the private way (a new name: a TABLE result cannot be widened in place).
create or replace function public.tg_outbox_next2(p_limit int default 5)
returns table (id uuid, chat_id bigint, reply_to bigint, text text, dm_chat_id bigint, dm_text text)
language sql security definer set search_path = public as $$
  select o.id, o.chat_id, o.reply_to, o.text, o.dm_chat_id, o.dm_text from public.telegram_outbox o
   where o.status = 'queued' and o.tries < 3 order by o.created_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_outbox_next2(int) from public, anon, authenticated;
grant execute on function public.tg_outbox_next2(int) to service_role;

-- The mark that one was sent (where), or refused. p_dm_refused = Telegram refused the private chat for a lasting reason
-- (never started the bot, blocked it): the person is not tried privately again until they write to the bot.
create or replace function public.tg_outbox_done2(p_id uuid, p_ok boolean, p_error text, p_message_id bigint, p_where text, p_dm_error text, p_dm_refused boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o public.telegram_outbox;
begin
  update public.telegram_outbox
     set tries = tries + 1,
         status = case when p_ok then 'sent' when tries + 1 >= 3 then 'failed' else status end,
         sent_at = case when p_ok then now() else sent_at end,
         sent_where = case when p_ok and p_where in ('private', 'group') then p_where else sent_where end,
         tg_message_id = case when p_ok then p_message_id else tg_message_id end,
         error = case when p_ok then null else left(coalesce(p_error, 'failed'), 200) end,
         dm_error = coalesce(left(p_dm_error, 200), dm_error),
         -- A refused private chat is not tried again on the next try of this row.
         dm_chat_id = case when coalesce(p_dm_refused, false) then null else dm_chat_id end
   where id = p_id returning * into o;
  if coalesce(p_dm_refused, false) and o.tg_user_id is not null then
    update public.telegram_users set dm_blocked_at = now(), dm_blocked_why = left(coalesce(p_dm_error, 'refused'), 120) where tg_user_id = o.tg_user_id;
  end if;
end $$;
revoke all on function public.tg_outbox_done2(uuid, boolean, text, bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.tg_outbox_done2(uuid, boolean, text, bigint, text, text, boolean) to service_role;

-- The person's timeline: a reply says where it went.
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
                                'detail', case when o.sent_where = 'private' then o.dm_text else o.text end, 'id', o.id)
        from public.telegram_outbox o where o.tg_user_id = p_user and o.created_at >= p_from
    ) x
    where public.is_admin()
    limit 400
  ) y;
$$;
grant execute on function public.tg_person_history(bigint, timestamptz) to authenticated;
