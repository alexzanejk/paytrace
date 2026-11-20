-- 114: a NAME on each received transaction, for the Payout page (owner 2026-11-20: "each transaction on payout will show
-- the user name when the bot has sorted it; if not it will show an option for me to set one manually; and I should be
-- able to change a person's username too").
--
-- `payment_names`: one row per transaction. Source 'telegram' = written by the bot when a claim matched (the person's site
-- login if known, else their Telegram profile; it follows when the owner edits the person's site login); source 'owner' =
-- typed by the owner on the Payout page, which the bot never overwrites. A cleared name is a row with name null (no DELETE
-- through the MCP; a null never blocks a later bot match because clearing hands the row back to source 'telegram').
-- The name changes nothing about money: it is a label the owner pays by.

create table if not exists public.payment_names (
  payment_id uuid primary key references public.payments (id),
  name text,
  tg_user_id bigint references public.telegram_users (tg_user_id),
  claim_id uuid references public.telegram_claims (id),
  source text not null check (source in ('telegram', 'owner')),
  set_by uuid,
  set_at timestamptz not null default now()
);
alter table public.payment_names enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'payment_names' and policyname = 'payment_names_admin_read') then
    create policy payment_names_admin_read on public.payment_names for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.payment_names to authenticated;
create index if not exists payment_names_user_idx on public.payment_names (tg_user_id) where tg_user_id is not null;

-- The name the owner pays a Telegram person under: the site login they typed, else their profile.
create or replace function public.tg_person_name(p_user bigint) returns text language sql stable as $$
  select coalesce(nullif(trim(u.site_username), ''), nullif(trim(u.name), ''), case when u.username is not null then '@' || u.username end, 'user ' || u.tg_user_id)
  from public.telegram_users u where u.tg_user_id = p_user;
$$;

-- The bot's name for a claim's transaction. Never over an owner-typed name; a conflict (two people, one TrxID) writes nothing.
create or replace function public.payment_name_from_claim(p_claim uuid) returns void language sql security definer set search_path = public as $$
  insert into public.payment_names (payment_id, name, tg_user_id, claim_id, source)
  select c.payment_id, public.tg_person_name(c.tg_user_id), c.tg_user_id, c.id, 'telegram'
    from public.telegram_claims c
   where c.id = p_claim and c.payment_id is not null and c.status in ('matched', 'paid', 'held', 'duplicate')
  on conflict (payment_id) do update
    set name = excluded.name, tg_user_id = excluded.tg_user_id, claim_id = excluded.claim_id, set_at = now()
    where public.payment_names.source = 'telegram';
$$;
revoke all on function public.payment_name_from_claim(uuid) from public, anon, authenticated;
grant execute on function public.payment_name_from_claim(uuid) to service_role;

-- tg_claim_judge2 (113) + one line: a matched / paid / held / duplicate claim names its transaction.
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
  if c.status = 'ignored' then return; end if;
  cands := public.tg_trx_candidates(coalesce(c.text, '') || ' ' || coalesce(c.ocr_text, ''));
  site := public.tg_site_username(c.text);
  if c.matched_how = 'owner' then
    select c.payment_id as payment_id, 'owner'::text as how, false as ambiguous into f;
  else
    select * into f from public.tg_find_payment(cands) limit 1;
  end if;
  if site is not null and (f.payment_id is null or upper(site) <> (select trx_id from public.payments where id = f.payment_id)) then
    update public.telegram_users set site_username = site where tg_user_id = c.tg_user_id;
    -- The person's name changed: the bot's names on their transactions follow.
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
         react_pending = (st = 'matched' and reacted_at is null)
   where id = c.id;
  perform public.payment_name_from_claim(c.id);
end $$;

-- The owner edits a person's site login (Telegram page): the bot's names on their transactions follow.
create or replace function public.tg_user_set(p_user bigint, p_site_username text, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.telegram_users set site_username = nullif(left(trim(coalesce(p_site_username, '')), 64), ''), note = nullif(left(coalesce(p_note, ''), 200), '') where tg_user_id = p_user;
  update public.payment_names n set name = public.tg_person_name(p_user), set_at = now() where n.tg_user_id = p_user and n.source = 'telegram';
  insert into public.events (kind, provider, detail) values ('telegram_user_set', null, jsonb_build_object('tg_user_id', p_user, 'site_username', p_site_username, 'by', auth.uid()));
end $$;

-- The owner names a transaction by hand (Payout page). An empty name clears it: back to the bot's name if a claim names
-- it, else no name (and the row goes back to source 'telegram', so a later match may fill it).
create or replace function public.set_payment_name(p_payment uuid, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nm text := nullif(left(trim(coalesce(p_name, '')), 64), '');
  claim uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from public.payments where id = p_payment) then raise exception 'no such transaction'; end if;
  if nm is not null then
    insert into public.payment_names (payment_id, name, source, set_by, set_at) values (p_payment, nm, 'owner', auth.uid(), now())
    on conflict (payment_id) do update set name = excluded.name, source = 'owner', set_by = excluded.set_by, set_at = now();
  else
    select c.id into claim from public.telegram_claims c
     where c.payment_id = p_payment and c.status in ('matched', 'paid', 'held', 'duplicate') order by c.sent_at limit 1;
    insert into public.payment_names (payment_id, name, source, set_by, set_at) values (p_payment, null, 'telegram', auth.uid(), now())
    on conflict (payment_id) do update set name = null, tg_user_id = null, claim_id = null, source = 'telegram', set_by = excluded.set_by, set_at = now();
    if claim is not null then perform public.payment_name_from_claim(claim); end if;
  end if;
  insert into public.events (kind, provider, detail) values ('payment_name_set', null, jsonb_build_object('payment', p_payment, 'name', nm, 'by', auth.uid()));
  return (select to_jsonb(n) from public.payment_names n where n.payment_id = p_payment);
end $$;
grant execute on function public.set_payment_name(uuid, text) to authenticated;

-- Names for what the bot has matched so far.
do $$ declare r record; begin
  for r in select id from public.telegram_claims where payment_id is not null and status in ('matched', 'paid', 'held', 'duplicate') order by sent_at loop
    perform public.payment_name_from_claim(r.id);
  end loop;
end $$;
