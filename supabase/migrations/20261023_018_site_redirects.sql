-- Where a customer goes after the payment, per website: after a confirmed payment (success_url, e.g. the site's account or
-- deposit history page) and after an expired/cancelled order (failed_url, e.g. the site's deposit page). An address sent with
-- one order (orders.return_url) still wins over the site's setting. Set by the owner on the Websites page.
-- No DROP/DELETE statements: see the note in migration 014.
-- NOTE: the live database also has two EMPTY, UNUSED columns api_keys.success_url / failed_url from a first attempt whose check
-- used {3,480}, and Postgres allows at most 255 repetitions, so the check could never pass. They could not be dropped (the
-- Supabase MCP hangs on DROP), so the real columns have the redirect_ prefix. A fresh database does not need the dead ones.
alter table public.api_keys add column if not exists redirect_success_url text check (redirect_success_url is null or (redirect_success_url ~ '^https://[^[:space:]]+$' and length(redirect_success_url) between 11 and 500));
alter table public.api_keys add column if not exists redirect_failed_url text check (redirect_failed_url is null or (redirect_failed_url ~ '^https://[^[:space:]]+$' and length(redirect_failed_url) between 11 and 500));
grant select (redirect_success_url, redirect_failed_url) on public.api_keys to authenticated;

create or replace function public.set_key_redirects(p_id uuid, p_success text, p_failed text)
returns void language plpgsql security definer set search_path = public as $$
declare s text := nullif(btrim(coalesce(p_success, '')), ''); f text := nullif(btrim(coalesce(p_failed, '')), '');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if s is not null and (s !~ '^https://[^[:space:]]+$' or length(s) not between 11 and 500) then raise exception 'the success address must start with https://'; end if;
  if f is not null and (f !~ '^https://[^[:space:]]+$' or length(f) not between 11 and 500) then raise exception 'the failed address must start with https://'; end if;
  update public.api_keys set redirect_success_url = s, redirect_failed_url = f where id = p_id and revoked_at is null;
  if not found then raise exception 'key not found or revoked'; end if;
  insert into public.events(kind, detail) values ('site_redirects_set', jsonb_build_object('key_id', p_id, 'by', auth.uid()));
end $$;
revoke all on function public.set_key_redirects(uuid,text,text) from public, anon;
grant execute on function public.set_key_redirects(uuid,text,text) to authenticated;

-- gw_order_view: return_url (paid) = the order's own address, else the site's success address; failed_url (expired/cancelled) = the site's.
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
    'seconds_left', left_sec, 'trx_id', o.claimed_trx_id, 'providers', provs,
    'return_url', case when o.status = 'paid' then coalesce(o.return_url, ok_url) else null end,
    'failed_url', case when o.status in ('expired', 'cancelled') then bad_url else null end,
    'merchant_order_id', o.merchant_order_id, 'result_style', coalesce(sty, 0)
  );
end $$;
revoke all on function public.gw_order_view(uuid) from public, anon, authenticated;
grant execute on function public.gw_order_view(uuid) to service_role;
