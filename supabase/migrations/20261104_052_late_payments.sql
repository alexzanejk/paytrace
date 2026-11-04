-- 052: paid deposits must not be lost to the clock (owner 2026-11-04, after the audit).
-- Live numbers behind it: in 7 days 467 deposit orders, 23 TrxIDs typed, 2 paid; orders lived 15 minutes while the paid
-- ones took 31 minutes on average (slowest 88). And a payment whose SMS arrived after the order expired could never be
-- credited: reconcile_payment looked at pending orders only, a Cash Out receipt became tracked_only, which manual_match
-- refused, and Review never listed it.
--
-- What changes (and what does not):
--  1. Orders live 40 minutes by default, never under 20 (a site may still ask for up to 60).
--  2. reconcile_payment also pays an order that EXPIRED within the last 24 hours, if the SMS time is inside the order's life
--     (not after it expired, not more than 5 minutes before it was created: an older receipt cannot pay a new order).
--     A pending order with the same claim wins over an expired one.
--  3. A payment that is HELD (review) moves the order that claimed its TrxID to "review" too, whichever came first (the SMS
--     or the customer's TrxID), so the website hears deposit.review, never deposit.expired, for money that arrived.
--  4. manual_match accepts a Cash Out receipt (tracked_only) and an order expired up to 48 hours ago. Crediting still
--     happens ONLY here and in reconcile_payment; both lock the TrxID first, so they can never race.
--  5. ignore_payment also closes the order it held (cancelled), so the website gets a final answer.
--  6. gw_submit_trx says why a claim was held, so the gateway can message the owner (before, only holds seen by the
--     ingest function were messaged; a hold on the customer's TrxID entry was silent).
--  7. Deposits turned away for want of a number are logged (deposit_refused_no_wallet), and a view counts per wallet how
--     many orders were handed out / typed / paid in 24 hours.
-- No DROP or DELETE anywhere (the MCP hangs on them). Nothing here credits an order outside the two functions above.

-- ---------- 1 + 7a. order lifetime and refusal log ----------
create or replace function public.gw_find_wallet_in_group(p_provider text, p_method text, p_group text)
returns public.device_wallets language sql stable security definer set search_path = public as $$
  select w.* from public.device_wallets w join public.devices d on d.id = w.device_id
   where w.provider = p_provider and w.enabled and d.status = 'approved' and w.wallet_group = p_group
     and (p_method is null or w.method = p_method)
     and (p_group = 'main' or (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds'))
   -- online phones first, then phones heard from in the last 10 minutes, then the rest (main only); ties rotate
   order by (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds') desc,
            (d.last_seen_at is not null and d.last_seen_at > now() - interval '10 minutes') desc,
            w.last_assigned_at asc nulls first
   limit 1;
$$;
revoke all on function public.gw_find_wallet_in_group(text, text, text) from public, anon, authenticated;
grant execute on function public.gw_find_wallet_in_group(text, text, text) to service_role;

create or replace function public.gw_create_deposit(
  p_key_hash text, p_amount numeric, p_merchant_order_id text, p_provider text, p_method text,
  p_expires_minutes int, p_customer_name text, p_customer_phone text, p_return_url text, p_limit int, p_group text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders; mins int;
  prov text := nullif(btrim(p_provider), ''); meth text := nullif(btrim(p_method), ''); wal public.device_wallets;
  grp text := case when lower(btrim(coalesce(p_group, ''))) in ('', 'main') then 'main' else lower(btrim(p_group)) end;
  used text := 'main'; g_on boolean;
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  update public.api_keys set last_used_at = now() where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;

  if p_amount is null or p_amount < 500 or p_amount > 50000 or p_amount <> round(p_amount, 2) then
    return jsonb_build_object('error', 'amount must be between 500 and 50000 taka, with at most 2 decimals');
  end if;
  if p_merchant_order_id is null or char_length(btrim(p_merchant_order_id)) not between 1 and 100 then
    return jsonb_build_object('error', 'order_id is required (1 to 100 characters)');
  end if;
  if prov is null or prov not in ('bkash','nagad','rocket','upay') then
    return jsonb_build_object('error', 'provider is required: bkash, nagad, rocket or upay');
  end if;
  if meth is not null and meth not in ('send_money','cash_out') then
    return jsonb_build_object('error', 'method must be send_money or cash_out');
  end if;
  if p_return_url is not null and (p_return_url !~ '^https://' or char_length(p_return_url) > 500 or p_return_url ~ '\s') then
    return jsonb_build_object('error', 'return_url must be an https address');
  end if;
  -- Default 40 minutes, never under 20 (owner 2026-11-04: the paid deposits took 31 minutes on average, the slowest 88,
  -- while orders expired at 15). A site may still ask for up to 60.
  mins := least(greatest(coalesce(p_expires_minutes, 40), 20), 60);

  select * into o from public.orders where api_key_id = kid and merchant_order_id = btrim(p_merchant_order_id);
  if o.id is null then
    wal := null;
    if grp <> 'main' then
      -- a partner's group is created the first time a deposit arrives with a valid code (capped so junk cannot fill the table)
      if grp ~ '^[a-z]{3}[0-9]{4}$' and (select count(*) from public.wallet_groups) < 1000 then
        insert into public.wallet_groups (name) values (grp) on conflict do nothing;
      end if;
      select enabled into g_on from public.wallet_groups where name = grp;
      if coalesce(g_on, false) then
        wal := public.gw_find_wallet_in_group(prov, meth, grp);
        if wal.id is not null then used := grp; end if;
      end if;
    end if;
    if wal.id is null then
      wal := public.gw_find_wallet_in_group(prov, meth, 'main');
      used := 'main';
    end if;
    if wal.id is null then
      -- Logged, so the dashboard can show how many deposits were turned away for want of a number (before this it was invisible).
      insert into public.events(kind, provider, detail)
        values ('deposit_refused_no_wallet', prov, jsonb_build_object('amount', p_amount, 'key_id', kid, 'method', meth, 'group_asked', grp));
      return jsonb_build_object('error', 'no_wallet', 'message', 'no deposit number is set up for ' || prov || coalesce(' / ' || meth, ''));
    end if;
    update public.device_wallets set last_assigned_at = now() where id = wal.id;
    insert into public.orders (order_no, kind, api_key_id, merchant_order_id, expected_amount, customer_name, customer_phone,
                               return_url, expires_at, provider, device_id, wallet_number, wallet_method, wallet_group)
    values ('GW-' || upper(encode(extensions.gen_random_bytes(5), 'hex')), 'deposit', kid, btrim(p_merchant_order_id), p_amount,
            nullif(left(btrim(coalesce(p_customer_name, '')), 80), ''), nullif(left(btrim(coalesce(p_customer_phone, '')), 20), ''),
            p_return_url, now() + mins * interval '1 minute', prov, wal.device_id, wal.wallet_number, wal.method, used)
    returning * into o;
    insert into public.events(kind, order_id, detail)
      values ('deposit_created', o.id, jsonb_build_object('amount', p_amount, 'key_id', kid, 'provider', prov, 'group', used, 'group_asked', grp));
  elsif o.expected_amount <> p_amount then
    return jsonb_build_object('error', 'order_id was already used with a different amount');
  end if;
  return jsonb_build_object('tracking_number', o.tracking_number, 'status', o.status, 'expires_at', o.expires_at,
                            'group', coalesce(o.wallet_group, 'main'));
end $$;revoke all on function public.gw_create_deposit(text,numeric,text,text,text,int,text,text,text,int,text) from public, anon, authenticated;
grant execute on function public.gw_create_deposit(text,numeric,text,text,text,int,text,text,text,int,text) to service_role;

-- ---------- 3. a held payment holds the order that claimed it ----------
-- Finds the order (pending, or expired in the last 24 h) that claimed this held payment's TrxID and marks it review.
-- Returns the order id, or null when there is none. Idempotent: an order already in review is left alone.
create or replace function public.hold_claimed_order(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.payments; o public.orders;
begin
  select * into p from public.payments where id = p_payment_id;
  if p.id is null or p.status <> 'review' then return null; end if;
  select * into o from public.orders
   where claimed_provider = p.provider and claimed_trx_id = p.trx_id
     and (status = 'pending' or (status = 'expired' and expires_at > now() - interval '24 hours'))
   order by (status = 'pending') desc, created_at limit 1 for update;
  if o.id is null then return null; end if;
  update public.orders set status = 'review',
         notes = coalesce(notes || E'\n', '') || 'Held: ' || coalesce(p.review_reason, 'payment held for review')
   where id = o.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('review', p.provider, p.id, o.id, jsonb_build_object('reason', p.review_reason, 'held_on_arrival', true));
  return o.id;
end $$;
revoke all on function public.hold_claimed_order(uuid) from public, anon, authenticated;
grant execute on function public.hold_claimed_order(uuid) to service_role;

-- ---------- 2. reconcile_payment: pending OR recently expired, and inside the order's life ----------
create or replace function public.reconcile_payment(p_payment_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  p public.payments; o public.orders;
  pay_digits text; ord_digits text; k int; ptime timestamptz; reason text;
begin
  select * into p from public.payments where id = p_payment_id;
  if not found then return 'no_payment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.provider || ':' || p.trx_id, 0));
  select * into p from public.payments where id = p_payment_id for update;
  if p.status not in ('unmatched','tracked_only') then return p.status; end if;

  -- The order that claimed this TrxID: still open, or closed by the clock less than a day ago (a late SMS still pays it).
  select * into o from public.orders
   where claimed_provider = p.provider and claimed_trx_id = p.trx_id
     and (status = 'pending' or (status = 'expired' and expires_at > now() - interval '24 hours'))
   order by (status = 'pending') desc, created_at limit 1 for update;
  if not found then return case when p.status = 'unmatched' then 'no_claim' else p.status end; end if;

  -- A Cash Out receipt can only pay an order whose wallet is a Cash Out wallet; everything else stays receipt-only.
  if p.txn_type = 'cash_out' and coalesce(o.wallet_method, '') <> 'cash_out' then return p.status; end if;

  ptime := coalesce(p.occurred_at, p.received_at);
  if p.txn_type = 'cash_out' then
    null; -- allowed: the wallet is a Cash Out wallet (checked above)
  elsif p.txn_type not in ('payment_received','send_money_received') or coalesce(o.wallet_method, 'send_money') = 'cash_out' then
    reason := 'unsupported_type';
  end if;
  if reason is null and p.txn_type = 'cash_out' and p.chain_status = 'mismatch' then
    reason := 'balance_chain_mismatch';
  end if;
  if reason is null and p.amount <> o.expected_amount then
    reason := format('amount_mismatch: received %s expected %s', p.amount, o.expected_amount);
  end if;
  if reason is null and ptime > o.expires_at then
    reason := 'order_expired_before_payment';
  end if;
  -- Paid before the order existed (5 minutes of slack for the provider's clock): an old receipt, maybe somebody else's.
  if reason is null and p.occurred_at is not null and p.occurred_at < o.created_at - interval '5 minutes' then
    reason := 'paid_before_order';
  end if;
  if reason is null and o.device_id is not null and p.device_id is not null and p.device_id <> o.device_id then
    reason := 'wrong_phone';
  end if;
  if reason is null and o.customer_phone is not null and p.counterparty is not null then
    -- compare the visible trailing digits (SMS numbers are often masked)
    pay_digits := substring(p.counterparty from '(\d+)$');
    ord_digits := regexp_replace(o.customer_phone, '\D', '', 'g');
    k := least(coalesce(length(pay_digits), 0), 4);
    if k >= 3 and right(pay_digits, k) <> right(ord_digits, k) then
      reason := 'phone_mismatch';
    end if;
  end if;

  if reason is not null then
    update public.payments set status = 'review', review_reason = reason, order_id = null where id = p.id;
    update public.orders set status = 'review', notes = coalesce(notes || E'\n', '') || 'Held: ' || reason where id = o.id;
    insert into public.events(kind, provider, payment_id, order_id, detail)
      values ('review', p.provider, p.id, o.id, jsonb_build_object('reason', reason, 'was', o.status));
    return 'review';
  end if;

  update public.orders set status = 'paid', payment_id = p.id, paid_at = now() where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('matched', p.provider, p.id, o.id, jsonb_build_object('amount', p.amount, 'late', o.status = 'expired'));
  return 'matched';
end $$;
revoke all on function public.reconcile_payment(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_payment(uuid) to service_role;

-- ---------- 3b. claim_order: a claim on an already-held payment holds the order ----------
-- Same as migration 014 plus the one line after reconcile_payment.
create or replace function public.claim_order(p_order_no text, p_provider text, p_trx_id text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders; pay public.payments; t text := upper(btrim(p_trx_id)); r text;
begin
  if p_provider not in ('bkash','nagad','rocket','upay') or length(t) < 6 then
    return jsonb_build_object('result', 'invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || t, 0));

  select * into o from public.orders where order_no = p_order_no for update;
  if o.id is null then return jsonb_build_object('result', 'order_not_found'); end if;
  if o.status = 'paid' then return jsonb_build_object('result', 'already_paid'); end if;
  if o.status <> 'pending' then return jsonb_build_object('result', o.status); end if;
  if o.expires_at < now() and o.claimed_trx_id is null then
    update public.orders set status = 'expired' where id = o.id;
    return jsonb_build_object('result', 'expired');
  end if;
  if o.claim_attempts >= 5 then return jsonb_build_object('result', 'too_many_attempts'); end if;
  update public.orders set claim_attempts = claim_attempts + 1,
         customer_phone = coalesce(customer_phone, nullif(btrim(p_phone), ''))
   where id = o.id;

  select * into pay from public.payments where provider = p_provider and trx_id = t;
  if pay.id is not null and (pay.status in ('matched','ignored') or (pay.status = 'tracked_only' and coalesce(o.wallet_method, '') <> 'cash_out')) then
    return jsonb_build_object('result', 'payment_already_used');
  end if;

  begin
    update public.orders set claimed_provider = p_provider, claimed_trx_id = t where id = o.id;
  exception when unique_violation then
    return jsonb_build_object('result', 'trx_already_claimed');
  end;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('claim', p_provider, pay.id, o.id, jsonb_build_object('trx_id', t));

  if pay.id is not null then r := public.reconcile_payment(pay.id); else r := 'waiting_for_payment'; end if;
  -- The payment was already held when the customer typed its TrxID: the order must say so too.
  if r = 'review' then perform public.hold_claimed_order(pay.id); end if;
  return jsonb_build_object('result', r);
end $$;
revoke all on function public.claim_order(text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_order(text,text,text,text) to service_role;

-- ---------- 4. manual_match: receipts and recently expired orders ----------
create or replace function public.manual_match(p_payment_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; o public.orders;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into p from public.payments where id = p_payment_id;
  if p.id is null then raise exception 'not found'; end if;
  -- The same lock claim_order and reconcile_payment take, so the three can never run on one TrxID at once.
  perform pg_advisory_xact_lock(hashtextextended(p.provider || ':' || p.trx_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 1));
  select * into p from public.payments where id = p_payment_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if p.id is null or o.id is null then raise exception 'not found'; end if;
  if p.txn_type = 'cash_out' and coalesce(o.wallet_method, '') <> 'cash_out' then
    raise exception 'cash out receipts cannot credit orders';
  end if;
  if p.status not in ('unmatched','review','tracked_only') then raise exception 'payment already %', p.status; end if;
  if o.status not in ('pending','review') and not (o.status = 'expired' and o.expires_at > now() - interval '48 hours') then
    raise exception 'order is %', o.status;
  end if;
  update public.orders set status = 'paid', payment_id = p.id, paid_at = now(),
         claimed_provider = p.provider, claimed_trx_id = p.trx_id where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('manual_match', p.provider, p.id, o.id, jsonb_build_object('by', auth.uid(), 'was', o.status));
  return 'matched';
end $$;
revoke all on function public.manual_match(uuid,uuid) from public, anon;
grant execute on function public.manual_match(uuid,uuid) to authenticated;

-- ---------- 5. ignore_payment closes the order it held ----------
create or replace function public.ignore_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.payments set status = 'ignored' where id = p_payment_id and status in ('unmatched','review') returning * into p;
  insert into public.events(kind, payment_id, detail) values ('ignored', p_payment_id, jsonb_build_object('by', auth.uid()));
  -- A deposit order held only because of this payment gets its final answer (deposit.cancelled) instead of staying "held" forever.
  if p.id is not null then
    update public.orders set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled: the held payment was ignored'
     where kind = 'deposit' and status = 'review' and payment_id is null
       and claimed_provider = p.provider and claimed_trx_id = p.trx_id;
  end if;
end $$;

-- ---------- 6. gw_submit_trx tells why a claim was held ----------
create or replace function public.gw_submit_trx(p_tracking uuid, p_trx text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; r jsonb; why text;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit';
  if o.id is null then return jsonb_build_object('result', 'order_not_found'); end if;
  if o.provider is null or o.wallet_number is null then return jsonb_build_object('result', 'choose_provider'); end if;
  r := public.claim_order(o.order_no, o.provider, p_trx, null);
  if r->>'result' = 'review' then
    select review_reason into why from public.payments where provider = o.provider and trx_id = upper(btrim(p_trx));
    r := r || jsonb_build_object('hold', jsonb_build_object('provider', o.provider, 'amount', o.expected_amount,
                                                             'trx_id', upper(btrim(p_trx)), 'reason', why));
  end if;
  return r;
end $$;
revoke all on function public.gw_submit_trx(uuid,text) from public, anon, authenticated;
grant execute on function public.gw_submit_trx(uuid,text) to service_role;

-- ---------- 7b. per wallet: handed out / typed / paid in the last 24 hours ----------
create or replace view public.wallet_order_stats with (security_invoker = true) as
select o.device_id, o.provider, o.wallet_method, o.wallet_number,
       count(*)::int as orders_24h,
       count(*) filter (where o.claimed_trx_id is not null)::int as typed_24h,
       count(*) filter (where o.status = 'paid')::int as paid_24h,
       count(*) filter (where o.status = 'review')::int as held_24h
  from public.orders o
 where o.kind = 'deposit' and o.created_at > now() - interval '24 hours' and o.device_id is not null
 group by o.device_id, o.provider, o.wallet_method, o.wallet_number;
grant select on public.wallet_order_stats to authenticated;
