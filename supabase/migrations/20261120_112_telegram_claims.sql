-- 112: Telegram payment-screenshot claims, step 2 (owner 2026-11-20: "STEP 2").
--
-- People post screenshots of their payment in the owner's Telegram group. A bot receives every message (the `telegram`
-- edge function), keeps who posted what, and an OCR worker on the owner's VPS reads the TrxID out of each photo. The
-- TrxID is then matched against PayTrace's OWN stored receipts: a screenshot never proves anything by itself, and a
-- TrxID PayTrace does not hold matches nothing. One TrxID = one claim; a second claim of the same TrxID by the same
-- person is a duplicate, by another person a conflict for the owner. NOTHING here moves money: a matched claim only
-- says which stored transaction a Telegram user says is theirs. Paying out stays the Payout page's job (step 4).

-- ---------- settings, chats, users ----------
create table if not exists public.telegram_settings (
  id boolean primary key default true check (id),
  group_chat_id bigint,
  group_title text,
  -- off = the bot never writes in the group; problems = only when something needs the poster (TrxID unreadable, held,
  -- already submitted); all = also a short "received" on every match.
  reply_mode text not null default 'problems' check (reply_mode in ('off', 'problems', 'all')),
  webhook_set_at timestamptz,
  bot_username text,
  updated_at timestamptz not null default now()
);
insert into public.telegram_settings (id) values (true) on conflict (id) do nothing;

-- Every chat the bot has heard from, so the owner can pick which one is THE group. Messages from other chats are not kept.
create table if not exists public.telegram_chats (
  chat_id bigint primary key,
  title text,
  kind text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  messages int not null default 0
);

create table if not exists public.telegram_users (
  tg_user_id bigint primary key,            -- Telegram's permanent id: the only stable key
  username text,                            -- @name, optional and changeable: a label only
  name text,                                -- display name, changeable: a label only
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  claims int not null default 0,
  site_username text,                       -- the website login they named in the group (owner-typed or captured)
  last_number text,                         -- the number the owner last paid this person to (a suggestion only, step 4)
  note text
);

-- ---------- claims ----------
create table if not exists public.telegram_claims (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  message_id bigint not null,
  media_group_id text,
  tg_user_id bigint not null references public.telegram_users (tg_user_id),
  kind text not null check (kind in ('photo', 'text')),
  file_id text,                             -- Telegram's handle for the photo (the bot token turns it into bytes)
  file_unique_id text,
  text text,                                -- the message text or the photo's caption, capped
  sent_at timestamptz not null,
  ocr_status text not null default 'none' check (ocr_status in ('none', 'pending', 'done', 'failed')),
  ocr_text text,
  ocr_at timestamptz,
  ocr_tries int not null default 0,
  ocr_taken_at timestamptz,
  candidates text[] not null default '{}',  -- every TrxID-shaped string seen in the text and the OCR
  payment_id uuid references public.payments (id),
  matched_how text check (matched_how in ('exact', 'normalized', 'one_off', 'owner')),
  matched_at timestamptz,
  -- new: a photo whose OCR has not run; unmatched: no TrxID of ours in it; matched: one of our counted transactions;
  -- held: the transaction is held for review in PayTrace; duplicate: this person already claimed that TrxID;
  -- conflict: another person claimed it first; review: the owner has to look (ambiguous read, ignored transaction);
  -- ignored: the owner dismissed it.
  status text not null default 'new' check (status in ('new', 'unmatched', 'matched', 'held', 'duplicate', 'conflict', 'review', 'ignored')),
  first_claim_id uuid references public.telegram_claims (id),
  note text,
  replied_at timestamptz,
  reply_kind text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chat_id, message_id)
);
create index if not exists telegram_claims_payment_idx on public.telegram_claims (payment_id) where payment_id is not null;
create index if not exists telegram_claims_user_idx on public.telegram_claims (tg_user_id, sent_at desc);
create index if not exists telegram_claims_status_idx on public.telegram_claims (status, sent_at desc);
create index if not exists telegram_claims_ocr_idx on public.telegram_claims (sent_at) where ocr_status = 'pending';

alter table public.telegram_settings enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.telegram_users enable row level security;
alter table public.telegram_claims enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'telegram_settings' and policyname = 'telegram_settings_admin_read') then
    create policy telegram_settings_admin_read on public.telegram_settings for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'telegram_chats' and policyname = 'telegram_chats_admin_read') then
    create policy telegram_chats_admin_read on public.telegram_chats for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'telegram_users' and policyname = 'telegram_users_admin_read') then
    create policy telegram_users_admin_read on public.telegram_users for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'telegram_claims' and policyname = 'telegram_claims_admin_read') then
    create policy telegram_claims_admin_read on public.telegram_claims for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.telegram_settings, public.telegram_chats, public.telegram_users, public.telegram_claims to authenticated;

-- ---------- reading TrxIDs out of text ----------
-- bKash: 10 letters/digits (DKJ9NWWLEH); its receipt font can turn the only digit into a letter (DKJONWWLEH, real OCR
-- 2026-11-20), so a 10-character string needs only a letter. Nagad: 8 with letters AND digits (76CCGNVE). Rocket: 10
-- digits. Noise such as a site name ("777bajii") passes here and matches nothing in the database, which is the real
-- filter. Mirrors `candidates.ts` in the telegram function and the OCR worker (tests/telegram.test.ts keeps the three
-- in step). Upper case; each string once, in order.
create or replace function public.tg_trx_candidates(p text) returns text[] language sql immutable as $$
  select coalesce(array_agg(t order by ord), '{}') from (
    select distinct on (t) t, ord from (
      select upper(m[1]) as t, row_number() over () as ord
      from regexp_matches(coalesce(p, ''), '(?<![A-Za-z0-9])([A-Za-z0-9]{8}|[A-Za-z0-9]{10})(?![A-Za-z0-9])', 'g') as m
    ) s
    where (length(t) = 8 and t ~ '[A-Z]' and t ~ '[0-9]') or (length(t) = 10 and t ~ '[A-Z]') or (t ~ '^[0-9]{10}$')
    order by t, ord
  ) u;
$$;

-- The one stored transaction a set of read strings points at, or nothing. Money that came IN only (a customer's Cash
-- Out, a Send Money, a merchant payment), any status (held ones match too: the claim then reads "held"), not a wallet
-- that is not ours. Exact first, then the 0/O 1/I/L folding PayTrace already uses for Admin Hub, then ONE character
-- different among the last 30 days, and only when that leaves exactly one transaction (two = ambiguous = the owner).
create or replace function public.tg_find_payment(p_cands text[])
returns table (payment_id uuid, how text, ambiguous boolean) language plpgsql stable as $$
declare
  c text;
  ids uuid[];
begin
  if p_cands is null or cardinality(p_cands) = 0 then return; end if;
  -- exact
  select array_agg(distinct p.id) into ids from public.payments p
   where p.trx_id = any (p_cands) and p.txn_type in ('cash_out', 'send_money_received', 'payment_received')
     and coalesce(p.review_reason, '') <> 'not_ours';
  if ids is not null then
    if cardinality(ids) = 1 then payment_id := ids[1]; how := 'exact'; ambiguous := false; return next; return; end if;
    payment_id := null; how := 'exact'; ambiguous := true; return next; return;
  end if;
  -- 0/O, 1/I/L folded
  select array_agg(distinct p.id) into ids from public.payments p
   where p.received_at > now() - interval '30 days'
     and p.txn_type in ('cash_out', 'send_money_received', 'payment_received') and coalesce(p.review_reason, '') <> 'not_ours'
     and public.hub_trx_norm(p.trx_id) = any (select public.hub_trx_norm(x) from unnest(p_cands) x);
  if ids is not null then
    if cardinality(ids) = 1 then payment_id := ids[1]; how := 'normalized'; ambiguous := false; return next; return; end if;
    payment_id := null; how := 'normalized'; ambiguous := true; return next; return;
  end if;
  -- one character off (bKash's receipt font turns 9 into O or S and 5 into S)
  foreach c in array p_cands loop
    select array_agg(distinct p.id) into ids from public.payments p
     where p.received_at > now() - interval '30 days'
       and p.txn_type in ('cash_out', 'send_money_received', 'payment_received') and coalesce(p.review_reason, '') <> 'not_ours'
       and length(p.trx_id) = length(c) and p.trx_id <> c
       and (select count(*) from generate_series(1, length(c)) i where substr(p.trx_id, i, 1) <> substr(c, i, 1)) = 1;
    if ids is not null then
      if cardinality(ids) = 1 then payment_id := ids[1]; how := 'one_off'; ambiguous := false; return next; return; end if;
      payment_id := null; how := 'one_off'; ambiguous := true; return next; return;
    end if;
  end loop;
  return;
end $$;

-- ---------- judging a claim ----------
create or replace function public.tg_claim_judge(p_claim uuid) returns public.telegram_claims
language plpgsql security definer set search_path = public as $$
declare
  c public.telegram_claims;
  f record;
  pay public.payments;
  earlier public.telegram_claims;
  cands text[];
  st text;
  note_ text;
begin
  select * into c from public.telegram_claims where id = p_claim for update;
  if not found then return null; end if;
  -- The owner's own decisions stand.
  if c.status = 'ignored' or c.matched_how = 'owner' then return c; end if;
  cands := public.tg_trx_candidates(coalesce(c.text, '') || ' ' || coalesce(c.ocr_text, ''));
  update public.telegram_claims set candidates = cands where id = c.id;
  select * into f from public.tg_find_payment(cands) limit 1;
  if f.payment_id is null then
    if f.ambiguous then
      st := 'review'; note_ := 'the read fits more than one transaction (' || f.how || ')';
    elsif c.kind = 'photo' and c.ocr_status in ('none', 'pending') then
      st := 'new'; note_ := null;
    else
      st := 'unmatched'; note_ := case when cardinality(cands) = 0 then 'no TrxID in it' else 'none of these is a transaction of ours: ' || array_to_string(cands, ', ') end;
    end if;
    update public.telegram_claims set status = st, note = note_, payment_id = null, matched_how = null, matched_at = null, first_claim_id = null
     where id = c.id returning * into c;
    return c;
  end if;
  select * into pay from public.payments where id = f.payment_id;
  -- Already claimed? The earliest live claim of that transaction wins.
  select * into earlier from public.telegram_claims
   where payment_id = f.payment_id and id <> c.id and status not in ('duplicate', 'conflict', 'ignored', 'unmatched', 'new')
   order by sent_at, created_at limit 1;
  if earlier.id is not null then
    st := case when earlier.tg_user_id = c.tg_user_id then 'duplicate' else 'conflict' end;
    note_ := case when st = 'duplicate' then 'same person already submitted this TrxID' else 'another person submitted this TrxID first' end;
  elsif pay.status = 'review' then
    st := 'held'; note_ := coalesce(pay.review_reason, 'held for review');
  elsif public.payment_counted(pay.status, pay.chain_status, pay.txn_type, pay.review_reason) then
    st := 'matched'; note_ := null;
  else
    st := 'review'; note_ := 'the transaction is ' || pay.status || coalesce(' (' || pay.review_reason || ')', '');
  end if;
  update public.telegram_claims
     set payment_id = f.payment_id, matched_how = f.how, matched_at = coalesce(matched_at, now()),
         status = st, note = note_, first_claim_id = earlier.id
   where id = c.id returning * into c;
  return c;
end $$;
revoke all on function public.tg_claim_judge(uuid) from public, anon, authenticated;
grant execute on function public.tg_claim_judge(uuid) to service_role;

-- What the bot and the dashboard need to know about a claim, in one object (never the photo bytes).
create or replace function public.tg_claim_brief(p_claim uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'kind', c.kind, 'note', c.note, 'candidates', c.candidates, 'ocr_status', c.ocr_status,
    'tg_user_id', c.tg_user_id, 'username', u.username, 'name', u.name,
    'chat_id', c.chat_id, 'message_id', c.message_id, 'sent_at', c.sent_at,
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
revoke all on function public.tg_claim_brief(uuid) from public, anon;
grant execute on function public.tg_claim_brief(uuid) to authenticated, service_role;

-- ---------- the bot's entry: one message ----------
-- Records the chat (so the owner can pick the group), and, for the chosen group only, the person and the message as a
-- claim. A photo waits for the OCR worker; a text is judged at once. Returns the claim's brief, or {"kept": false}.
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
  perform public.tg_claim_judge(c.id);
  return public.tg_claim_brief(c.id) || jsonb_build_object('kept', true);
end $$;
revoke all on function public.tg_claim_add(bigint, text, text, bigint, text, bigint, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.tg_claim_add(bigint, text, text, bigint, text, bigint, text, text, text, text, text, text, timestamptz) to service_role;

-- ---------- the OCR worker's two calls ----------
-- Photos still to read, oldest first; a photo taken but not answered within 10 minutes is handed out again, 3 tries at most.
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
revoke all on function public.tg_ocr_next(int) from public, anon, authenticated;
grant execute on function public.tg_ocr_next(int) to service_role;

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
  perform public.tg_claim_judge(c.id);
  return public.tg_claim_brief(c.id) || jsonb_build_object('ok', true);
end $$;
revoke all on function public.tg_ocr_done(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tg_ocr_done(uuid, text, boolean) to service_role;

-- Marks the bot's reply so one message is answered once.
create or replace function public.tg_claim_replied(p_claim uuid, p_kind text) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims set replied_at = now(), reply_kind = left(p_kind, 20) where id = p_claim;
$$;
revoke all on function public.tg_claim_replied(uuid, text) from public, anon, authenticated;
grant execute on function public.tg_claim_replied(uuid, text) to service_role;

create or replace function public.tg_webhook_set(p_bot_username text) returns void language sql security definer set search_path = public as $$
  update public.telegram_settings set webhook_set_at = now(), bot_username = left(p_bot_username, 64), updated_at = now() where id;
$$;
revoke all on function public.tg_webhook_set(text) from public, anon, authenticated;
grant execute on function public.tg_webhook_set(text) to service_role;

-- ---------- the owner's actions (dashboard, two-step rule through is_admin) ----------
create or replace function public.tg_set_group(p_chat_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select title into t from public.telegram_chats where chat_id = p_chat_id;
  update public.telegram_settings set group_chat_id = p_chat_id, group_title = t, updated_at = now() where id;
  insert into public.events (kind, provider, detail) values ('telegram_group_set', null, jsonb_build_object('chat_id', p_chat_id, 'title', t, 'by', auth.uid()));
end $$;
grant execute on function public.tg_set_group(bigint) to authenticated;

create or replace function public.tg_set_reply_mode(p_mode text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_mode not in ('off', 'problems', 'all') then raise exception 'bad mode'; end if;
  update public.telegram_settings set reply_mode = p_mode, updated_at = now() where id;
end $$;
grant execute on function public.tg_set_reply_mode(text) to authenticated;

create or replace function public.tg_claim_ignore(p_claim uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_claims set status = 'ignored', note = nullif(left(coalesce(p_note, ''), 200), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_claim;
  insert into public.events (kind, provider, detail) values ('telegram_claim_ignored', null, jsonb_build_object('claim', p_claim, 'note', p_note, 'by', auth.uid()));
end $$;
grant execute on function public.tg_claim_ignore(uuid, text) to authenticated;

-- The owner names the transaction a claim is for (the OCR missed it, or read it wrong). The duplicate / held rules still apply.
create or replace function public.tg_claim_pick(p_claim uuid, p_payment uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.telegram_claims;
  pay public.payments;
  earlier public.telegram_claims;
  st text; note_ text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into c from public.telegram_claims where id = p_claim for update;
  if not found then raise exception 'no such claim'; end if;
  select * into pay from public.payments where id = p_payment;
  if not found then raise exception 'no such transaction'; end if;
  if pay.txn_type not in ('cash_out', 'send_money_received', 'payment_received') then raise exception 'not money that came in'; end if;
  select * into earlier from public.telegram_claims
   where payment_id = p_payment and id <> c.id and status not in ('duplicate', 'conflict', 'ignored', 'unmatched', 'new')
   order by sent_at, created_at limit 1;
  if earlier.id is not null then
    st := case when earlier.tg_user_id = c.tg_user_id then 'duplicate' else 'conflict' end;
    note_ := 'picked by the owner; ' || case when st = 'duplicate' then 'same person already submitted this TrxID' else 'another person submitted this TrxID first' end;
  elsif pay.status = 'review' then st := 'held'; note_ := 'picked by the owner; ' || coalesce(pay.review_reason, 'held for review');
  elsif public.payment_counted(pay.status, pay.chain_status, pay.txn_type, pay.review_reason) then st := 'matched'; note_ := 'picked by the owner';
  else st := 'review'; note_ := 'picked by the owner; the transaction is ' || pay.status;
  end if;
  update public.telegram_claims
     set payment_id = p_payment, matched_how = 'owner', matched_at = now(), status = st, note = note_, first_claim_id = earlier.id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = c.id;
  insert into public.events (kind, provider, detail) values ('telegram_claim_picked', pay.provider, jsonb_build_object('claim', p_claim, 'payment', p_payment, 'trx_id', pay.trx_id, 'status', st, 'by', auth.uid()));
  return public.tg_claim_brief(c.id);
end $$;
grant execute on function public.tg_claim_pick(uuid, uuid) to authenticated;

-- Re-judge a claim (a held transaction was released, the owner wants the rules run again).
create or replace function public.tg_claim_rejudge(p_claim uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  perform public.tg_claim_judge(p_claim); -- an owner's pick is kept as it is
  return public.tg_claim_brief(p_claim);
end $$;
grant execute on function public.tg_claim_rejudge(uuid) to authenticated;

create or replace function public.tg_user_set(p_user bigint, p_site_username text, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_users set site_username = nullif(left(coalesce(p_site_username, ''), 64), ''), note = nullif(left(coalesce(p_note, ''), 200), '') where tg_user_id = p_user;
end $$;
grant execute on function public.tg_user_set(bigint, text, text) to authenticated;

-- ---------- what the dashboard reads ----------
-- Claims of a period with their transaction, newest first (at most 500).
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
grant execute on function public.tg_claims(timestamptz, timestamptz, text) to authenticated;

-- Per person: matched transactions not yet paid out, with their total, plus held and open counts. The list step 4 pays from.
create or replace function public.tg_user_summary(p_from timestamptz)
returns table (tg_user_id bigint, username text, name text, site_username text, last_number text,
               matched int, matched_total numeric, held int, open int, conflicts int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with rows as (
    select c.tg_user_id, c.status, c.sent_at, p.amount,
           (c.status = 'matched' and not exists (select 1 from public.payout_items i where i.payment_id = c.payment_id and i.live)) as payable
    from public.telegram_claims c
    left join public.payments p on p.id = c.payment_id
    where public.is_admin() and c.sent_at >= p_from)
  select u.tg_user_id, u.username, u.name, u.site_username, u.last_number,
         count(*) filter (where r.payable)::int as matched,
         coalesce(sum(r.amount) filter (where r.payable), 0) as matched_total,
         count(*) filter (where r.status = 'held')::int as held,
         count(*) filter (where r.status in ('new', 'unmatched', 'review'))::int as open,
         count(*) filter (where r.status = 'conflict')::int as conflicts,
         max(r.sent_at) as last_at
  from rows r join public.telegram_users u on u.tg_user_id = r.tg_user_id
  group by u.tg_user_id, u.username, u.name, u.site_username, u.last_number
  order by matched_total desc, last_at desc;
$$;
grant execute on function public.tg_user_summary(timestamptz) to authenticated;

-- Held transactions get released by the wallet checks; a claim on one should follow without the owner pressing anything.
create or replace function public.tg_follow_payment() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is distinct from old.status then
    for r in select id from public.telegram_claims where payment_id = new.id and status in ('held', 'matched', 'review') loop
      perform public.tg_claim_judge(r.id);
    end loop;
  end if;
  return new;
exception when others then
  return new; -- a claim's bookkeeping must never stop a payment
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'payments_telegram_follow') then
    create trigger payments_telegram_follow after update of status on public.payments
      for each row execute function public.tg_follow_payment();
  end if;
end $$;
