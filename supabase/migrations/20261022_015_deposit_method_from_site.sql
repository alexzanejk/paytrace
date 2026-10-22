-- The website's own page lets the customer choose the method ("Bkash Send Money", "Nagad Cash Out", ...). So the order is now
-- created WITH the provider (and optionally the method), and the wallet number is assigned right away. The PayTrace pay page
-- starts at the transaction-ID step and has no method chooser. No DROP/DELETE statements: see the note in migration 014.

-- Picks the wallet to show: an approved phone with an enabled number for that provider (and method, when given).
-- Online phones first, then the one handed out least recently.
create or replace function public.gw_find_wallet(p_provider text, p_method text)
returns public.device_wallets language sql stable security definer set search_path = public as $$
  select w.* from public.device_wallets w join public.devices d on d.id = w.device_id
   where w.provider = p_provider and w.enabled and d.status = 'approved'
     and (p_method is null or w.method = p_method)
   order by (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds') desc,
            w.last_assigned_at asc nulls first
   limit 1;
$$;

-- Same as gw_create_deposit (migration 014) plus p_method, and it assigns the wallet at creation. If there is no number for that
-- provider/method the order is NOT created and the website is told why. The 9-argument version from 014 is left in place
-- (service role only) because it cannot be dropped here; the gateway function calls this one.
create or replace function public.gw_create_deposit(
  p_key_hash text, p_amount numeric, p_merchant_order_id text, p_provider text, p_method text,
  p_expires_minutes int, p_customer_name text, p_customer_phone text, p_return_url text, p_limit int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders; mins int;
  prov text := nullif(btrim(p_provider), ''); meth text := nullif(btrim(p_method), ''); wal public.device_wallets;
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
  if prov is null or prov not in ('bkash','nagad','rocket','upay') then
    return jsonb_build_object('error', 'provider is required: bkash, nagad, rocket or upay');
  end if;
  if meth is not null and meth not in ('send_money','cash_out') then
    return jsonb_build_object('error', 'method must be send_money or cash_out');
  end if;
  if p_return_url is not null and (p_return_url !~ '^https://' or char_length(p_return_url) > 500 or p_return_url ~ '\s') then
    return jsonb_build_object('error', 'return_url must be an https address');
  end if;
  mins := least(greatest(coalesce(p_expires_minutes, 15), 3), 60);

  select * into o from public.orders where api_key_id = kid and merchant_order_id = btrim(p_merchant_order_id);
  if o.id is null then
    wal := public.gw_find_wallet(prov, meth);
    if wal.id is null then
      return jsonb_build_object('error', 'no_wallet', 'message', 'no deposit number is set up for ' || prov || coalesce(' / ' || meth, ''));
    end if;
    update public.device_wallets set last_assigned_at = now() where id = wal.id;
    insert into public.orders (order_no, kind, api_key_id, merchant_order_id, expected_amount, customer_name, customer_phone,
                               return_url, expires_at, provider, device_id, wallet_number, wallet_method)
    values ('GW-' || upper(encode(extensions.gen_random_bytes(5), 'hex')), 'deposit', kid, btrim(p_merchant_order_id), p_amount,
            nullif(left(btrim(coalesce(p_customer_name, '')), 80), ''), nullif(left(btrim(coalesce(p_customer_phone, '')), 20), ''),
            p_return_url, now() + mins * interval '1 minute', prov, wal.device_id, wal.wallet_number, wal.method)
    returning * into o;
    insert into public.events(kind, order_id, detail) values ('deposit_created', o.id, jsonb_build_object('amount', p_amount, 'key_id', kid, 'provider', prov));
  elsif o.expected_amount <> p_amount then
    return jsonb_build_object('error', 'order_id was already used with a different amount');
  end if;
  return jsonb_build_object('tracking_number', o.tracking_number, 'status', o.status, 'expires_at', o.expires_at);
end $$;

-- Fallback only (an order without a wallet): assign one for the order's own provider. The customer cannot change provider.
create or replace function public.gw_pick_wallet(p_tracking uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; w public.device_wallets;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit' for update;
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if o.status <> 'pending' or o.expires_at < now() then return jsonb_build_object('error', 'not_open'); end if;
  if o.provider is null or o.provider <> p_provider then return jsonb_build_object('error', 'bad_provider'); end if;
  if o.wallet_number is not null then return public.gw_order_view(p_tracking); end if;
  w := public.gw_find_wallet(o.provider, o.wallet_method);
  if w.id is null then return jsonb_build_object('error', 'no_wallet'); end if;
  update public.device_wallets set last_assigned_at = now() where id = w.id;
  update public.orders set device_id = w.device_id, wallet_number = w.wallet_number, wallet_method = w.method where id = o.id;
  return public.gw_order_view(p_tracking);
end $$;

revoke all on function public.gw_find_wallet(text,text) from public, anon, authenticated;
revoke all on function public.gw_create_deposit(text,numeric,text,text,text,int,text,text,text,int) from public, anon, authenticated;
revoke all on function public.gw_pick_wallet(uuid,text) from public, anon, authenticated;
grant execute on function public.gw_find_wallet(text,text), public.gw_create_deposit(text,numeric,text,text,text,int,text,text,text,int),
  public.gw_pick_wallet(uuid,text) to service_role;
