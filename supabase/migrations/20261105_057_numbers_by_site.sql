-- 057: which deposit numbers each website shows (owner 2026-11-05: "we are just randomly adding deposit numbers and
-- don't know which one will show ... we should select numbers for each site").
-- Before this a site's number came from EVERY enabled number in the main group, in rotation. Now:
--   site_wallets(api_key_id, wallet_id, enabled): the numbers a site may show. gw_find_wallet_for_site picks among a
--   site's chosen numbers (online phone first, least recently handed out); a site with NO chosen number for that
--   wallet type keeps the old rule (any main number), so no site stops working the day this goes live.
--   Partner phones are untouched: a partner's players still get the partner's group by its code (migration 027/030).
-- Rows are switched off, never removed (the MCP hangs on DELETE), and the dashboard reads enabled rows only.

create table if not exists public.site_wallets (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  wallet_id uuid not null references public.device_wallets(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (api_key_id, wallet_id)
);
create index if not exists site_wallets_wallet_idx on public.site_wallets (wallet_id);
alter table public.site_wallets enable row level security;
revoke all on public.site_wallets from anon, authenticated;
grant select on public.site_wallets to authenticated;
create policy site_wallets_read on public.site_wallets for select to authenticated using (public.is_admin());

create or replace function public.set_site_wallet(p_key uuid, p_wallet uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.api_keys where id = p_key and revoked_at is null) then raise exception 'website not found'; end if;
  if not exists (select 1 from public.device_wallets where id = p_wallet) then raise exception 'number not found'; end if;
  insert into public.site_wallets (api_key_id, wallet_id, enabled) values (p_key, p_wallet, coalesce(p_on, true))
    on conflict (api_key_id, wallet_id) do update set enabled = excluded.enabled, updated_at = now();
  insert into public.events(kind, detail) values ('site_wallet_set', jsonb_build_object('by', auth.uid(), 'key_id', p_key, 'wallet_id', p_wallet, 'on', coalesce(p_on, true)));
end $$;
revoke all on function public.set_site_wallet(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_site_wallet(uuid, uuid, boolean) to authenticated;

-- The site's own chosen numbers first; when it has none for this wallet type, every main number (the rule before this).
create or replace function public.gw_find_wallet_for_site(p_key uuid, p_provider text, p_method text) returns public.device_wallets
language sql stable security definer set search_path = public as $$
  select w.* from public.device_wallets w where w.id = (
    with mine as (
      select w2.id, w2.last_assigned_at, d.last_seen_at
        from public.device_wallets w2 join public.devices d on d.id = w2.device_id
       where w2.provider = p_provider and w2.enabled and d.status = 'approved' and w2.wallet_group = 'main'
         and (p_method is null or w2.method = p_method)
    ), chosen as (
      select m.* from mine m
       where exists (select 1 from public.site_wallets s where s.api_key_id = p_key and s.wallet_id = m.id and s.enabled)
    ), pool as (
      select * from chosen
      union all
      select * from mine where not exists (select 1 from chosen)
    )
    select p.id from pool p
     order by (p.last_seen_at is not null and p.last_seen_at > now() - interval '90 seconds') desc,
              (p.last_seen_at is not null and p.last_seen_at > now() - interval '10 minutes') desc,
              p.last_assigned_at asc nulls first
     limit 1);
$$;
revoke all on function public.gw_find_wallet_for_site(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gw_find_wallet_for_site(uuid, text, text) to service_role;

-- gw_create_deposit (11 arguments, the one the gateway calls): same as migration 052's, with the main-group lookup
-- going through the site's own list, and the event saying whether the number came from the site's list or the pool.
create or replace function public.gw_create_deposit(p_key_hash text, p_amount numeric, p_merchant_order_id text, p_provider text, p_method text, p_expires_minutes integer, p_customer_name text, p_customer_phone text, p_return_url text, p_limit integer, p_group text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders; mins int;
  prov text := nullif(btrim(p_provider), ''); meth text := nullif(btrim(p_method), ''); wal public.device_wallets;
  grp text := case when lower(btrim(coalesce(p_group, ''))) in ('', 'main') then 'main' else lower(btrim(p_group)) end;
  used text := 'main'; g_on boolean; picked text := 'any';
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
        if wal.id is not null then used := grp; picked := 'group'; end if;
      end if;
    end if;
    if wal.id is null then
      -- Main numbers: the site's own chosen list first (migration 057), any main number when it chose none.
      wal := public.gw_find_wallet_for_site(kid, prov, meth);
      used := 'main';
      if wal.id is not null and exists (select 1 from public.site_wallets s where s.api_key_id = kid and s.wallet_id = wal.id and s.enabled) then
        picked := 'site';
      end if;
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
      values ('deposit_created', o.id, jsonb_build_object('amount', p_amount, 'key_id', kid, 'provider', prov, 'group', used, 'group_asked', grp, 'picked', picked));
  elsif o.expected_amount <> p_amount then
    return jsonb_build_object('error', 'order_id was already used with a different amount');
  end if;
  return jsonb_build_object('tracking_number', o.tracking_number, 'status', o.status, 'expires_at', o.expires_at,
                            'group', coalesce(o.wallet_group, 'main'));
end $function$;

-- The pay page's fallback for an order that still has no number: the same site-aware choice.
create or replace function public.gw_pick_wallet(p_tracking uuid, p_provider text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare o public.orders; w public.device_wallets;
begin
  select * into o from public.orders where tracking_number = p_tracking and kind = 'deposit' for update;
  if o.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if o.status <> 'pending' or o.expires_at < now() then return jsonb_build_object('error', 'not_open'); end if;
  if o.provider is null or o.provider <> p_provider then return jsonb_build_object('error', 'bad_provider'); end if;
  if o.wallet_number is not null then return public.gw_order_view(p_tracking); end if;
  w := public.gw_find_wallet_for_site(o.api_key_id, o.provider, o.wallet_method);
  if w.id is null then return jsonb_build_object('error', 'no_wallet'); end if;
  update public.device_wallets set last_assigned_at = now() where id = w.id;
  update public.orders set device_id = w.device_id, wallet_number = w.wallet_number, wallet_method = w.method where id = o.id;
  return public.gw_order_view(p_tracking);
end $function$;
