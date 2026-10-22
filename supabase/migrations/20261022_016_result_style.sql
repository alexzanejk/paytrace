-- After the customer presses Confirm, the "processing / paid / held / expired" screens come in six different looks, so
-- sites that use PayTrace's transaction-submission page do not all show an identical result page. Each API key (site) gets a
-- look: chosen by the owner on the API access page, or automatic (derived from the key id, stable for that site).
-- No DROP/DELETE statements: see the note in migration 014.
alter table public.api_keys add column if not exists result_style smallint check (result_style is null or result_style between 0 and 5);
grant select (result_style) on public.api_keys to authenticated;

create or replace function public.set_key_result_style(p_id uuid, p_style int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_style is not null and (p_style < 0 or p_style > 5) then raise exception 'style must be 0 to 5, or empty for automatic'; end if;
  update public.api_keys set result_style = p_style where id = p_id and revoked_at is null;
  if not found then raise exception 'key not found or revoked'; end if;
  insert into public.events(kind, detail) values ('result_style_set', jsonb_build_object('key_id', p_id, 'style', p_style, 'by', auth.uid()));
end $$;
revoke all on function public.set_key_result_style(uuid,int) from public, anon;
grant execute on function public.set_key_result_style(uuid,int) to authenticated;

-- gw_order_view now also returns result_style (the key's choice, or automatic).
create or replace function public.gw_order_view(p_tracking uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; shop text; provs jsonb; left_sec int; grace interval; sty int;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit';
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  grace := case when o.claimed_trx_id is null then interval '0 minutes' else interval '10 minutes' end;
  if o.status = 'pending' and o.expires_at < now() - grace then
    update public.orders set status = 'expired' where id = o.id returning * into o;
  end if;
  select name, coalesce(result_style, mod(abs(hashtext(id::text)), 6)) into shop, sty from public.api_keys where id = o.api_key_id;
  select coalesce(jsonb_agg(distinct w.provider), '[]'::jsonb) into provs
    from public.device_wallets w join public.devices d on d.id = w.device_id
   where w.enabled and d.status = 'approved';
  left_sec := greatest(0, floor(extract(epoch from (o.expires_at - now()))))::int;
  return jsonb_build_object(
    'status', o.status, 'amount', o.expected_amount, 'currency', o.currency, 'shop', shop,
    'provider', o.provider, 'wallet_number', o.wallet_number, 'method', o.wallet_method,
    'seconds_left', left_sec, 'trx_id', o.claimed_trx_id, 'providers', provs,
    'return_url', case when o.status = 'paid' then o.return_url else null end,
    'merchant_order_id', o.merchant_order_id, 'result_style', coalesce(sty, 0)
  );
end $$;
revoke all on function public.gw_order_view(uuid) from public, anon, authenticated;
grant execute on function public.gw_order_view(uuid) to service_role;
