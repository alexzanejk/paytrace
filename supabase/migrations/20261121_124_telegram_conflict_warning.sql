-- 124: a thumbs-DOWN and a warning on a conflicting post (owner 2026-11-21: "reply to the second person and give a thumbs
-- down and tell him to remove it ... name them").
--
-- A CONFLICT is a post whose TrxID another person had already posted (tg_claim_judge2, migration 113). Until now such a
-- post got nothing (no reaction, no reply) and waited for the owner on the Telegram page. Now, while the switch
-- telegram_settings.conflict_warn is on (default ON):
--   (1) the later post gets a 👎 reaction (the same mechanism as the 👍 on a match: telegram_claims.react_pending, now
--       with react_kind up|down; the function sends the emoji the row names), and
--   (2) a reply under that post, in Bangla and English, naming the person who posted the TrxID first and asking the
--       poster to delete the post if it is not their transaction (warn_pending → the function sends it → warned_at,
--       warn_message_id; the words are built by the function from wording.ts, never typed by anyone).
--   (3) The owner's decision can go the other way: Ignore on the FIRST person's claim (the one that held the match)
--       re-judges the other claims on that transaction, so the second person's post becomes matched (👎 → 👍, and the
--       bot deletes its own warning under it), and the ignored first post gets the 👎 and a warning naming the person
--       the transaction was confirmed for (warn_swapped).
-- Nothing here touches money: a claim is only a statement by a stranger; payouts are a separate, human step.
-- The same person posting the same TrxID twice stays a DUPLICATE: no reaction, no reply, as before.

alter table public.telegram_settings add column if not exists conflict_warn boolean not null default true;

create or replace function public.tg_set_conflict_warn(p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_settings set conflict_warn = coalesce(p_on, true), updated_at = now() where id;
  insert into public.events (kind, detail) values ('telegram_conflict_warn_set', jsonb_build_object('on', p_on, 'by', auth.uid()));
end $$;
grant execute on function public.tg_set_conflict_warn(boolean) to authenticated;

alter table public.telegram_claims add column if not exists react_kind text not null default 'up' check (react_kind in ('up', 'down'));
alter table public.telegram_claims add column if not exists warn_pending boolean not null default false;
alter table public.telegram_claims add column if not exists warned_at timestamptz;
alter table public.telegram_claims add column if not exists warn_message_id bigint;
alter table public.telegram_claims add column if not exists warn_swapped boolean not null default false;
alter table public.telegram_claims add column if not exists unwarn_pending boolean not null default false;
create index if not exists telegram_claims_warn_idx on public.telegram_claims (sent_at) where warn_pending or unwarn_pending;

-- ---------- the judge (113's rule, plus the reaction kind and the warning) ----------
create or replace function public.tg_claim_judge2(p_claim uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.telegram_claims;
  f record;
  pay public.payments;
  earlier public.telegram_claims;
  cands text[];
  st text;
  note_ text;
  site text;
  paid boolean;
  v_warn boolean;
  v_kind text;
begin
  select * into c from public.telegram_claims where id = p_claim for update;
  if not found then return; end if;
  -- The owner's own decisions stand.
  if c.status = 'ignored' then return; end if;
  v_warn := coalesce((select conflict_warn from public.telegram_settings where id limit 1), true);
  cands := public.tg_trx_candidates(coalesce(c.text, '') || ' ' || coalesce(c.ocr_text, ''));
  site := public.tg_site_username(c.text);
  if c.matched_how = 'owner' then
    select c.payment_id as payment_id, 'owner'::text as how, false as ambiguous into f;
  else
    select * into f from public.tg_find_payment(cands) limit 1;
  end if;
  -- The site username typed in this message is remembered on the person (latest wins), unless it is the TrxID itself.
  if site is not null and (f.payment_id is null or upper(site) <> (select trx_id from public.payments where id = f.payment_id)) then
    update public.telegram_users set site_username = site where tg_user_id = c.tg_user_id;
  else
    site := null;
  end if;
  if f.payment_id is null then
    if f.ambiguous then
      st := 'review'; note_ := 'the read fits more than one transaction (' || f.how || ')';
    elsif c.kind = 'photo' and c.ocr_status in ('none', 'pending') then
      st := 'new'; note_ := null;
    else
      st := 'unmatched'; note_ := case when cardinality(cands) = 0 then 'no TrxID in it' else 'none of these is a transaction of ours: ' || array_to_string(cands, ', ') end;
    end if;
    update public.telegram_claims set candidates = cands, site_username_seen = coalesce(site, site_username_seen), status = st, note = note_,
      payment_id = null, matched_how = null, matched_at = null, first_claim_id = null, react_pending = false,
      warn_pending = false, unwarn_pending = (warn_message_id is not null)
     where id = c.id;
    return;
  end if;
  select * into pay from public.payments where id = f.payment_id;
  paid := exists (select 1 from public.payout_items i where i.payment_id = pay.id and i.live);
  select * into earlier from public.telegram_claims
   where payment_id = f.payment_id and id <> c.id and status not in ('duplicate', 'conflict', 'ignored', 'unmatched', 'new')
   order by sent_at, created_at limit 1;
  if earlier.id is not null then
    st := case when earlier.tg_user_id = c.tg_user_id then 'duplicate' else 'conflict' end;
    note_ := case when st = 'duplicate' then 'same person already submitted this TrxID' else 'another person submitted this TrxID first' end;
  elsif paid then
    st := 'paid'; note_ := 'already paid out';
  elsif pay.status = 'review' then
    st := 'held'; note_ := coalesce(pay.review_reason, 'held for review');
  elsif public.payment_counted(pay.status, pay.chain_status, pay.txn_type, pay.review_reason) then
    st := 'matched'; note_ := null;
  else
    st := 'review'; note_ := 'the transaction is ' || pay.status || coalesce(' (' || pay.review_reason || ')', '');
  end if;
  -- The reaction this state asks for: 👍 on a match, 👎 on a conflict (while the switch is on), nothing else.
  v_kind := case when st = 'matched' then 'up' when st = 'conflict' and v_warn then 'down' else null end;
  update public.telegram_claims
     set candidates = cands, site_username_seen = coalesce(site, site_username_seen),
         payment_id = f.payment_id, matched_how = coalesce(c.matched_how, f.how), matched_at = coalesce(matched_at, now()),
         status = st, note = note_, first_claim_id = earlier.id,
         -- A changed kind (👎 → 👍 after the owner's decision, or the reverse) is sent again; the same kind only once.
         react_kind = coalesce(v_kind, react_kind),
         react_pending = case when v_kind is null then false
                              when v_kind is distinct from react_kind then true
                              when reacted_at is null then true
                              else react_pending end,
         reacted_at = case when v_kind is not null and v_kind is distinct from react_kind then null else reacted_at end,
         -- The warning under a conflicting post, once; taken back (the bot deletes its own reply) when the post stops being a conflict.
         warn_pending = case when st = 'conflict' and v_warn and warned_at is null and warn_message_id is null then true
                             when st <> 'conflict' then false
                             else warn_pending end,
         warn_swapped = case when st = 'conflict' then false else warn_swapped end,
         unwarn_pending = case when st <> 'conflict' and warn_message_id is not null then true else unwarn_pending end
   where id = c.id;
end $$;
revoke all on function public.tg_claim_judge2(uuid) from public, anon, authenticated;
grant execute on function public.tg_claim_judge2(uuid) to service_role;

-- ---------- Ignore: the owner's decision can hand the transaction to the OTHER person ----------
create or replace function public.tg_claim_ignore(p_claim uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.telegram_claims;
  v_warn boolean;
  other record;
  n_other int := 0;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into c from public.telegram_claims where id = p_claim for update;
  if not found then return; end if;
  v_warn := coalesce((select conflict_warn from public.telegram_settings where id limit 1), true);
  update public.telegram_claims set status = 'ignored', react_pending = false, warn_pending = false,
         note = nullif(left(coalesce(p_note, ''), 200), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
  -- This claim held a transaction that other people also posted (a conflict): their claims are judged again, so the
  -- next person in line becomes the match (👎 → 👍, warning removed). The ignored post, if it had a reaction or stood
  -- first, is told the transaction was confirmed for someone else.
  if c.payment_id is not null and c.status in ('matched', 'paid', 'held', 'review', 'duplicate') then
    for other in
      select id from public.telegram_claims
       where payment_id = c.payment_id and id <> c.id and tg_user_id <> c.tg_user_id and status in ('conflict', 'duplicate', 'review')
       order by sent_at, created_at
    loop
      n_other := n_other + 1;
      perform public.tg_claim_judge2(other.id);
    end loop;
    if n_other > 0 and v_warn then
      update public.telegram_claims
         set react_kind = 'down', react_pending = true, reacted_at = null,
             warn_pending = (warn_message_id is null), warn_swapped = true, unwarn_pending = false
       where id = c.id;
    end if;
  end if;
  insert into public.events (kind, provider, detail) values ('telegram_claim_ignored', null,
    jsonb_build_object('claim', p_claim, 'note', p_note, 'by', auth.uid(), 'rejudged', n_other));
end $$;

-- ---------- what the function sends ----------
-- The reactions still to send, with the emoji each row asks for (a new name: the 113 function's columns cannot change).
create or replace function public.tg_react_next2(p_limit int default 5)
returns table (id uuid, chat_id bigint, message_id bigint, kind text) language sql security definer set search_path = public as $$
  select c.id, c.chat_id, c.message_id, c.react_kind from public.telegram_claims c
   where c.react_pending and c.reacted_at is null order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_react_next2(int) from public, anon, authenticated;
grant execute on function public.tg_react_next2(int) to service_role;

-- The warnings still to send: the post, the TrxID, and WHO the transaction belongs to (the first poster; after the
-- owner's swap, the person it was confirmed for). The function builds the words.
create or replace function public.tg_warn_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, message_id bigint, trx text, first_who text, swapped boolean)
language sql security definer set search_path = public as $$
  select c.id, c.chat_id, c.message_id, p.trx_id,
         coalesce(public.tg_who(coalesce(e.tg_user_id, o.tg_user_id)), 'someone else') as first_who, c.warn_swapped
    from public.telegram_claims c
    join public.payments p on p.id = c.payment_id
    left join public.telegram_claims e on e.id = c.first_claim_id and e.tg_user_id <> c.tg_user_id
    left join lateral (
      select x.tg_user_id from public.telegram_claims x
       where x.payment_id = c.payment_id and x.tg_user_id <> c.tg_user_id and x.status in ('matched', 'paid', 'held', 'review')
       order by x.sent_at, x.created_at limit 1) o on true
   where c.warn_pending
   order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_warn_next(int) from public, anon, authenticated;
grant execute on function public.tg_warn_next(int) to service_role;

create or replace function public.tg_warned(p_claim uuid, p_ok boolean, p_message_id bigint) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims
     set warn_pending = false,
         warned_at = case when p_ok then now() else warned_at end,
         warn_message_id = case when p_ok then p_message_id else warn_message_id end,
         note = case when p_ok then note else coalesce(note || '; ', '') || 'warning could not be sent' end
   where id = p_claim;
$$;
revoke all on function public.tg_warned(uuid, boolean, bigint) from public, anon, authenticated;
grant execute on function public.tg_warned(uuid, boolean, bigint) to service_role;

-- Warnings the bot should take back (its own reply under a post that is no longer a conflict).
create or replace function public.tg_unwarn_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, warn_message_id bigint) language sql security definer set search_path = public as $$
  select c.id, c.chat_id, c.warn_message_id from public.telegram_claims c
   where c.unwarn_pending and c.warn_message_id is not null order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_unwarn_next(int) from public, anon, authenticated;
grant execute on function public.tg_unwarn_next(int) to service_role;

-- Whether Telegram deleted it or refused (too old, already gone), the warning is forgotten so a later conflict can warn again.
create or replace function public.tg_unwarned(p_claim uuid) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims set unwarn_pending = false, warn_message_id = null, warned_at = null, warn_swapped = false where id = p_claim;
$$;
revoke all on function public.tg_unwarned(uuid) from public, anon, authenticated;
grant execute on function public.tg_unwarned(uuid) to service_role;

-- ---------- what the dashboard sees ----------
create or replace function public.tg_claim_brief(p_claim uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'kind', c.kind, 'note', c.note, 'candidates', c.candidates, 'ocr_status', c.ocr_status,
    'tg_user_id', c.tg_user_id, 'username', u.username, 'name', u.name, 'site_username', u.site_username, 'site_username_seen', c.site_username_seen,
    'chat_id', c.chat_id, 'message_id', c.message_id, 'sent_at', c.sent_at, 'reacted', c.reacted_at is not null, 'react_pending', c.react_pending,
    'react_kind', c.react_kind, 'warned', c.warned_at is not null, 'warn_pending', c.warn_pending, 'warn_swapped', c.warn_swapped,
    'payment', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'trx_id', p.trx_id, 'provider', p.provider, 'amount', p.amount, 'status', p.status, 'review_reason', p.review_reason,
      'counterparty', p.counterparty, 'occurred_at', p.occurred_at, 'phone', d.name,
      'paid_out', exists (select 1 from public.payout_items i where i.payment_id = p.id and i.live)) end,
    'first_claim', case when e.id is null then null else jsonb_build_object('id', e.id, 'tg_user_id', e.tg_user_id, 'username', eu.username, 'name', eu.name, 'sent_at', e.sent_at) end)
  from public.telegram_claims c
  join public.telegram_users u on u.tg_user_id = c.tg_user_id
  left join public.payments p on p.id = c.payment_id
  left join public.devices d on d.id = p.device_id
  left join public.telegram_claims e on e.id = c.first_claim_id
  left join public.telegram_users eu on eu.tg_user_id = e.tg_user_id
  where c.id = p_claim and (public.is_admin() or auth.role() = 'service_role');
$$;

create or replace function public.tg_person_history(p_user bigint, p_from timestamptz default now() - interval '30 days')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(e order by e->>'at' desc), '[]'::jsonb) from (
    select e from (
      select jsonb_build_object('at', c.sent_at, 'kind', 'post', 'status', c.status, 'trx', pay.trx_id, 'amount', pay.amount, 'provider', pay.provider,
                                'detail', c.note, 'message_id', c.message_id, 'photo', c.kind = 'photo', 'reacted', c.reacted_at is not null,
                                'react_kind', c.react_kind, 'warned', c.warned_at is not null, 'reply', c.reply_kind, 'id', c.id) e
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

-- The pg_cron tick also wakes the function while a reaction or a warning waits (before: only an outbox row).
do $$ begin
  perform cron.unschedule('paytrace-telegram-outbox');
  perform cron.schedule('paytrace-telegram-outbox', '* * * * *',
    $cron$select net.http_post(url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/telegram', headers := '{"content-type":"application/json"}'::jsonb, body := '{"action":"drain"}'::jsonb)
          where exists (select 1 from public.telegram_outbox where status = 'queued' and tries < 3)
             or exists (select 1 from public.telegram_claims where (react_pending and reacted_at is null) or warn_pending or unwarn_pending)$cron$);
end $$;

-- Today's open conflicts (the last 2 days) get the 👎 and the warning now, so the owner's own case is covered.
update public.telegram_claims
   set react_kind = 'down', react_pending = true, reacted_at = null, warn_pending = (warn_message_id is null)
 where status = 'conflict' and sent_at >= now() - interval '2 days'
   and coalesce((select conflict_warn from public.telegram_settings where id limit 1), true);
