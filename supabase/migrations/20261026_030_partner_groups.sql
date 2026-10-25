-- Partner groups, part 2 (owner 2026-10-25/26): a partner's group is created automatically the first time a deposit arrives with a valid
-- code (3 lowercase letters + 4 digits), the master console can create one with POST /gateway/groups, a group can hold numbers on many phones,
-- and a phone gets its group when it is approved (devices.default_group; new numbers on that phone start in it).
-- No DROP/DELETE statements: the Supabase MCP hangs on them.

alter table public.devices add column if not exists default_group text not null default 'main' references public.wallet_groups(name);

-- Owner: set a phone's group (main, an existing code, or a new valid code which is created). Optionally move its existing numbers too.
create or replace function public.set_device_group(p_device_id uuid, p_group text, p_move_numbers boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare g text := lower(btrim(coalesce(p_group, '')));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if g = '' then g := 'main'; end if;
  if g <> 'main' and g !~ '^[a-z]{3}[0-9]{4}$' then raise exception 'a group code is 3 lowercase letters and 4 digits, for example dvw9166'; end if;
  if g <> 'main' and (select count(*) from public.wallet_groups) < 1000 then
    insert into public.wallet_groups (name) values (g) on conflict do nothing;
  end if;
  if not exists (select 1 from public.wallet_groups where name = g) then raise exception 'that group does not exist'; end if;
  update public.devices set default_group = g where id = p_device_id;
  if not found then raise exception 'phone not found'; end if;
  if coalesce(p_move_numbers, true) then
    update public.device_wallets set wallet_group = g where device_id = p_device_id;
  end if;
  insert into public.events(kind, detail) values ('device_group_set', jsonb_build_object('device_id', p_device_id, 'group', g, 'moved', coalesce(p_move_numbers, true), 'by', auth.uid()));
end $$;
revoke all on function public.set_device_group(uuid, text, boolean) from public, anon;
grant execute on function public.set_device_group(uuid, text, boolean) to authenticated;

-- Same as migration 014 except a new number starts in the phone's group.
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
  insert into public.device_wallets (device_id, provider, wallet_number, method, enabled, wallet_group)
    values (p_device_id, p_provider, n, p_method, coalesce(p_enabled, true),
            coalesce((select default_group from public.devices where id = p_device_id), 'main'))
  on conflict (device_id, provider) do update
    set wallet_number = excluded.wallet_number, method = excluded.method, enabled = excluded.enabled;
  insert into public.events(kind, provider, detail)
    values ('wallet_set', p_provider, jsonb_build_object('device_id', p_device_id, 'method', p_method, 'enabled', coalesce(p_enabled, true), 'by', auth.uid()));
end $$;

-- Same as migration 029 plus: a valid partner code that does not exist yet is created here.
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
  mins := least(greatest(coalesce(p_expires_minutes, 15), 3), 60);

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

-- Master console: create a group for a partner (new partner, or a New code). Does nothing if it already exists. Same key auth and rate limit.
create or replace function public.gw_group_create(p_key_hash text, p_group text, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kid uuid; w timestamptz := date_trunc('minute', now()); n int; grp text := lower(btrim(coalesce(p_group, ''))); made int;
begin
  select id into kid from public.api_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  insert into public.verify_rate as r (key_id, window_start, hits) values ('c:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;
  if grp !~ '^[a-z]{3}[0-9]{4}$' then return jsonb_build_object('error', 'group must be 3 letters and 4 digits, for example dvw9166'); end if;
  if (select count(*) from public.wallet_groups) >= 1000 and not exists (select 1 from public.wallet_groups where name = grp) then
    return jsonb_build_object('error', 'too many groups');
  end if;
  insert into public.wallet_groups (name) values (grp) on conflict do nothing;
  get diagnostics made = row_count;
  if made > 0 then
    insert into public.events(kind, detail) values ('wallet_group_added', jsonb_build_object('group', grp, 'key_id', kid));
  end if;
  return jsonb_build_object('group', grp, 'created', made > 0);
end $$;
revoke all on function public.gw_group_create(text, text, int) from public, anon, authenticated;
grant execute on function public.gw_group_create(text, text, int) to service_role;
