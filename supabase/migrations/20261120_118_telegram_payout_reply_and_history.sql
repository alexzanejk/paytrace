-- 118: step 5 of the Telegram plan (owner 2026-11-20: "step 5 with payout sent reply").
-- (1) A "payout sent" reply in the group: when a payout tied to a Telegram person becomes PAID, one message is queued in
--     telegram_outbox (reply to the person's own post when there is one) with the amount, the MASKED number and the
--     TrxID; the telegram function sends it (after every update, and a pg_cron tick once a minute while rows wait).
--     Switch: telegram_settings.payout_reply (default ON, the owner asked for it). Never for a paid_twice row, never for
--     an "extra" by-hand record (no person), never when the payout's transactions name more than one person.
-- (2) tg_person_history(user, from): everything about one person on one timeline (posts, matches, replies, queued
--     payouts, payouts paid) for the dashboard's History button and its CSV.
alter table public.telegram_settings add column if not exists payout_reply boolean not null default true;

create or replace function public.tg_set_payout_reply(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_settings set payout_reply = coalesce(p_on, true), updated_at = now() where id;
  insert into public.events (kind, detail) values ('telegram_payout_reply_set', jsonb_build_object('on', p_on, 'by', auth.uid()));
end $$;
grant execute on function public.tg_set_payout_reply(boolean) to authenticated;

create table if not exists public.telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  reply_to bigint,
  tg_user_id bigint,
  kind text not null check (kind in ('payout_paid')),
  text text not null,
  payout_id uuid references public.payouts(id),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  tries int not null default 0,
  error text,
  tg_message_id bigint,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists telegram_outbox_one_per_payout on public.telegram_outbox (payout_id) where payout_id is not null;
create index if not exists telegram_outbox_queued_idx on public.telegram_outbox (created_at) where status = 'queued';
alter table public.telegram_outbox enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'telegram_outbox' and policyname = 'telegram_outbox_admin_read') then
    create policy telegram_outbox_admin_read on public.telegram_outbox for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.telegram_outbox to authenticated;

-- The person a payout belongs to: the plan it came from (step 4), else the one Telegram person its transactions are
-- named for. Null when nobody, or more than one.
create or replace function public.tg_payout_person(p_payout uuid) returns bigint language sql stable security definer set search_path = public as $$
  with by_plan as (select tg_user_id from public.payout_plans where payout_id = p_payout and tg_user_id is not null limit 1),
  by_name as (
    select n.tg_user_id from public.payout_items i join public.payment_names n on n.payment_id = i.payment_id
     where i.payout_id = p_payout and n.tg_user_id is not null group by n.tg_user_id)
  select coalesce((select tg_user_id from by_plan),
                  case when (select count(*) from by_name) = 1 then (select tg_user_id from by_name) end);
$$;
revoke all on function public.tg_payout_person(uuid) from public, anon, authenticated;
grant execute on function public.tg_payout_person(uuid) to service_role;

-- Queue the "payout sent" reply for a PAID payout. Safe to call twice (one row per payout).
create or replace function public.tg_payout_paid_notice(p_payout uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  s public.telegram_settings; p public.payouts; u public.telegram_users;
  v_user bigint; v_reply bigint; v_who text; v_num text; v_trxs text; v_n int; v_text text;
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
  select string_agg(pay.trx_id, ', ' order by pay.occurred_at), count(*) into v_trxs, v_n
    from public.payout_items i join public.payments pay on pay.id = i.payment_id where i.payout_id = p_payout;
  -- Reply to the person's own post about one of these transactions when there is one, else their newest post.
  select c.message_id into v_reply from public.telegram_claims c
   where c.chat_id = s.group_chat_id and c.tg_user_id = v_user
     and c.payment_id in (select payment_id from public.payout_items where payout_id = p_payout)
   order by c.sent_at desc limit 1;
  if v_reply is null then
    select c.message_id into v_reply from public.telegram_claims c where c.chat_id = s.group_chat_id and c.tg_user_id = v_user order by c.sent_at desc limit 1;
  end if;
  v_text := '✅ ' || v_who || ', পেমেন্ট পাঠানো হয়েছে: Tk ' || to_char(p.send_amount, 'FM999,999,990')
         || case when v_num is not null then ' → ' || v_num else '' end
         || case when p.trx_id is not null then ' (TrxID ' || p.trx_id || ')' else '' end || '।'
         || case when v_n > 0 and v_n <= 6 then E'\nলেনদেন: ' || v_trxs when v_n > 6 then E'\n' || v_n || ' টি লেনদেন' else '' end
         || E'\nPaid: Tk ' || to_char(p.send_amount, 'FM999,999,990') || case when v_num is not null then ' sent to ' || v_num else '' end
         || case when p.trx_id is not null then ', TrxID ' || p.trx_id else '' end || '.';
  insert into public.telegram_outbox (chat_id, reply_to, tg_user_id, kind, text, payout_id)
  values (s.group_chat_id, v_reply, v_user, 'payout_paid', left(v_text, 1000), p_payout)
  on conflict (payout_id) where payout_id is not null do nothing;
end $$;
revoke all on function public.tg_payout_paid_notice(uuid) from public, anon, authenticated;
grant execute on function public.tg_payout_paid_notice(uuid) to service_role;

create or replace function public.payouts_tg_notice() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    begin perform public.tg_payout_paid_notice(new.id); exception when others then
      insert into public.events (kind, detail) values ('telegram_payout_notice_failed', jsonb_build_object('payout_id', new.id, 'error', left(sqlerrm, 200)));
    end;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'zz_payouts_tg_notice') then
    create trigger zz_payouts_tg_notice after insert or update of status on public.payouts for each row execute function public.payouts_tg_notice();
  end if;
end $$;

-- The function's queue: next rows to send, and the mark that one was sent (or given up on after 3 tries).
create or replace function public.tg_outbox_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, reply_to bigint, text text) language sql security definer set search_path = public as $$
  select o.id, o.chat_id, o.reply_to, o.text from public.telegram_outbox o
   where o.status = 'queued' and o.tries < 3 order by o.created_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_outbox_next(int) from public, anon, authenticated;
grant execute on function public.tg_outbox_next(int) to service_role;

create or replace function public.tg_outbox_done(p_id uuid, p_ok boolean, p_error text default null, p_message_id bigint default null) returns void language sql security definer set search_path = public as $$
  update public.telegram_outbox
     set tries = tries + 1,
         status = case when p_ok then 'sent' when tries + 1 >= 3 then 'failed' else status end,
         sent_at = case when p_ok then now() else sent_at end,
         tg_message_id = case when p_ok then p_message_id else tg_message_id end,
         error = case when p_ok then null else left(coalesce(p_error, 'failed'), 200) end
   where id = p_id;
$$;
revoke all on function public.tg_outbox_done(uuid, boolean, text, bigint) from public, anon, authenticated;
grant execute on function public.tg_outbox_done(uuid, boolean, text, bigint) to service_role;

-- One person's timeline for the dashboard (newest first, at most 400 events).
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
      select jsonb_build_object('at', coalesce(o.sent_at, o.created_at), 'kind', 'reply', 'status', o.status, 'detail', o.text, 'id', o.id)
        from public.telegram_outbox o where o.tg_user_id = p_user and o.created_at >= p_from
    ) x
    where public.is_admin()
    limit 400
  ) y;
$$;
grant execute on function public.tg_person_history(bigint, timestamptz) to authenticated;

-- Once a minute while a reply waits (no call when nothing is queued): the telegram function drains the outbox.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'paytrace-telegram-outbox') then
    perform cron.schedule('paytrace-telegram-outbox', '* * * * *',
      $cron$select net.http_post(url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/telegram', headers := '{"content-type":"application/json"}'::jsonb, body := '{"action":"drain"}'::jsonb)
            where exists (select 1 from public.telegram_outbox where status = 'queued' and tries < 3)$cron$);
  end if;
end $$;
