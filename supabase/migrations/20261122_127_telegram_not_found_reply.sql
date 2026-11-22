-- 127: the bot answers a screenshot of a payment that never reached us (owner 2026-11-22: "if a user submits a fake
-- screenshot whose transaction does not exist, our bot tells him to delete it like a human and not to send it to Prime
-- bhai's inbox for payment"; amount reading was NOT wanted). Matching, crediting and payouts do not change.
-- SAFETY: "not in PayTrace now" is not "fake" (a late SMS, an offline phone, one misread letter). The reply goes out only
-- after not_found_wait_min (default 20) minutes, only for ONE clean TrxID-shaped word that is not a noise word, only
-- when nothing knows it (payments of any status, the wallet apps' rows, typed deposit orders, and tg_find_payment's
-- one-character-off search all return nothing), and only while the wallets of that kind are provably listening (an
-- approved phone with such a wallet seen in the last 3 minutes and an SMS of that kind in the last 6 hours), and only for a
-- word with the wallet's own prefix (bKash DK…, Nagad 76…), of the wallet's length or one character too long (which no wallet
-- issues), that is not within two misread characters, or one dropped character, of a real TrxID. If the post
-- later means a transaction (the SMS arrives, the owner picks one), tg_claim_judge2 takes the reply back (the bot
-- deletes its own message) and the existing kind change turns the 👎 into a 👍. One reply per person + TrxID per day.
-- No DROP, no DELETE (MCP rule). tg_claim_judge2 below = 126's text (md5-checked against the live function) + 2 lines.

-- ---------- settings ----------
alter table public.telegram_settings add column if not exists not_found_reply boolean not null default true;
alter table public.telegram_settings add column if not exists not_found_wait_min int not null default 20;
alter table public.telegram_settings add column if not exists not_found_text text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'telegram_settings_not_found_wait_min_check') then
    alter table public.telegram_settings add constraint telegram_settings_not_found_wait_min_check check (not_found_wait_min between 5 and 180);
  end if;
end $$;
update public.telegram_settings set not_found_text = 'ভাই, এই TrxID {trx} এর কোনো পেমেন্ট আমাদের কাছে আসেনি। স্ক্রিনশটটা ডিলিট করে দিন, আর ভুল করেও এই স্ক্রিনশট পেমেন্টের জন্য প্রাইম ভাইয়ের ইনবক্সে দিবেন না।' where not_found_text is null;

create or replace function public.tg_not_found_default_text() returns text language sql immutable as $$
  select 'ভাই, এই TrxID {trx} এর কোনো পেমেন্ট আমাদের কাছে আসেনি। স্ক্রিনশটটা ডিলিট করে দিন, আর ভুল করেও এই স্ক্রিনশট পেমেন্টের জন্য প্রাইম ভাইয়ের ইনবক্সে দিবেন না।'::text;
$$;

-- The owner's switch, wait and words. {trx} in the text is filled with the TrxID when the bot sends it.
create or replace function public.tg_set_not_found(p_on boolean, p_wait_min int, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_wait_min is not null and (p_wait_min < 5 or p_wait_min > 180) then raise exception 'wait between 5 and 180 minutes'; end if;
  -- null = leave the text as it is; '' = back to the default words; anything else = the owner's words.
  t := nullif(trim(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  if t is not null and length(t) > 400 then raise exception 'the text may be at most 400 characters'; end if;
  update public.telegram_settings
     set not_found_reply = coalesce(p_on, not_found_reply),
         not_found_wait_min = coalesce(p_wait_min, not_found_wait_min),
         not_found_text = case when p_text is null then not_found_text else coalesce(t, public.tg_not_found_default_text()) end,
         updated_at = now()
   where id;
  insert into public.events (kind, detail) values ('telegram_not_found_set', jsonb_build_object('on', p_on, 'wait_min', p_wait_min, 'text', t, 'by', auth.uid()));
end $$;
revoke all on function public.tg_set_not_found(boolean, int, text) from public, anon;
grant execute on function public.tg_set_not_found(boolean, int, text) to authenticated;

-- ---------- the claim's own record of the reply ----------
alter table public.telegram_claims add column if not exists nf_pending boolean not null default false;
alter table public.telegram_claims add column if not exists nf_trx text;
alter table public.telegram_claims add column if not exists nf_tries int not null default 0;
alter table public.telegram_claims add column if not exists nf_sent_at timestamptz;
alter table public.telegram_claims add column if not exists nf_message_id bigint;
alter table public.telegram_claims add column if not exists nf_unsend_pending boolean not null default false;
alter table public.telegram_claims add column if not exists nf_undone_at timestamptz;
create index if not exists telegram_claims_nf_idx on public.telegram_claims (sent_at) where nf_pending or nf_unsend_pending;
create index if not exists telegram_claims_nf_trx_idx on public.telegram_claims (tg_user_id, nf_trx) where nf_trx is not null;

-- Words the OCR reads off the page around a receipt (POSTSCRIPT, WITHDRAWAL, a site's name): anything TrxID-shaped
-- that 3+ different people posted in 14 days, plus every live website's name. Never a real TrxID of one person.
create or replace function public.tg_noise_words() returns setof text language sql stable security definer set search_path = public as $$
  select upper(x) from public.telegram_claims c, unnest(coalesce(c.candidates, '{}')) x
   where c.created_at > now() - interval '14 days'
   group by upper(x) having count(distinct c.tg_user_id) >= 3
  union
  select upper(regexp_replace(k.name, '[^A-Za-z0-9]', '', 'g')) from public.api_keys k where k.name is not null
  union
  select 'CANDIDATES';
$$;
revoke all on function public.tg_noise_words() from public, anon, authenticated;
grant execute on function public.tg_noise_words() to service_role;

-- The first two characters every real TrxID of a wallet type starts with (bKash "DK", Nagad "76" in the live data):
-- learned from the payments themselves, so a game page's "ARAFAT1X11" or "TCE28777B0" is never taken for a receipt.
create or replace function public.tg_trx_prefixes(p_provider text) returns setof text language sql stable security definer set search_path = public as $$
  select left(p.trx_id, 2) from public.payments p
   where p.provider = p_provider and p.received_at > now() - interval '60 days'
     and p.txn_type in ('cash_out', 'send_money_received', 'payment_received')
   group by left(p.trx_id, 2) having count(*) >= 20;
$$;
revoke all on function public.tg_trx_prefixes(text) from public, anon, authenticated;
grant execute on function public.tg_trx_prefixes(text) to service_role;

-- The one clean TrxID-shaped word of a claim, or null (none, or more than one). Never the poster's own handle.
create or replace function public.tg_clean_trx(p_cands text[], p_user bigint default null) returns text language sql stable security definer set search_path = public as $$
  with w as (
    select distinct upper(x) as t from unnest(coalesce(p_cands, '{}')) x
     -- the wallet's own length, or ONE character too long (bKash 11, Nagad 9): no wallet issues those, so such a word with
     -- the wallet's prefix is a TrxID that cannot exist (owner's fake 76B7016F9, 2026-11-22). tg_trx_near below keeps a real
     -- TrxID the OCR read with one extra character silent.
     where (upper(x) ~ '^[A-Z0-9]{10,11}$' and upper(x) ~ '[A-Z]' and upper(x) ~ '[0-9]' and left(upper(x), 2) in (select public.tg_trx_prefixes('bkash')))
        or (upper(x) ~ '^[0-9]{2}[A-Z0-9]{6,7}$' and left(upper(x), 2) in (select public.tg_trx_prefixes('nagad')))
  ), ok as (
    select t from w
     where t not in (select n from public.tg_noise_words() n)
       and (p_user is null or t not in (select upper(coalesce(u.username, '')) from public.telegram_users u where u.tg_user_id = p_user
                                        union select upper(coalesce(u.site_username, '')) from public.telegram_users u where u.tg_user_id = p_user))
  )
  select case when (select count(*) from ok) = 1 then (select t from ok) end;
$$;
revoke all on function public.tg_clean_trx(text[], bigint) from public, anon, authenticated;
grant execute on function public.tg_clean_trx(text[], bigint) to service_role;

-- A real TrxID within two misread characters (O/0, I/L/1, S/5, B/8, Z/2, G/6 folded) in the last 30 days, or one that
-- becomes the word when ONE extra character is dropped (the OCR can add a stray character to a real receipt): then the
-- post may be a real receipt read wrongly, and the bot says nothing (the owner's Pick transaction settles it).
create or replace function public.tg_trx_near(p_trx text) returns boolean language sql stable security definer set search_path = public as $$
  with w as (select translate(upper(p_trx), 'OILSBZG', '0115826') as f),
  known as (
    select translate(upper(p.trx_id), 'OILSBZG', '0115826') as f, length(p.trx_id) as n from public.payments p
     where p.received_at > now() - interval '30 days'
       and p.txn_type in ('cash_out', 'send_money_received', 'payment_received')
       and length(p.trx_id) between length(p_trx) - 1 and length(p_trx)
  )
  select exists (
    select 1 from known r, w
     where (r.n = length(w.f) and (select count(*) from generate_series(1, length(w.f)) i where substr(w.f, i, 1) <> substr(r.f, i, 1)) <= 2)
        or (r.n = length(w.f) - 1 and exists (select 1 from generate_series(1, length(w.f)) i where overlay(w.f placing '' from i for 1) = r.f)));
$$;
revoke all on function public.tg_trx_near(text) from public, anon, authenticated;
grant execute on function public.tg_trx_near(text) to service_role;

-- The rule, in one place. Returns the claims whose post deserves the "payment not received" reply NOW.
create or replace function public.tg_not_found_due() returns table (claim_id uuid, trx text) language plpgsql stable security definer set search_path = public as $$
declare s public.telegram_settings; r record; t text; prov text;
begin
  select * into s from public.telegram_settings ts where ts.id limit 1;
  if s.id is null or not coalesce(s.not_found_reply, true) then return; end if;
  for r in
    select c.id, c.tg_user_id, c.candidates from public.telegram_claims c
     where c.status = 'unmatched'
       and (c.kind = 'text' or c.ocr_status = 'done')
       and c.sent_at <= now() - make_interval(mins => coalesce(s.not_found_wait_min, 20))
       and c.sent_at >= now() - interval '24 hours'
       and not c.nf_pending and c.nf_sent_at is null and c.nf_message_id is null and c.nf_tries < 3
       -- the TrxID test first, so plain chat never fills the 50 (a busy group writes 300 posts a day)
       and public.tg_clean_trx(c.candidates, c.tg_user_id) is not null
     order by c.sent_at
     limit 50
  loop
    t := public.tg_clean_trx(r.candidates, r.tg_user_id);
    if t is null then continue; end if;
    prov := case when left(t, 2) in (select public.tg_trx_prefixes('bkash')) then 'bkash' else 'nagad' end;
    -- one reply per person + TrxID per day (a reposted fake gets one answer)
    if exists (select 1 from public.telegram_claims c2 where c2.tg_user_id = r.tg_user_id and c2.nf_trx = t
                  and (c2.nf_pending or c2.nf_sent_at > now() - interval '24 hours')) then continue; end if;
    -- nothing anywhere knows it
    if exists (select 1 from public.payments p where upper(p.trx_id) = t) then continue; end if;
    if exists (select 1 from public.app_rows a where upper(a.trx_id) = t) then continue; end if;
    if exists (select 1 from public.orders o where upper(o.claimed_trx_id) = t) then continue; end if;
    if exists (select 1 from public.tg_find_payment(array[t])) then continue; end if;
    if public.tg_trx_near(t) then continue; end if;
    -- the wallets of that kind were listening
    if not exists (select 1 from public.devices d where d.status = 'approved' and d.last_seen_at > now() - interval '3 minutes'
                      and exists (select 1 from jsonb_array_elements(coalesce(d.info->'wallets', '[]'::jsonb)) w
                                   where w->>'provider' = prov and coalesce(w->>'kind', 'agent') = 'agent')) then continue; end if;
    if not exists (select 1 from public.payments p where p.provider = prov and p.received_at > now() - interval '6 hours') then continue; end if;
    claim_id := r.id; trx := t; return next;
  end loop;
end $$;
revoke all on function public.tg_not_found_due() from public, anon, authenticated;
grant execute on function public.tg_not_found_due() to service_role;

-- Every 5 minutes: mark the due claims; the telegram function sends on its next drain (the outbox tick wakes it).
create or replace function public.tg_not_found_tick() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.tg_not_found_due() loop
    update public.telegram_claims c
       set nf_pending = true, nf_trx = r.trx, react_kind = 'down', react_pending = true, reacted_at = null
     where c.id = r.claim_id and not c.nf_pending and c.nf_sent_at is null
       -- the same person posting the same TrxID three times gets ONE reply (checked again here, because the due list
       -- is one snapshot and would otherwise mark all three)
       and not exists (select 1 from public.telegram_claims c2 where c2.tg_user_id = c.tg_user_id and c2.nf_trx = r.trx and c2.id <> c.id
                          and (c2.nf_pending or c2.nf_sent_at > now() - interval '24 hours'));
    if found then
      n := n + 1;
      insert into public.events (kind, detail) values ('telegram_not_found', jsonb_build_object('claim_id', r.claim_id, 'trx', r.trx));
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.tg_not_found_tick() from public, anon, authenticated;
grant execute on function public.tg_not_found_tick() to service_role;

-- The hand-offs to the telegram function.
create or replace function public.tg_nf_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, message_id bigint, trx text, text text) language sql security definer set search_path = public as $$
  select c.id, c.chat_id, c.message_id, c.nf_trx,
         replace(coalesce((select s.not_found_text from public.telegram_settings s where s.id limit 1), public.tg_not_found_default_text()), '{trx}', coalesce(c.nf_trx, ''))
    from public.telegram_claims c
   where c.nf_pending and c.nf_tries < 3
   order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_nf_next(int) from public, anon, authenticated;
grant execute on function public.tg_nf_next(int) to service_role;

create or replace function public.tg_nf_sent(p_claim uuid, p_ok boolean, p_message_id bigint) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims
     set nf_tries = nf_tries + 1,
         nf_pending = case when p_ok then false else nf_tries + 1 < 3 end,
         nf_sent_at = case when p_ok then now() else nf_sent_at end,
         nf_message_id = case when p_ok then p_message_id else nf_message_id end
   where id = p_claim;
$$;
revoke all on function public.tg_nf_sent(uuid, boolean, bigint) from public, anon, authenticated;
grant execute on function public.tg_nf_sent(uuid, boolean, bigint) to service_role;

create or replace function public.tg_nf_unsend_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, nf_message_id bigint) language sql security definer set search_path = public as $$
  select c.id, c.chat_id, c.nf_message_id from public.telegram_claims c
   where c.nf_unsend_pending and c.nf_message_id is not null order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_nf_unsend_next(int) from public, anon, authenticated;
grant execute on function public.tg_nf_unsend_next(int) to service_role;

create or replace function public.tg_nf_unsent(p_claim uuid) returns void language sql security definer set search_path = public as $$
  update public.telegram_claims set nf_unsend_pending = false, nf_message_id = null, nf_undone_at = now() where id = p_claim;
$$;
revoke all on function public.tg_nf_unsent(uuid) from public, anon, authenticated;
grant execute on function public.tg_nf_unsent(uuid) to service_role;

-- ---------- tg_claim_judge2: 126's text + the two 127 lines ----------
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
    -- The person's name changed: the bot's names on their transactions follow (114; lost in 124, back in 126).
    update public.payment_names n set name = public.tg_person_name(c.tg_user_id), set_at = now() where n.tg_user_id = c.tg_user_id and n.source = 'telegram';
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
      payment_id = null, matched_how = null, matched_at = null, first_claim_id = null,
      -- 127: a pending 👎 of a "payment not received" reply survives a re-judge that still finds nothing.
      react_pending = (nf_trx is not null and react_kind = 'down' and reacted_at is null),
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
         unwarn_pending = case when st <> 'conflict' and warn_message_id is not null then true else unwarn_pending end,
         -- 127: the "payment not received" reply is taken back once the post means a transaction after all.
         nf_pending = false,
         nf_unsend_pending = case when nf_message_id is not null then true else nf_unsend_pending end
   where id = c.id;
  -- The bot's name on the transaction (114; lost in 124, back in 126). Never over an owner-typed name.
  perform public.payment_name_from_claim(c.id);
end $$;

-- ---------- what the dashboard sees ----------
create or replace function public.tg_claim_brief(p_claim uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'kind', c.kind, 'note', c.note, 'candidates', c.candidates, 'ocr_status', c.ocr_status,
    'tg_user_id', c.tg_user_id, 'username', u.username, 'name', u.name, 'site_username', u.site_username, 'site_username_seen', c.site_username_seen,
    'chat_id', c.chat_id, 'message_id', c.message_id, 'sent_at', c.sent_at, 'reacted', c.reacted_at is not null, 'react_pending', c.react_pending,
    'react_kind', c.react_kind, 'warned', c.warned_at is not null, 'warn_pending', c.warn_pending, 'warn_swapped', c.warn_swapped,
    'nf_pending', c.nf_pending, 'nf_sent_at', c.nf_sent_at, 'nf_trx', c.nf_trx, 'nf_undone', c.nf_undone_at is not null,
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
                                'react_kind', c.react_kind, 'warned', c.warned_at is not null, 'reply', c.reply_kind, 'id', c.id,
                                'not_found', c.nf_sent_at is not null, 'not_found_undone', c.nf_undone_at is not null, 'nf_trx', c.nf_trx) e
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

-- ---------- the clocks ----------
do $$
begin
  perform cron.unschedule('paytrace-telegram-outbox');
  perform cron.schedule('paytrace-telegram-outbox', '* * * * *',
    $cron$select net.http_post(url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/telegram', headers := '{"content-type":"application/json"}'::jsonb, body := '{"action":"drain"}'::jsonb)
          where exists (select 1 from public.telegram_outbox where status = 'queued' and tries < 3)
             or exists (select 1 from public.telegram_claims where (react_pending and reacted_at is null) or warn_pending or unwarn_pending or nf_pending or nf_unsend_pending)$cron$);
  if exists (select 1 from cron.job where jobname = 'paytrace-telegram-notfound') then perform cron.unschedule('paytrace-telegram-notfound'); end if;
  perform cron.schedule('paytrace-telegram-notfound', '*/5 * * * *', $cron$select public.tg_not_found_tick()$cron$);
end $$;
