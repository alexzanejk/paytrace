-- 121: a copy of every PRIVATE notice to the owner (owner 2026-11-20: "copy private notices to me so I know what message
-- they received, I'm the group owner"). A bot's private chats cannot be read by anyone, so the owner gets the same text,
-- at the same moment, in their OWN chat with the bot.
-- Pairing is by a one-time code, never by picking a name (a wrong pick would send full numbers to a stranger): the
-- dashboard makes a 6-digit code (tg_owner_code, 10 minutes), the owner sends "/owner <code>" to the bot in a private
-- chat, the function calls tg_owner_claim, and that chat becomes the owner's. Switch: telegram_settings.owner_copy.
alter table public.telegram_settings add column if not exists owner_chat_id bigint;
alter table public.telegram_settings add column if not exists owner_user_id bigint;
alter table public.telegram_settings add column if not exists owner_set_at timestamptz;
alter table public.telegram_settings add column if not exists owner_copy boolean not null default true;
alter table public.telegram_settings add column if not exists owner_code text;
alter table public.telegram_settings add column if not exists owner_code_at timestamptz;

alter table public.telegram_outbox add column if not exists copy_of uuid references public.telegram_outbox(id);

create or replace function public.tg_owner_code() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := lpad((floor(random() * 1000000))::int::text, 6, '0'); s public.telegram_settings;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_settings set owner_code = v_code, owner_code_at = now(), updated_at = now() where id returning * into s;
  insert into public.events (kind, detail) values ('telegram_owner_code', jsonb_build_object('by', auth.uid()));
  return jsonb_build_object('code', v_code, 'bot', s.bot_username, 'valid_minutes', 10);
end $$;
grant execute on function public.tg_owner_code() to authenticated;

-- The bot's side: a private message "/owner <code>". Returns {claimed, why}.
create or replace function public.tg_owner_claim(p_user_id bigint, p_chat_id bigint, p_text text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.telegram_settings; v_code text;
begin
  v_code := (regexp_match(trim(coalesce(p_text, '')), '^/owner\s+(\d{6})\s*$'))[1];
  if v_code is null then return jsonb_build_object('claimed', false, 'why', 'no_code'); end if;
  select * into s from public.telegram_settings where id;
  if s.owner_code is null or s.owner_code_at is null or s.owner_code_at < now() - interval '10 minutes' then
    return jsonb_build_object('claimed', false, 'why', 'expired');
  end if;
  if s.owner_code <> v_code then return jsonb_build_object('claimed', false, 'why', 'wrong'); end if;
  update public.telegram_settings
     set owner_chat_id = p_chat_id, owner_user_id = p_user_id, owner_set_at = now(), owner_code = null, owner_code_at = null, updated_at = now()
   where id;
  insert into public.events (kind, detail) values ('telegram_owner_set', jsonb_build_object('tg_user_id', p_user_id));
  return jsonb_build_object('claimed', true);
end $$;
revoke all on function public.tg_owner_claim(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.tg_owner_claim(bigint, bigint, text) to service_role;

create or replace function public.tg_set_owner_copy(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_settings set owner_copy = coalesce(p_on, true), updated_at = now() where id;
  insert into public.events (kind, detail) values ('telegram_owner_copy_set', jsonb_build_object('on', p_on, 'by', auth.uid()));
end $$;
grant execute on function public.tg_set_owner_copy(boolean) to authenticated;

create or replace function public.tg_clear_owner() returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_settings set owner_chat_id = null, owner_user_id = null, owner_set_at = null, owner_code = null, owner_code_at = null, updated_at = now() where id;
  insert into public.events (kind, detail) values ('telegram_owner_cleared', jsonb_build_object('by', auth.uid()));
end $$;
grant execute on function public.tg_clear_owner() to authenticated;

-- The mark that a notice was sent, now also: a private one is copied to the owner's chat (one more outbox row, sent by
-- the same drain; never a copy of a copy; never when the owner IS the person).
create or replace function public.tg_outbox_done2(p_id uuid, p_ok boolean, p_error text, p_message_id bigint, p_where text, p_dm_error text, p_dm_refused boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o public.telegram_outbox; s public.telegram_settings; u public.telegram_users; v_who text;
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
  if p_ok and p_where = 'private' and o.copy_of is null then
    select * into s from public.telegram_settings where id;
    if s.owner_chat_id is not null and coalesce(s.owner_copy, true) and s.owner_chat_id <> o.dm_chat_id then
      select * into u from public.telegram_users where tg_user_id = o.tg_user_id;
      v_who := case when nullif(trim(u.username), '') is not null then '@' || trim(u.username) else coalesce(nullif(trim(u.name), ''), 'user ' || coalesce(o.tg_user_id::text, '?')) end;
      insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id, dm_chat_id, dm_text, copy_of)
      values (s.owner_chat_id, null, o.tg_user_id, 'payout_paid',
              left('📋 ' || v_who || ' কে ব্যক্তিগতভাবে পাঠানো হয়েছে / sent privately to ' || v_who || ':' || E'\n\n' || coalesce(o.dm_text, o.text), 1000),
              null, null, null, o.id);
    end if;
  end if;
end $$;

-- A person's timeline lists the notice to them, not the owner's copy of it.
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
        from public.telegram_outbox o where o.tg_user_id = p_user and o.created_at >= p_from and o.copy_of is null
    ) x
    where public.is_admin()
    limit 400
  ) y;
$$;
grant execute on function public.tg_person_history(bigint, timestamptz) to authenticated;
