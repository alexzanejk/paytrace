-- Wallet groups (owner request 2026-10-25): different customers can be sent to numbers on different phones.
-- A website passes an optional "group" to create-deposit; only numbers in that group are offered. A group that is unknown, switched
-- off, or has no approved ONLINE number for that provider+method falls back to 'main'. The group actually used is stored on the order.
-- No DROP/DELETE statements: the Supabase MCP hangs on them. New functions get new names or new signatures, old ones stay.

create table if not exists public.wallet_groups (
  name text primary key check (name = 'main' or name ~ '^P-[A-Z0-9]{1,20}$'),
  enabled boolean not null default true,
  created_at timestamptz default now()
);
insert into public.wallet_groups (name) values ('main') on conflict do nothing;

alter table public.wallet_groups enable row level security;
revoke all on public.wallet_groups from anon, authenticated;
grant select on public.wallet_groups to authenticated;
create policy wallet_groups_read on public.wallet_groups for select to authenticated using (public.is_admin());

alter table public.device_wallets add column if not exists wallet_group text not null default 'main' references public.wallet_groups(name);
alter table public.orders add column if not exists wallet_group text;
create index if not exists device_wallets_group_idx on public.device_wallets (wallet_group, provider);

-- Owner: make a new group, for example P-AB12.
create or replace function public.add_wallet_group(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare n text := upper(btrim(coalesce(p_name, '')));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if n !~ '^P-[A-Z0-9]{1,20}$' then raise exception 'a group name starts with P- and then letters or digits, for example P-AB12'; end if;
  insert into public.wallet_groups (name) values (n) on conflict do nothing;
  insert into public.events(kind, detail) values ('wallet_group_added', jsonb_build_object('group', n, 'by', auth.uid()));
end $$;
revoke all on function public.add_wallet_group(text) from public, anon;
grant execute on function public.add_wallet_group(text) to authenticated;

-- Owner: move one deposit number into a group.
create or replace function public.set_wallet_group(p_wallet_id uuid, p_group text)
returns void language plpgsql security definer set search_path = public as $$
declare g text := case when lower(btrim(coalesce(p_group, ''))) = 'main' then 'main' else upper(btrim(coalesce(p_group, ''))) end;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.wallet_groups where name = g) then raise exception 'that group does not exist, add it first'; end if;
  update public.device_wallets set wallet_group = g where id = p_wallet_id;
  if not found then raise exception 'number not found'; end if;
  insert into public.events(kind, detail) values ('wallet_group_set', jsonb_build_object('wallet_id', p_wallet_id, 'group', g, 'by', auth.uid()));
end $$;
revoke all on function public.set_wallet_group(uuid, text) from public, anon;
grant execute on function public.set_wallet_group(uuid, text) to authenticated;

-- 'main' keeps the old behaviour (online phones first, an offline one still allowed). Any other group only offers a number whose phone is online now.
create or replace function public.gw_find_wallet_in_group(p_provider text, p_method text, p_group text)
returns public.device_wallets language sql stable security definer set search_path = public as $$
  select w.* from public.device_wallets w join public.devices d on d.id = w.device_id
   where w.provider = p_provider and w.enabled and d.status = 'approved' and w.wallet_group = p_group
     and (p_method is null or w.method = p_method)
     and (p_group = 'main' or (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds'))
   order by (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds') desc,
            w.last_assigned_at asc nulls first
   limit 1;
$$;
revoke all on function public.gw_find_wallet_in_group(text, text, text) from public, anon, authenticated;
grant execute on function public.gw_find_wallet_in_group(text, text, text) to service_role;

-- Same as the 10-argument gw_create_deposit (migration 017) plus p_group. The old one stays (service role only) for old callers.
create or replace function public.gw_create_deposit(
  p_key_hash text, p_amount numeric, p_merchant_order_id text, p_provider text, p_method text,
  p_expires_minutes int, p_customer_name text, p_customer_phone text, p_return_url text, p_limit int, p_group text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  kid uuid; w timestamptz := date_trunc('minute', now()); n int; o public.orders; mins int;
  prov text := nullif(btrim(p_provider), ''); meth text := nullif(btrim(p_method), ''); wal public.device_wallets;
  grp text := case when lower(btrim(coalesce(p_group, ''))) in ('', 'main') then 'main' else upper(btrim(p_group)) end;
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
  mins := least(greatest(coalesce(p_expires_minutes, 15), 3), 60);

  select * into o from public.orders where api_key_id = kid and merchant_order_id = btrim(p_merchant_order_id);
  if o.id is null then
    wal := null;
    if grp <> 'main' then
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
end $$;
revoke all on function public.gw_create_deposit(text,numeric,text,text,text,int,text,text,text,int,text) from public, anon, authenticated;
grant execute on function public.gw_create_deposit(text,numeric,text,text,text,int,text,text,text,int,text) to service_role;

-- Website server: which numbers sit in which group. Never balances or message text. Counted in the same per-key rate limit as create-deposit.
create or replace function public.gw_groups_list(p_key_hash text, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kid uuid; w timestamptz := date_trunc('minute', now()); n int; rows jsonb;
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'group', g.name, 'enabled', g.enabled, 'phone_name', d.name, 'provider', wl.provider, 'method', wl.method,
           'number', wl.wallet_number,
           'online', (d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds')
         ) order by g.name <> 'main', g.name, d.name, wl.provider), '[]'::jsonb)
    into rows
    from public.wallet_groups g
    left join public.device_wallets wl on wl.wallet_group = g.name and wl.enabled
    left join public.devices d on d.id = wl.device_id and d.status = 'approved'
   where wl.id is null or d.id is not null;
  return jsonb_build_object('rows', rows);
end $$;
revoke all on function public.gw_groups_list(text, int) from public, anon, authenticated;
grant execute on function public.gw_groups_list(text, int) to service_role;

-- Website server: switch a group off or on. 'main' cannot be switched off (it is where everything falls back to).
create or replace function public.gw_group_set_enabled(p_key_hash text, p_group text, p_enabled boolean, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kid uuid; w timestamptz := date_trunc('minute', now()); n int;
        grp text := case when lower(btrim(coalesce(p_group, ''))) = 'main' then 'main' else upper(btrim(coalesce(p_group, ''))) end;
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;
  if p_enabled is null then return jsonb_build_object('error', 'enabled must be true or false'); end if;
  if grp = 'main' then return jsonb_build_object('error', 'the main group cannot be switched off'); end if;
  update public.wallet_groups set enabled = p_enabled where name = grp;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  insert into public.events(kind, detail) values ('wallet_group_enabled', jsonb_build_object('group', grp, 'enabled', p_enabled, 'key_id', kid));
  return jsonb_build_object('group', grp, 'enabled', p_enabled);
end $$;
revoke all on function public.gw_group_set_enabled(text, text, boolean, int) from public, anon, authenticated;
grant execute on function public.gw_group_set_enabled(text, text, boolean, int) to service_role;
