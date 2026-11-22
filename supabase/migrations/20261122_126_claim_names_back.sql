-- 126: the bot's @username on a matched transaction is written again (regression from 124).
-- Owner 2026-11-22: posts got the 👍 but the Payout page showed "Set name". Migration 124 re-created tg_claim_judge2
-- from 113's body instead of 114's and lost two lines: the final perform payment_name_from_claim(c.id) and the
-- "person's name changed: rename their bot-named transactions" update. Since 2026-11-21 06:32 UTC, 109 of 147 matched
-- claims had no name. This file = 124's body + those two lines, then a backfill. No DROP, no DELETE (MCP rule).
-- RULE: re-create a function from its NEWEST definition (diff the live one with pg_get_functiondef first).

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
  -- The bot's name on the transaction (114; lost in 124, back in 126). Never over an owner-typed name.
  perform public.payment_name_from_claim(c.id);
end $$;

-- Backfill: every bot-matched claim since the regression writes its name now. payment_name_from_claim never
-- overwrites an owner-typed name (on conflict ... where source = 'telegram').
do $$
declare r record; n int := 0;
begin
  for r in
    select c.id from public.telegram_claims c
     where c.payment_id is not null and c.status in ('matched', 'paid', 'held', 'duplicate')
       and c.created_at >= '2026-11-21 05:00+00'
       and not exists (select 1 from public.payment_names pn where pn.payment_id = c.payment_id and pn.name is not null)
     order by c.created_at
  loop
    perform public.payment_name_from_claim(r.id);
    n := n + 1;
  end loop;
  insert into public.events (kind, detail) values ('claim_names_backfilled', jsonb_build_object('claims', n, 'since', '2026-11-21 05:00+00'));
end $$;
