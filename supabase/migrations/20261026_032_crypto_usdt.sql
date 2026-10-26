-- USDT deposits on BNB Smart Chain (BEP20) and TRON (TRC20), checked automatically from the blockchain (owner request 2026-10-26).
-- No phone is involved. The owner enters the receiving address and a Tk-per-USDT rate on the dashboard's Crypto page. A website creates a deposit
-- in TAKA with provider usdt_bep20 or usdt_trc20; PayTrace converts it to USDT and adds a tiny unique tail (0.0001 to 0.0099 USDT) so that every open
-- order on a chain has its own exact amount. The `crypto-watch` Edge Function reads incoming USDT transfers (once a minute) and `crypto_settle` pays the
-- order whose exact amount arrived. Anything that matches nothing waits in the Crypto page for the owner. Only public addresses are stored: never keys.
-- The provider checks on `orders` were widened by hand before this file ran (drop constraint hangs the migration tool); they are repeated here for replay.
-- No other DROP/DELETE statements.

alter table public.orders drop constraint if exists orders_provider_check;
alter table public.orders add constraint orders_provider_check check (provider = any (array['bkash','nagad','rocket','upay','usdt_bep20','usdt_trc20']));

-- ============ Settings (one row) ============
create table if not exists public.crypto_settings (
  id boolean primary key default true check (id),
  taka_per_usdt numeric(10, 4) check (taka_per_usdt is null or taka_per_usdt > 0),
  order_minutes int not null default 30 check (order_minutes between 10 and 120),
  bep20_enabled boolean not null default false,
  bep20_address text check (bep20_address is null or bep20_address ~ '^0x[0-9a-fA-F]{40}$'),
  bep20_block bigint,   -- last block already scanned (server only)
  trc20_enabled boolean not null default false,
  trc20_address text check (trc20_address is null or trc20_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  trc20_since bigint,   -- time (ms) of the newest TRC20 transfer already seen (server only)
  updated_at timestamptz not null default now()
);
insert into public.crypto_settings (id) values (true) on conflict do nothing;
alter table public.crypto_settings enable row level security;
revoke all on public.crypto_settings from anon, authenticated;
grant select (id, taka_per_usdt, order_minutes, bep20_enabled, bep20_address, bep20_block, trc20_enabled, trc20_address, trc20_since, updated_at)
  on public.crypto_settings to authenticated;
create policy crypto_settings_read on public.crypto_settings for select to authenticated using (public.is_admin());

create or replace function public.set_crypto_settings(
  p_taka_per_usdt numeric, p_order_minutes int,
  p_bep20_enabled boolean, p_bep20_address text, p_trc20_enabled boolean, p_trc20_address text
) returns void language plpgsql security definer set search_path = public as $$
declare
  s public.crypto_settings;
  b text := nullif(btrim(coalesce(p_bep20_address, '')), '');
  t text := nullif(btrim(coalesce(p_trc20_address, '')), '');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_taka_per_usdt is not null and (p_taka_per_usdt <= 0 or p_taka_per_usdt > 100000) then raise exception 'enter the rate in taka for 1 USDT, for example 125'; end if;
  if p_order_minutes is null or p_order_minutes not between 10 and 120 then raise exception 'payment time must be 10 to 120 minutes'; end if;
  if b is not null and b !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'the BEP20 address must start with 0x and have 42 characters'; end if;
  if t is not null and t !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then raise exception 'the TRC20 address must start with T and have 34 characters'; end if;
  if (coalesce(p_bep20_enabled, false) or coalesce(p_trc20_enabled, false)) and (p_taka_per_usdt is null) then raise exception 'set the rate before switching a network on'; end if;
  if coalesce(p_bep20_enabled, false) and b is null then raise exception 'enter the BEP20 address first'; end if;
  if coalesce(p_trc20_enabled, false) and t is null then raise exception 'enter the TRC20 address first'; end if;
  select * into s from public.crypto_settings where id;
  update public.crypto_settings set
    taka_per_usdt = p_taka_per_usdt, order_minutes = p_order_minutes,
    bep20_enabled = coalesce(p_bep20_enabled, false), bep20_address = b,
    -- a new address (or switching on again) starts scanning from "now": old transfers are not interesting
    bep20_block = case when b is distinct from s.bep20_address or (coalesce(p_bep20_enabled, false) and not s.bep20_enabled) then null else s.bep20_block end,
    trc20_enabled = coalesce(p_trc20_enabled, false), trc20_address = t,
    trc20_since = case when t is distinct from s.trc20_address or (coalesce(p_trc20_enabled, false) and not s.trc20_enabled) then null else s.trc20_since end,
    updated_at = now()
   where id;
  insert into public.events(kind, detail) values ('crypto_settings_set', jsonb_build_object('by', auth.uid(), 'rate', p_taka_per_usdt,
    'bep20', coalesce(p_bep20_enabled, false), 'trc20', coalesce(p_trc20_enabled, false)));
end $$;
revoke all on function public.set_crypto_settings(numeric, int, boolean, text, boolean, text) from public, anon;
grant execute on function public.set_crypto_settings(numeric, int, boolean, text, boolean, text) to authenticated;

-- ============ What the blockchain showed us ============
create table if not exists public.crypto_transfers (
  id uuid primary key default gen_random_uuid(),
  chain text not null check (chain in ('bep20', 'trc20')),
  tx_hash text not null,
  log_index int not null default 0,
  from_address text,
  to_address text not null,
  amount numeric(38, 18) not null check (amount > 0),
  block_number bigint,
  block_time timestamptz not null,
  status text not null default 'new' check (status in ('new', 'matched', 'review', 'ignored')),
  review_reason text,
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  unique (chain, tx_hash, log_index)
);
create index if not exists crypto_transfers_time_idx on public.crypto_transfers (block_time desc);
create index if not exists crypto_transfers_order_idx on public.crypto_transfers (order_id);
alter table public.crypto_transfers enable row level security;
revoke all on public.crypto_transfers from anon, authenticated;
grant select on public.crypto_transfers to authenticated;
create policy crypto_transfers_read on public.crypto_transfers for select to authenticated using (public.is_admin());

-- ============ Orders: the crypto fields ============
alter table public.orders
  add column if not exists crypto_chain text check (crypto_chain is null or crypto_chain in ('bep20', 'trc20')),
  add column if not exists crypto_amount numeric(18, 4),
  add column if not exists crypto_address text,
  add column if not exists crypto_rate numeric(10, 4),
  add column if not exists crypto_tx_hash text;
-- two open orders on one network can never ask for the same exact amount
create unique index if not exists orders_crypto_open_amount_idx on public.orders (crypto_chain, crypto_amount)
  where crypto_chain is not null and status in ('pending', 'review');

-- the website's view of an order (status check and webhook) also says which chain and amount, and the transaction hash once paid
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
    'trx_id', coalesce(o.claimed_trx_id, o.crypto_tx_hash),
    'paid_at', o.paid_at
  ) || case when o.crypto_chain is null then '{}'::jsonb
            else jsonb_build_object('crypto', jsonb_build_object('chain', o.crypto_chain, 'asset', 'USDT', 'amount', o.crypto_amount, 'address', o.crypto_address)) end;
$$;

-- ============ A website creates a crypto deposit (amount in taka) ============
create or replace function public.gw_create_crypto_deposit(
  p_key_hash text, p_amount numeric, p_merchant_order_id text, p_provider text,
  p_expires_minutes int, p_customer_name text, p_customer_phone text, p_return_url text, p_limit int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders; s public.crypto_settings;
  chain text := case p_provider when 'usdt_bep20' then 'bep20' when 'usdt_trc20' then 'trc20' else null end;
  addr text; base numeric; amt numeric; k int; start_k int; mins int; ok boolean;
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  update public.api_keys set last_used_at = now() where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;

  if chain is null then return jsonb_build_object('error', 'provider must be usdt_bep20 or usdt_trc20'); end if;
  if p_amount is null or p_amount < 500 or p_amount > 50000 or p_amount <> round(p_amount, 2) then
    return jsonb_build_object('error', 'amount must be between 500 and 50000 taka, with at most 2 decimals');
  end if;
  if p_merchant_order_id is null or char_length(btrim(p_merchant_order_id)) not between 1 and 100 then
    return jsonb_build_object('error', 'order_id is required (1 to 100 characters)');
  end if;
  if p_return_url is not null and (p_return_url !~ '^https://' or char_length(p_return_url) > 500 or p_return_url ~ '\s') then
    return jsonb_build_object('error', 'return_url must be an https address');
  end if;

  select * into o from public.orders where api_key_id = kid and merchant_order_id = btrim(p_merchant_order_id);
  if o.id is not null then
    if o.expected_amount <> p_amount then return jsonb_build_object('error', 'order_id was already used with a different amount'); end if;
    return jsonb_build_object('tracking_number', o.tracking_number, 'status', o.status, 'expires_at', o.expires_at,
                              'crypto', jsonb_build_object('chain', o.crypto_chain, 'asset', 'USDT', 'amount', o.crypto_amount, 'address', o.crypto_address));
  end if;

  select * into s from public.crypto_settings where id;
  addr := case chain when 'bep20' then s.bep20_address else s.trc20_address end;
  if s.taka_per_usdt is null or addr is null or not (case chain when 'bep20' then s.bep20_enabled else s.trc20_enabled end) then
    return jsonb_build_object('error', 'no_wallet', 'message', p_provider || ' deposits are not switched on');
  end if;

  mins := least(greatest(coalesce(p_expires_minutes, s.order_minutes), 3), 120);
  base := ceil(p_amount / s.taka_per_usdt * 100) / 100;  -- USDT, rounded UP to 2 decimals so the shop is never short
  -- add a unique tail of 0.0001 to 0.0099 USDT: pick the first free one, starting somewhere random
  start_k := 1 + floor(random() * 99)::int;
  ok := false;
  for i in 0..98 loop
    k := 1 + mod(start_k - 1 + i, 99);
    amt := base + k / 10000.0;
    if not exists (select 1 from public.orders where crypto_chain = chain and crypto_amount = amt and status in ('pending', 'review')) then
      ok := true; exit;
    end if;
  end loop;
  if not ok then return jsonb_build_object('error', 'busy', 'message', 'too many open crypto orders for this amount, try again in a few minutes'); end if;

  insert into public.orders (order_no, kind, api_key_id, merchant_order_id, expected_amount, customer_name, customer_phone, return_url, expires_at,
                             provider, wallet_number, crypto_chain, crypto_amount, crypto_address, crypto_rate)
  values ('GW-' || upper(encode(extensions.gen_random_bytes(5), 'hex')), 'deposit', kid, btrim(p_merchant_order_id), p_amount,
          nullif(left(btrim(coalesce(p_customer_name, '')), 80), ''), nullif(left(btrim(coalesce(p_customer_phone, '')), 20), ''),
          p_return_url, now() + mins * interval '1 minute', p_provider, addr, chain, amt, addr, s.taka_per_usdt)
  returning * into o;
  insert into public.events(kind, order_id, detail)
    values ('deposit_created', o.id, jsonb_build_object('amount', p_amount, 'key_id', kid, 'provider', p_provider, 'usdt', amt, 'rate', s.taka_per_usdt));
  return jsonb_build_object('tracking_number', o.tracking_number, 'status', o.status, 'expires_at', o.expires_at,
                            'crypto', jsonb_build_object('chain', chain, 'asset', 'USDT', 'amount', amt, 'address', addr));
end $$;
revoke all on function public.gw_create_crypto_deposit(text, numeric, text, text, int, text, text, text, int) from public, anon, authenticated;
grant execute on function public.gw_create_crypto_deposit(text, numeric, text, text, int, text, text, text, int) to service_role;

-- ============ What the customer's page shows ============
create or replace function public.gw_order_view(p_tracking uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; shop text; provs jsonb; left_sec int; grace interval; sty int; ok_url text; bad_url text;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit';
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  grace := case when o.claimed_trx_id is null then interval '0 minutes' else interval '10 minutes' end;
  if o.status = 'pending' and o.expires_at < now() - grace then
    update public.orders set status = 'expired' where id = o.id returning * into o;
  end if;
  select name, coalesce(result_style, mod(abs(hashtext(id::text)), 6)), redirect_success_url, redirect_failed_url into shop, sty, ok_url, bad_url
    from public.api_keys where id = o.api_key_id;
  select coalesce(jsonb_agg(distinct w.provider), '[]'::jsonb) into provs
    from public.device_wallets w join public.devices d on d.id = w.device_id
   where w.enabled and d.status = 'approved';
  left_sec := greatest(0, floor(extract(epoch from (o.expires_at - now()))))::int;
  return jsonb_build_object(
    'status', o.status, 'amount', o.expected_amount, 'currency', o.currency, 'shop', shop,
    'provider', o.provider, 'wallet_number', o.wallet_number, 'method', o.wallet_method,
    'seconds_left', left_sec, 'trx_id', coalesce(o.claimed_trx_id, o.crypto_tx_hash), 'providers', provs,
    'return_url', case when o.status = 'paid' then coalesce(o.return_url, ok_url) else null end,
    'failed_url', case when o.status in ('expired', 'cancelled') then bad_url else null end,
    'merchant_order_id', o.merchant_order_id, 'result_style', coalesce(sty, 0),
    'crypto', case when o.crypto_chain is null then null
                   else jsonb_build_object('chain', o.crypto_chain, 'asset', 'USDT', 'amount', o.crypto_amount, 'address', o.crypto_address) end
  );
end $$;
revoke all on function public.gw_order_view(uuid) from public, anon, authenticated;
grant execute on function public.gw_order_view(uuid) to service_role;

-- ============ Matching a transfer to an order ============
-- The exact amount decides. The transfer must have been made while the order was open (it may be processed a little later).
create or replace function public.crypto_settle(p_transfer uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t public.crypto_transfers; o public.orders;
begin
  select * into t from public.crypto_transfers where id = p_transfer;
  if t.id is null then return 'no_transfer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crypto:' || t.chain || ':' || t.tx_hash, 0));
  select * into t from public.crypto_transfers where id = p_transfer for update;
  if t.status <> 'new' then return t.status; end if;

  select * into o from public.orders
   where kind = 'deposit' and crypto_chain = t.chain and crypto_amount = t.amount
     and status in ('pending', 'expired')
     and t.block_time >= created_at - interval '2 minutes' and t.block_time <= expires_at
   order by created_at desc limit 1 for update;
  if o.id is null then
    update public.crypto_transfers set status = 'review', review_reason = 'no open order with this exact amount' where id = t.id;
    insert into public.events(kind, detail) values ('crypto_unmatched', jsonb_build_object('transfer_id', t.id, 'chain', t.chain, 'amount', t.amount, 'tx', t.tx_hash));
    return 'review';
  end if;

  update public.orders set status = 'paid', paid_at = now(), crypto_tx_hash = t.tx_hash where id = o.id;
  update public.crypto_transfers set status = 'matched', order_id = o.id, review_reason = null where id = t.id;
  insert into public.events(kind, provider, order_id, detail)
    values ('matched', o.provider, o.id, jsonb_build_object('usdt', t.amount, 'tx', t.tx_hash, 'chain', t.chain));
  return 'matched';
end $$;
revoke all on function public.crypto_settle(uuid) from public, anon, authenticated;
grant execute on function public.crypto_settle(uuid) to service_role;

-- The watcher reports every incoming USDT transfer here. Idempotent. Only the owner's own receiving address counts.
create or replace function public.crypto_ingest(
  p_chain text, p_tx text, p_log int, p_from text, p_to text, p_amount text, p_block bigint, p_time timestamptz
) returns text language plpgsql security definer set search_path = public as $$
declare s public.crypto_settings; mine text; amt numeric; tid uuid;
begin
  if p_chain not in ('bep20', 'trc20') then return 'bad_chain'; end if;
  select * into s from public.crypto_settings where id;
  mine := case p_chain when 'bep20' then s.bep20_address else s.trc20_address end;
  if mine is null or not (case p_chain when 'bep20' then s.bep20_enabled else s.trc20_enabled end) then return 'off'; end if;
  if (p_chain = 'bep20' and lower(p_to) <> lower(mine)) or (p_chain = 'trc20' and p_to <> mine) then return 'not_mine'; end if;
  begin amt := p_amount::numeric; exception when others then return 'bad_amount'; end;
  if amt is null or amt < 0.01 or amt > 100000000 then return 'ignored_size'; end if; -- dust, including "address poisoning" spam
  if p_tx !~ '^(0x)?[0-9a-fA-F]{64}$' then return 'bad_tx'; end if;
  insert into public.crypto_transfers (chain, tx_hash, log_index, from_address, to_address, amount, block_number, block_time)
    values (p_chain, p_tx, coalesce(p_log, 0), left(p_from, 80), left(p_to, 80), amt, p_block, p_time)
  on conflict (chain, tx_hash, log_index) do nothing returning id into tid;
  if tid is null then return 'seen'; end if;
  return public.crypto_settle(tid);
end $$;
revoke all on function public.crypto_ingest(text, text, int, text, text, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.crypto_ingest(text, text, int, text, text, text, bigint, timestamptz) to service_role;

create or replace function public.crypto_set_cursor(p_chain text, p_value bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_chain = 'bep20' then update public.crypto_settings set bep20_block = greatest(coalesce(bep20_block, 0), p_value) where id;
  elsif p_chain = 'trc20' then update public.crypto_settings set trc20_since = greatest(coalesce(trc20_since, 0), p_value) where id;
  end if;
end $$;
revoke all on function public.crypto_set_cursor(text, bigint) from public, anon, authenticated;
grant execute on function public.crypto_set_cursor(text, bigint) to service_role;

-- ============ The owner's hands: pay an order from a transfer by hand, or set a transfer aside ============
create or replace function public.crypto_manual_match(p_transfer uuid, p_order uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t public.crypto_transfers; o public.orders;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into t from public.crypto_transfers where id = p_transfer for update;
  select * into o from public.orders where id = p_order for update;
  if t.id is null or o.id is null then raise exception 'not found'; end if;
  if t.status not in ('new', 'review') then raise exception 'that transfer is already %', t.status; end if;
  if o.crypto_chain is distinct from t.chain then raise exception 'that order is on another network'; end if;
  if o.status not in ('pending', 'expired', 'review') then raise exception 'that order is already %', o.status; end if;
  update public.orders set status = 'paid', paid_at = now(), crypto_tx_hash = t.tx_hash where id = o.id;
  update public.crypto_transfers set status = 'matched', order_id = o.id, review_reason = null where id = t.id;
  insert into public.events(kind, provider, order_id, detail)
    values ('manual_match', o.provider, o.id, jsonb_build_object('usdt', t.amount, 'tx', t.tx_hash, 'by', auth.uid()));
  return 'matched';
end $$;
revoke all on function public.crypto_manual_match(uuid, uuid) from public, anon;
grant execute on function public.crypto_manual_match(uuid, uuid) to authenticated;

create or replace function public.crypto_ignore_transfer(p_transfer uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.crypto_transfers set status = 'ignored' where id = p_transfer and status in ('new', 'review');
  if not found then raise exception 'that transfer is already settled'; end if;
  insert into public.events(kind, detail) values ('crypto_ignored', jsonb_build_object('transfer_id', p_transfer, 'by', auth.uid()));
end $$;
revoke all on function public.crypto_ignore_transfer(uuid) from public, anon;
grant execute on function public.crypto_ignore_transfer(uuid) to authenticated;

-- once a minute: look at the blockchain (needs the crypto-watch Edge Function deployed with verify_jwt=false)
select cron.schedule(
  'paytrace-crypto-watch',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/crypto-watch',
       body := '{}'::jsonb
     ); $$
);
