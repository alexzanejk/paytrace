-- 113: Telegram claims, the owner's rule stated plainly (2026-11-20): read each screenshot, find the TrxID, see if it is
-- in the Payout list as NOT PAID YET; if it is, tie it to the person (their site username from what they typed in the
-- group, else their Telegram profile) and REACT to that post with a thumbs-up so the owner sees the bot handled it; if
-- not found, already paid, or unclear, do nothing: no reaction, no reply. Text replies stay possible but are OFF.
--
-- Changes from 112: a new claim state 'paid' (the transaction is already in a live payout), `react_pending`/`reacted_at`
-- (the bot's thumbs-up, sent by the telegram function), `site_username_seen` (the site login typed in that message),
-- `tg_site_username(text)`, a re-judge when a payout takes a transaction, and `tg_claim_judge2` (returns void: a function's
-- return type cannot change, and the claims table had to be re-created to widen its status check, which cannot be done
-- in place without DROP). The 112 table was empty; it is kept as telegram_claims_v1.

alter table public.telegram_claims rename to telegram_claims_v1;

create table public.telegram_claims (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  message_id bigint not null,
  media_group_id text,
  tg_user_id bigint not null references public.telegram_users (tg_user_id),
  kind text not null check (kind in ('photo', 'text')),
  file_id text,
  file_unique_id text,
  text text,
  sent_at timestamptz not null,
  ocr_status text not null default 'none' check (ocr_status in ('none', 'pending', 'done', 'failed')),
  ocr_text text,
  ocr_at timestamptz,
  ocr_tries int not null default 0,
  ocr_taken_at timestamptz,
  candidates text[] not null default '{}',
  payment_id uuid references public.payments (id),
  matched_how text check (matched_how in ('exact', 'normalized', 'one_off', 'owner')),
  matched_at timestamptz,
  -- new: a photo not yet read; unmatched: no TrxID of ours; matched: a counted transaction NOT yet paid out; paid: already
  -- in a live payout; held: held for review in PayTrace; duplicate / conflict: the same TrxID claimed before by the same /
  -- another person; review: the owner has to look; ignored: dismissed by the owner.
  status text not null default 'new' check (status in ('new', 'unmatched', 'matched', 'paid', 'held', 'duplicate', 'conflict', 'review', 'ignored')),
  first_claim_id uuid references public.telegram_claims (id),
  site_username_seen text,
  react_pending boolean not null default false,
  reacted_at timestamptz,
  note text,
  replied_at timestamptz,
  reply_kind text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chat_id, message_id)
);
create index telegram_claims2_payment_idx on public.telegram_claims (payment_id) where payment_id is not null;
create index telegram_claims2_user_idx on public.telegram_claims (tg_user_id, sent_at desc);
create index telegram_claims2_status_idx on public.telegram_claims (status, sent_at desc);
create index telegram_claims2_ocr_idx on public.telegram_claims (sent_at) where ocr_status = 'pending';
create index telegram_claims2_react_idx on public.telegram_claims (sent_at) where react_pending;
alter table public.telegram_claims enable row level security;
create policy telegram_claims2_admin_read on public.telegram_claims for select to authenticated using (public.is_admin());
grant select on public.telegram_claims to authenticated;

-- Text replies are off by default now: the thumbs-up is the bot's only word unless the owner chooses otherwise.
update public.telegram_settings set reply_mode = 'off', updated_at = now() where id;

-- The site login a person types in the group ("t9ceff6182"): a lower-case word of 5 to 24 letters/digits/_ with at least
-- one letter and one digit, as typed, not an @handle (a TrxID in a screenshot is upper case; a typed TrxID that matched is
-- excluded by the caller).
create or replace function public.tg_site_username(p text) returns text language sql immutable as $$
  select m[1] from regexp_matches(coalesce(p, ''), '(?<![A-Za-z0-9_@])([a-z0-9_]{5,24})(?![A-Za-z0-9_])', 'g') m
  where m[1] ~ '[a-z]' and m[1] ~ '[0-9]'
  limit 1;
$$;

-- ---------- judging a claim (the rule above) ----------
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
begin
  select * into c from public.telegram_claims where id = p_claim for update;
  if not found then return; end if;
  -- The owner's own decisions stand.
  if c.status = 'ignored' then return; end if;
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
      payment_id = null, matched_how = null, matched_at = null, first_claim_id = null, react_pending = false where id = c.id;
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
  update public.telegram_claims
     set candidates = cands, site_username_seen = coalesce(site, site_username_seen),
         payment_id = f.payment_id, matched_how = coalesce(c.matched_how, f.how), matched_at = coalesce(matched_at, now()),
         status = st, note = note_, first_claim_id = earlier.id,
         -- The thumbs-up: once, for a match, never for anything else.
         react_pending = (st = 'matched' and reacted_at is null)
   where id = c.id;
end $$;
revoke all on function public.tg_claim_judge2(uuid) from public, anon, authenticated;
grant execute on function public.tg_claim_judge2(uuid) to service_role;

create or replace function public.tg_claim_brief(p_claim uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'kind', c.kind, 'note', c.note, 'candidates', c.candidates, 'ocr_status', c.ocr_status,
    'tg_user_id', c.tg_user_id, 'username', u.username, 'name', u.name, 'site_username', u.site_username, 'site_username_seen', c.site_username_seen,
    'chat_id', c.chat_id, 'message_id', c.message_id, 'sent_at', c.sent_at, 'reacted', c.reacted_at is not null, 'react_pending', c.react_pending,
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

create or replace function public.tg_claim_add(
  p_chat_id bigint, p_chat_title text, p_chat_kind text,
  p_message_id bigint, p_media_group text,
  p_user_id bigint, p_username text, p_name text,
  p_kind text, p_file_id text, p_file_unique_id text, p_text text, p_sent_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.telegram_settings;
  c public.telegram_claims;
begin
  insert into public.telegram_chats (chat_id, title, kind, messages)
  values (p_chat_id, left(coalesce(p_chat_title, ''), 120), left(coalesce(p_chat_kind, ''), 20), 1)
  on conflict (chat_id) do update set title = excluded.title, kind = excluded.kind, last_seen_at = now(), messages = public.telegram_chats.messages + 1;
  select * into s from public.telegram_settings where id;
  if s.group_chat_id is null or s.group_chat_id <> p_chat_id then
    return jsonb_build_object('kept', false, 'why', case when s.group_chat_id is null then 'no group chosen' else 'not the chosen group' end);
  end if;
  if p_kind not in ('photo', 'text') then return jsonb_build_object('kept', false, 'why', 'not a photo or text'); end if;
  insert into public.telegram_users (tg_user_id, username, name, claims)
  values (p_user_id, nullif(left(coalesce(p_username, ''), 64), ''), nullif(left(coalesce(p_name, ''), 120), ''), 1)
  on conflict (tg_user_id) do update
    set username = coalesce(excluded.username, public.telegram_users.username), name = coalesce(excluded.name, public.telegram_users.name),
        last_seen_at = now(), claims = public.telegram_users.claims + 1;
  insert into public.telegram_claims (chat_id, message_id, media_group_id, tg_user_id, kind, file_id, file_unique_id, text, sent_at, ocr_status)
  values (p_chat_id, p_message_id, nullif(p_media_group, ''), p_user_id, p_kind, p_file_id, p_file_unique_id, nullif(left(regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f]', ' ', 'g'), 1000), ''),
          coalesce(p_sent_at, now()), case when p_kind = 'photo' then 'pending' else 'none' end)
  on conflict (chat_id, message_id) do nothing
  returning * into c;
  if c.id is null then
    select * into c from public.telegram_claims where chat_id = p_chat_id and message_id = p_message_id;
    return public.tg_claim_brief(c.id) || jsonb_build_object('kept', true, 'again', true);
  end if;
  perform public.tg_claim_judge2(c.id);
  return public.tg_claim_brief(c.id) || jsonb_build_object('kept', true);
end $$;

create or replace function public.tg_ocr_next(p_limit int default 5)
returns table (id uuid, file_id text, tries int) language plpgsql security definer set search_path = public as $$
begin
  return query
  with pick as (
    select c.id from public.telegram_claims c
     where c.kind = 'photo' and c.ocr_status = 'pending' and c.ocr_tries < 3
       and (c.ocr_taken_at is null or c.ocr_taken_at < now() - interval '10 minutes')
     order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked)
  update public.telegram_claims c set ocr_taken_at = now(), ocr_tries = c.ocr_tries + 1
    from pick where c.id = pick.id
  returning c.id, c.file_id, c.ocr_tries;
end $$;

create or replace function public.tg_ocr_done(p_claim uuid, p_text text, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.telegram_claims;
begin
  update public.telegram_claims
     set ocr_text = left(regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f]', ' ', 'g'), 4000),
         ocr_at = now(),
         ocr_status = case when p_ok then 'done' when ocr_tries >= 3 then 'failed' else 'pending' end,
         ocr_taken_at = case when p_ok or ocr_tries >= 3 then ocr_taken_at else null end
   where id = p_claim returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_claim'); end if;
  perform public.tg_claim_judge2(c.id);
  return public.tg_claim_brief(c.id) || jsonb_build_object('ok', true);
end $$;

create or replace function public.tg_claim_replied(p_claim uuid, p_kind text) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims set replied_at = now(), reply_kind = left(p_kind, 20) where id = p_claim;
$$;

-- The thumbs-ups still to send (oldest first) and the mark that one was sent (or given up on after 3 tries).
create or replace function public.tg_react_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, message_id bigint) language sql security definer set search_path = public as $$
  select c.id, c.chat_id, c.message_id from public.telegram_claims c
   where c.react_pending and c.reacted_at is null order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_react_next(int) from public, anon, authenticated;
grant execute on function public.tg_react_next(int) to service_role;

create or replace function public.tg_reacted(p_claim uuid, p_ok boolean) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims
     set reacted_at = case when p_ok then now() else reacted_at end,
         react_pending = case when p_ok then false else react_pending end,
         note = case when p_ok then note else coalesce(note || '; ', '') || 'thumbs-up could not be sent' end
   where id = p_claim;
$$;
revoke all on function public.tg_reacted(uuid, boolean) from public, anon, authenticated;
grant execute on function public.tg_reacted(uuid, boolean) to service_role;

create or replace function public.tg_claim_ignore(p_claim uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_claims set status = 'ignored', react_pending = false, note = nullif(left(coalesce(p_note, ''), 200), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
  insert into public.events (kind, provider, detail) values ('telegram_claim_ignored', null, jsonb_build_object('claim', p_claim, 'note', p_note, 'by', auth.uid()));
end $$;

-- The owner names the transaction a claim is for; the same rules (paid, duplicate, held) then apply, and a match reacts.
create or replace function public.tg_claim_pick(p_claim uuid, p_payment uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into pay from public.payments where id = p_payment;
  if not found then raise exception 'no such transaction'; end if;
  if pay.txn_type not in ('cash_out', 'send_money_received', 'payment_received') then raise exception 'not money that came in'; end if;
  update public.telegram_claims set payment_id = p_payment, matched_how = 'owner', status = 'review', reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
  perform public.tg_claim_judge2(p_claim);
  insert into public.events (kind, provider, detail) values ('telegram_claim_picked', pay.provider, jsonb_build_object('claim', p_claim, 'payment', p_payment, 'trx_id', pay.trx_id, 'by', auth.uid()));
  return public.tg_claim_brief(p_claim);
end $$;

create or replace function public.tg_claim_rejudge(p_claim uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  perform public.tg_claim_judge2(p_claim);
  return public.tg_claim_brief(p_claim);
end $$;

create or replace function public.tg_claims(p_from timestamptz, p_to timestamptz, p_status text default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.tg_claim_brief(c.id)
  from public.telegram_claims c
  where public.is_admin()
    and c.sent_at >= p_from and c.sent_at < p_to
    and (p_status is null or c.status = p_status)
  order by c.sent_at desc
  limit 500;
$$;

create or replace function public.tg_user_summary(p_from timestamptz)
returns table (tg_user_id bigint, username text, name text, site_username text, last_number text,
               matched int, matched_total numeric, held int, open int, conflicts int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with rows as (
    select c.tg_user_id, c.status, c.sent_at, p.amount
    from public.telegram_claims c
    left join public.payments p on p.id = c.payment_id
    where public.is_admin() and c.sent_at >= p_from)
  select u.tg_user_id, u.username, u.name, u.site_username, u.last_number,
         count(*) filter (where r.status = 'matched')::int as matched,
         coalesce(sum(r.amount) filter (where r.status = 'matched'), 0) as matched_total,
         count(*) filter (where r.status = 'held')::int as held,
         count(*) filter (where r.status in ('new', 'unmatched', 'review'))::int as open,
         count(*) filter (where r.status = 'conflict')::int as conflicts,
         max(r.sent_at) as last_at
  from rows r join public.telegram_users u on u.tg_user_id = r.tg_user_id
  group by u.tg_user_id, u.username, u.name, u.site_username, u.last_number
  order by matched_total desc, last_at desc;
$$;

-- A payment's status changed (a hold released): its claims follow.
create or replace function public.tg_follow_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is distinct from old.status then
    for r in select id from public.telegram_claims where payment_id = new.id and status in ('held', 'matched', 'review', 'paid') loop
      perform public.tg_claim_judge2(r.id);
    end loop;
  end if;
  return new;
exception when others then
  return new;
end $$;

-- A payout took (or freed) a transaction: its claims move between matched and paid.
create or replace function public.tg_follow_payout_item() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.telegram_claims where payment_id = new.payment_id and status in ('matched', 'paid', 'held', 'review') loop
    perform public.tg_claim_judge2(r.id);
  end loop;
  return new;
exception when others then
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'payout_items_telegram_follow') then
    create trigger payout_items_telegram_follow after insert or update of live on public.payout_items
      for each row execute function public.tg_follow_payout_item();
  end if;
end $$;
