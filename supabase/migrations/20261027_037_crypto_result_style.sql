-- USDT confirmation page look (owner request 2026-10-27): the page a customer sees AFTER paying in USDT (waiting, paid, held, expired) can be
-- chosen per site separately from the site's ordinary result look. Empty (null) = follow the site's result look, so nothing changes until chosen.
-- Additive only.
alter table public.api_keys add column if not exists crypto_result_style smallint check (crypto_result_style is null or crypto_result_style between 0 and 5);
grant select (crypto_result_style) on public.api_keys to authenticated;

create or replace function public.set_key_crypto_result_style(p_id uuid, p_style int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_style is not null and (p_style < 0 or p_style > 5) then raise exception 'style must be 0 to 5, or empty to follow the result look'; end if;
  update public.api_keys set crypto_result_style = p_style where id = p_id and revoked_at is null;
  if not found then raise exception 'key not found or revoked'; end if;
  insert into public.events(kind, detail) values ('crypto_result_style_set', jsonb_build_object('key_id', p_id, 'style', p_style, 'by', auth.uid()));
end $$;
revoke all on function public.set_key_crypto_result_style(uuid,int) from public, anon;
grant execute on function public.set_key_crypto_result_style(uuid,int) to authenticated;

create or replace function public.gw_order_view(p_tracking uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; shop text; provs jsonb; left_sec int; grace interval; sty int; csty int; crsty int; ok_url text; bad_url text;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit';
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  grace := case when o.claimed_trx_id is null then interval '0 minutes' else interval '10 minutes' end;
  if o.status = 'pending' and o.expires_at < now() - grace then
    update public.orders set status = 'expired' where id = o.id returning * into o;
  end if;
  select name, coalesce(result_style, mod(abs(hashtext(id::text)), 6)), coalesce(crypto_style, mod(abs(hashtext(id::text)), 6)), crypto_result_style, redirect_success_url, redirect_failed_url into shop, sty, csty, crsty, ok_url, bad_url
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
    'merchant_order_id', o.merchant_order_id, 'result_style', case when o.crypto_chain is not null and crsty is not null then crsty else coalesce(sty, 0) end, 'crypto_style', coalesce(csty, 0),
    'crypto', case when o.crypto_chain is null then null
                   else jsonb_build_object('chain', o.crypto_chain, 'asset', 'USDT', 'amount', o.crypto_amount, 'address', o.crypto_address) end
  );
end $$;
revoke all on function public.gw_order_view(uuid) from public, anon, authenticated;
grant execute on function public.gw_order_view(uuid) to service_role;
