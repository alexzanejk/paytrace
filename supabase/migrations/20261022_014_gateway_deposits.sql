-- Deposit gateway: a website creates an order through the API, sends the customer to a hosted pay page, the customer
-- pays the shown wallet number and submits the TrxID, and PayTrace credits the order from the SMS it already captured.
-- Crediting still goes ONLY through reconcile_payment / claim_order / manual_match (advisory lock, one payment per order).

-- ============ Wallets: which phone receives which provider, on which number ============
create table if not exists public.device_wallets (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  provider text not null check (provider in ('bkash','nagad','rocket','upay')),
  wallet_number text not null check (wallet_number ~ '^[0-9]{10,13}$'),
  -- how the customer pays this number: Send Money, or Cash Out at an agent number
  method text not null check (method in ('send_money','cash_out')),
  enabled boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (device_id, provider)
);
alter table public.device_wallets enable row level security;
revoke all on public.device_wallets from anon, authenticated;
grant select on public.device_wallets to authenticated;
create policy device_wallets_read on public.device_wallets for select to authenticated using (public.is_admin());

create or replace function public.set_device_wallet(p_device_id uuid, p_provider text, p_number text, p_method text, p_enabled boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare n text := regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('bkash','nagad','rocket','upay') then raise exception 'unknown provider'; end if;
  if p_method not in ('send_money','cash_out') then raise exception 'method must be send_money or cash_out'; end if;
  if n !~ '^[0-9]{10,13}$' then raise exception 'enter the wallet number, digits only (10 to 13 digits)'; end if;
  if not exists (select 1 from public.devices where id = p_device_id and status = 'approved') then
    raise exception 'phone not found or not approved';
  end if;
  insert into public.device_wallets (device_id, provider, wallet_number, method, enabled)
    values (p_device_id, p_provider, n, p_method, coalesce(p_enabled, true))
  on conflict (device_id, provider) do update
    set wallet_number = excluded.wallet_number, method = excluded.method, enabled = excluded.enabled;
  insert into public.events(kind, provider, detail)
    values ('wallet_set', p_provider, jsonb_build_object('device_id', p_device_id, 'method', p_method, 'enabled', coalesce(p_enabled, true), 'by', auth.uid()));
end $$;

revoke all on function public.set_device_wallet(uuid,text,text,text,boolean) from public, anon;
grant execute on function public.set_device_wallet(uuid,text,text,text,boolean) to authenticated;

-- ============ Orders: gateway columns ============
alter table public.orders
  add column if not exists kind text not null default 'manual' check (kind in ('manual','deposit')),
  add column if not exists tracking_number uuid not null default gen_random_uuid(),
  add column if not exists api_key_id uuid references public.api_keys(id),
  add column if not exists merchant_order_id text check (merchant_order_id is null or char_length(merchant_order_id) between 1 and 100),
  add column if not exists currency text not null default 'BDT',
  add column if not exists provider text check (provider in ('bkash','nagad','rocket','upay')),
  add column if not exists device_id uuid references public.devices(id),
  add column if not exists wallet_number text,
  add column if not exists wallet_method text check (wallet_method in ('send_money','cash_out')),
  add column if not exists return_url text check (return_url is null or (return_url ~ '^https://' and char_length(return_url) <= 500));
create unique index if not exists orders_tracking_idx on public.orders (tracking_number);
-- a website's own order number can create only one order (this makes "create" safe to retry)
create unique index if not exists orders_merchant_idx on public.orders (api_key_id, merchant_order_id)
  where merchant_order_id is not null;

-- ============ Keys: where to send the result ============
alter table public.api_keys
  add column if not exists webhook_url text check (webhook_url is null or (webhook_url ~ '^https://' and char_length(webhook_url) <= 500)),
  add column if not exists webhook_secret text;
-- webhook_url / webhook_secret are NOT in the column grant on api_keys, so the dashboard cannot read them.

-- Sets (or clears) the address the result is sent to. Returns the signing secret once, when one is made.
create or replace function public.set_key_webhook(p_id uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u text := nullif(btrim(coalesce(p_url, '')), ''); host text; k public.api_keys; s text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into k from public.api_keys where id = p_id and revoked_at is null;
  if k.id is null then raise exception 'key not found or revoked'; end if;
  if u is null then
    update public.api_keys set webhook_url = null, webhook_secret = null where id = p_id;
    return jsonb_build_object('webhook_url', null);
  end if;
  if u !~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^\s]*)?$' or char_length(u) > 500 then
    raise exception 'the address must start with https:// and have no spaces';
  end if;
  host := lower(substring(u from '^https://([^/:]+)'));
  if host = 'localhost' or host ~ '^[0-9.]+$' or host !~ '\.' or host ~ '\.(local|internal|localhost)$' then
    raise exception 'use a public website address, not an IP address or a local name';
  end if;
  s := coalesce(k.webhook_secret, 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex'));
  update public.api_keys set webhook_url = u, webhook_secret = s where id = p_id;
  insert into public.events(kind, detail) values ('webhook_set', jsonb_build_object('key_id', p_id, 'by', auth.uid()));
  -- the secret is returned only when it is first made
  return jsonb_build_object('webhook_url', u, 'secret', case when k.webhook_secret is null then s else null end);
end $$;
revoke all on function public.set_key_webhook(uuid,text) from public, anon;
grant execute on function public.set_key_webhook(uuid,text) to authenticated;

-- ============ Result messages to the websites (outbox, retried) ============
create table if not exists public.webhook_outbox (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  gave_up_at timestamptz,
  last_status text
);
create index if not exists webhook_outbox_due_idx on public.webhook_outbox (next_attempt_at)
  where delivered_at is null and gave_up_at is null;
alter table public.webhook_outbox enable row level security;
revoke all on public.webhook_outbox from anon, authenticated;
grant select (id, order_id, event, created_at, attempts, delivered_at, gave_up_at, last_status) on public.webhook_outbox to authenticated;
create policy webhook_outbox_read on public.webhook_outbox for select to authenticated using (public.is_admin());

create or replace function public.order_payload(o public.orders)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'tracking_number', o.tracking_number,
    'order_id', o.merchant_order_id,
    'status', case o.status when 'pending' then 'pending' when 'paid' then 'paid' when 'review' then 'review'
                            when 'expired' then 'expired' else 'cancelled' end,
    'amount', o.expected_amount,
    'currency', o.currency,
    'provider', o.provider,
    'trx_id', o.claimed_trx_id,
    'paid_at', o.paid_at
  );
$$;

create or replace function public.orders_enqueue_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'deposit' and new.status is distinct from old.status and new.status in ('paid','review','expired','cancelled')
     and exists (select 1 from public.api_keys k where k.id = new.api_key_id and k.webhook_url is not null) then
    insert into public.webhook_outbox (order_id, event, payload)
      values (new.id, 'deposit.' || new.status, public.order_payload(new));
  end if;
  return new;
end $$;
create trigger orders_webhook_trg after update of status on public.orders
  for each row execute function public.orders_enqueue_webhook();

-- The delivery worker (gateway function, once a minute and right after a match).
-- Leases due rows for 2 minutes so two workers never send the same message.
create or replace function public.gw_claim_webhooks(p_limit int default 20)
returns table (id bigint, url text, secret text, event text, body jsonb, attempts int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select w.id from public.webhook_outbox w
     where w.delivered_at is null and w.gave_up_at is null and w.next_attempt_at <= now()
     order by w.next_attempt_at limit p_limit for update skip locked
  ), leased as (
    update public.webhook_outbox w set next_attempt_at = now() + interval '2 minutes'
     where w.id in (select due.id from due) returning w.id, w.order_id, w.event, w.payload, w.attempts
  )
  select l.id, k.webhook_url, k.webhook_secret, l.event, l.payload, l.attempts
    from leased l join public.orders o on o.id = l.order_id
    join public.api_keys k on k.id = o.api_key_id
   where k.webhook_url is not null;
end $$;

create or replace function public.gw_webhook_result(p_id bigint, p_ok boolean, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare a int;
begin
  if p_ok then
    update public.webhook_outbox set delivered_at = now(), attempts = attempts + 1, last_status = left(p_status, 60) where id = p_id;
    return;
  end if;
  update public.webhook_outbox set attempts = attempts + 1, last_status = left(p_status, 60) where id = p_id returning attempts into a;
  if a >= 8 then
    update public.webhook_outbox set gave_up_at = now() where id = p_id;
  else
    -- 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h
    update public.webhook_outbox set next_attempt_at = now() + (array[1,5,15,60,180,360,720])[least(a, 7)] * interval '1 minute' where id = p_id;
  end if;
end $$;

-- Owner can re-send a result that was given up on.
create or replace function public.retry_webhook(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.webhook_outbox set gave_up_at = null, next_attempt_at = now(), attempts = least(attempts, 7)
   where id = p_id and delivered_at is null;
end $$;
revoke all on function public.retry_webhook(bigint) from public, anon;
grant execute on function public.retry_webhook(bigint) to authenticated;

-- ============ Matching: cash-out receipts and the right phone ============
-- Same rules as before, plus: (1) an order whose wallet is paid by Cash Out can be credited by a Cash Out receipt, but
-- not when the balance chain does not add up (held for review instead); (2) a payment that arrived on a different phone
-- than the wallet the customer was shown is held for review.
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

  select * into o from public.orders
   where claimed_provider = p.provider and claimed_trx_id = p.trx_id and status = 'pending'
   order by created_at limit 1 for update;
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
      values ('review', p.provider, p.id, o.id, jsonb_build_object('reason', reason));
    return 'review';
  end if;

  update public.orders set status = 'paid', payment_id = p.id, paid_at = now() where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('matched', p.provider, p.id, o.id, jsonb_build_object('amount', p.amount));
  return 'matched';
end $$;
revoke all on function public.reconcile_payment(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_payment(uuid) to service_role;

-- Manual approval: a held Cash Out receipt may pay a Cash Out deposit order (and nothing else).
create or replace function public.manual_match(p_payment_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; o public.orders;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 1));
  select * into p from public.payments where id = p_payment_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if p.id is null or o.id is null then raise exception 'not found'; end if;
  if p.txn_type = 'cash_out' and coalesce(o.wallet_method, '') <> 'cash_out' then
    raise exception 'cash out receipts cannot credit orders';
  end if;
  if p.status not in ('unmatched','review') then raise exception 'payment already %', p.status; end if;
  if o.status not in ('pending','review') then raise exception 'order is %', o.status; end if;
  update public.orders set status = 'paid', payment_id = p.id, paid_at = now(),
         claimed_provider = p.provider, claimed_trx_id = p.trx_id where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('manual_match', p.provider, p.id, o.id, jsonb_build_object('by', auth.uid()));
  return 'matched';
end $$;
revoke all on function public.manual_match(uuid,uuid) from public, anon;
grant execute on function public.manual_match(uuid,uuid) to authenticated;

-- NOTE: the Supabase MCP tool used to apply migrations hangs on statements containing DROP or DELETE, so none are used here.
-- ============ Gateway functions (called only by the gateway Edge Function, with the service key) ============

-- A website creates a deposit order. Safe to retry: the same order_id returns the same order.
create or replace function public.gw_create_deposit(
  p_key_hash text, p_amount numeric, p_merchant_order_id text, p_provider text,
  p_expires_minutes int, p_customer_name text, p_customer_phone text, p_return_url text, p_limit int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders; mins int; prov text := nullif(btrim(p_provider), '');
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  update public.api_keys set last_used_at = now() where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;

  if p_amount is null or p_amount < 10 or p_amount > 500000 or p_amount <> round(p_amount, 2) then
    return jsonb_build_object('error', 'amount must be between 10 and 500000, with at most 2 decimals');
  end if;
  if p_merchant_order_id is null or char_length(btrim(p_merchant_order_id)) not between 1 and 100 then
    return jsonb_build_object('error', 'order_id is required (1 to 100 characters)');
  end if;
  if prov is not null and prov not in ('bkash','nagad','rocket','upay') then
    return jsonb_build_object('error', 'provider must be bkash, nagad, rocket or upay');
  end if;
  if p_return_url is not null and (p_return_url !~ '^https://' or char_length(p_return_url) > 500 or p_return_url ~ '\s') then
    return jsonb_build_object('error', 'return_url must be an https address');
  end if;
  mins := least(greatest(coalesce(p_expires_minutes, 15), 3), 60);

  select * into o from public.orders where api_key_id = kid and merchant_order_id = btrim(p_merchant_order_id);
  if o.id is null then
    insert into public.orders (order_no, kind, api_key_id, merchant_order_id, expected_amount, customer_name, customer_phone,
                               return_url, expires_at, provider)
    values ('GW-' || upper(encode(extensions.gen_random_bytes(5), 'hex')), 'deposit', kid, btrim(p_merchant_order_id), p_amount,
            nullif(left(btrim(coalesce(p_customer_name, '')), 80), ''), nullif(left(btrim(coalesce(p_customer_phone, '')), 20), ''),
            p_return_url, now() + mins * interval '1 minute', prov)
    returning * into o;
    insert into public.events(kind, order_id, detail) values ('deposit_created', o.id, jsonb_build_object('amount', p_amount, 'key_id', kid));
  elsif o.expected_amount <> p_amount then
    return jsonb_build_object('error', 'order_id was already used with a different amount');
  end if;
  return jsonb_build_object('tracking_number', o.tracking_number, 'status', o.status, 'expires_at', o.expires_at);
end $$;

-- What the customer's page shows. Nothing private: no key, no phone ids.
create or replace function public.gw_order_view(p_tracking uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; shop text; provs jsonb; left_sec int; grace interval;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit';
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  grace := case when o.claimed_trx_id is null then interval '0 minutes' else interval '10 minutes' end;
  if o.status = 'pending' and o.expires_at < now() - grace then
    update public.orders set status = 'expired' where id = o.id returning * into o;
  end if;
  select name into shop from public.api_keys where id = o.api_key_id;
  select coalesce(jsonb_agg(distinct w.provider), '[]'::jsonb) into provs
    from public.device_wallets w join public.devices d on d.id = w.device_id
   where w.enabled and d.status = 'approved';
  left_sec := greatest(0, floor(extract(epoch from (o.expires_at - now()))))::int;
  return jsonb_build_object(
    'status', o.status, 'amount', o.expected_amount, 'currency', o.currency, 'shop', shop,
    'provider', o.provider, 'wallet_number', o.wallet_number, 'method', o.wallet_method,
    'seconds_left', left_sec, 'trx_id', o.claimed_trx_id, 'providers', provs,
    'return_url', case when o.status = 'paid' then o.return_url else null end,
    'merchant_order_id', o.merchant_order_id
  );
end $$;

-- The customer picks a provider; they are shown a wallet number from an approved phone that has one.
-- Phones that are online come first; ties rotate (least recently handed out).
create or replace function public.gw_pick_wallet(p_tracking uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; w public.device_wallets;
begin
  if p_provider not in ('bkash','nagad','rocket','upay') then return jsonb_build_object('error', 'bad_provider'); end if;
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit' for update;
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if o.status <> 'pending' or o.expires_at < now() then return jsonb_build_object('error', 'not_open'); end if;
  if o.claimed_trx_id is not null then return jsonb_build_object('error', 'already_claimed'); end if;
  if o.provider = p_provider and o.wallet_number is not null then
    return public.gw_order_view(p_tracking); -- refreshing the page must not change the number
  end if;
  select w2.* into w
    from public.device_wallets w2 join public.devices d on d.id = w2.device_id
   where w2.provider = p_provider and w2.enabled and d.status = 'approved'
   order by (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds') desc,
            w2.last_assigned_at asc nulls first
   limit 1 for update of w2;
  if w.id is null then return jsonb_build_object('error', 'no_wallet'); end if;
  update public.device_wallets set last_assigned_at = now() where id = w.id;
  update public.orders set provider = p_provider, device_id = w.device_id, wallet_number = w.wallet_number, wallet_method = w.method
   where id = o.id;
  return public.gw_order_view(p_tracking);
end $$;

-- The customer submits the TrxID. Uses claim_order, so it is the same safe path as before (5 tries, one claim per TrxID).
create or replace function public.gw_submit_trx(p_tracking uuid, p_trx text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; r jsonb;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit';
  if o.id is null then return jsonb_build_object('result', 'order_not_found'); end if;
  if o.provider is null or o.wallet_number is null then return jsonb_build_object('result', 'choose_provider'); end if;
  r := public.claim_order(o.order_no, o.provider, p_trx, null);
  return r;
end $$;

-- Expire open orders nobody paid (a claimed one gets 10 more minutes in case the SMS is late). Returns how many.
create or replace function public.gw_expire_due()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with x as (
    update public.orders set status = 'expired'
     where kind = 'deposit' and status = 'pending'
       and expires_at < now() - case when claimed_trx_id is null then interval '0 minutes' else interval '10 minutes' end
    returning 1)
  select count(*) into n from x;
  return n;
end $$;

revoke all on function public.order_payload(public.orders) from public, anon, authenticated;
revoke all on function public.orders_enqueue_webhook() from public, anon, authenticated;
revoke all on function public.gw_claim_webhooks(int) from public, anon, authenticated;
revoke all on function public.gw_webhook_result(bigint,boolean,text) from public, anon, authenticated;
revoke all on function public.gw_create_deposit(text,numeric,text,text,int,text,text,text,int) from public, anon, authenticated;
revoke all on function public.gw_order_view(uuid) from public, anon, authenticated;
revoke all on function public.gw_pick_wallet(uuid,text) from public, anon, authenticated;
revoke all on function public.gw_submit_trx(uuid,text) from public, anon, authenticated;
revoke all on function public.gw_expire_due() from public, anon, authenticated;
grant execute on function public.gw_claim_webhooks(int), public.gw_webhook_result(bigint,boolean,text),
  public.gw_create_deposit(text,numeric,text,text,int,text,text,text,int), public.gw_order_view(uuid),
  public.gw_pick_wallet(uuid,text), public.gw_submit_trx(uuid,text), public.gw_expire_due() to service_role;

-- ============ claim_order: a stored Cash Out receipt can pay a Cash Out wallet's order ============
-- (earlier versions answered "payment_already_used" for every tracked_only receipt). Also lets a customer who already
-- submitted a TrxID correct it during the 10-minute grace after the order's time is up.
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
  return jsonb_build_object('result', r);
end $$;
revoke all on function public.claim_order(text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_order(text,text,text,text) to service_role;

-- ============ Merchant: look up one of its own orders (by tracking number or its own order id) ============
create or replace function public.gw_merchant_order(p_key_hash text, p_tracking uuid, p_merchant_order_id text, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders;
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  update public.api_keys set last_used_at = now() where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;
  if p_tracking is not null then
    select * into o from public.orders where api_key_id = kid and tracking_number = p_tracking;
  else
    select * into o from public.orders where api_key_id = kid and merchant_order_id = btrim(coalesce(p_merchant_order_id, ''));
  end if;
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  return public.order_payload(o) || jsonb_build_object('expires_at', o.expires_at);
end $$;
revoke all on function public.gw_merchant_order(text,uuid,text,int) from public, anon, authenticated;
grant execute on function public.gw_merchant_order(text,uuid,text,int) to service_role;

-- ============ Once a minute: send waiting result messages to the websites and close unpaid orders ============
-- (applied as its own migration; needs the gateway Edge Function deployed with verify_jwt=false)
select cron.schedule(
  'paytrace-gateway-deliver',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/gateway/deliver',
       body := '{}'::jsonb
     ); $$
);

-- The dashboard may show WHERE a key's results go (not the signing secret, which no column grant allows).
grant select (webhook_url) on public.api_keys to authenticated;
