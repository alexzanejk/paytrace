-- Group names are now the partner's link code: 3 lowercase letters + 4 digits, like dvw9166 (owner 2026-10-25). 'main' stays.
-- No group existed besides 'main' when this was applied, so nothing is converted. Case is folded to lower case everywhere.
-- Group names are lowercase now (the old P-AB12 form is gone). The old check constraint is dropped (applied live by hand) and replaced.

alter table public.wallet_groups drop constraint if exists wallet_groups_name_check;
alter table public.wallet_groups add constraint wallet_groups_name_check check (name = 'main' or name ~ '^[a-z]{3}[0-9]{4}$');

create or replace function public.add_wallet_group(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare n text := lower(btrim(coalesce(p_name, '')));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if n !~ '^[a-z]{3}[0-9]{4}$' then raise exception 'a group code is 3 lowercase letters and 4 digits, for example dvw9166'; end if;
  insert into public.wallet_groups (name) values (n) on conflict do nothing;
  insert into public.events(kind, detail) values ('wallet_group_added', jsonb_build_object('group', n, 'by', auth.uid()));
end $$;

create or replace function public.set_wallet_group(p_wallet_id uuid, p_group text)
returns void language plpgsql security definer set search_path = public as $$
declare g text := case when lower(btrim(coalesce(p_group, ''))) = 'main' then 'main' else lower(btrim(coalesce(p_group, ''))) end;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.wallet_groups where name = g) then raise exception 'that group does not exist, add it first'; end if;
  update public.device_wallets set wallet_group = g where id = p_wallet_id;
  if not found then raise exception 'number not found'; end if;
  insert into public.events(kind, detail) values ('wallet_group_set', jsonb_build_object('wallet_id', p_wallet_id, 'group', g, 'by', auth.uid()));
end $$;

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

create or replace function public.gw_group_set_enabled(p_key_hash text, p_group text, p_enabled boolean, p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kid uuid; w timestamptz := date_trunc('minute', now()); n int;
        grp text := case when lower(btrim(coalesce(p_group, ''))) = 'main' then 'main' else lower(btrim(coalesce(p_group, ''))) end;
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

revoke all on function public.add_wallet_group(text) from public, anon;
grant execute on function public.add_wallet_group(text) to authenticated;
revoke all on function public.set_wallet_group(uuid, text) from public, anon;
grant execute on function public.set_wallet_group(uuid, text) to authenticated;
