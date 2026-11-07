-- 062: held payments can be settled from the owner's Admin Hub (owner 2026-11-07: "it would be better if we can clear
-- them from our admin hub ... show the TrxID on the transaction card").
--
-- WHY: PayTrace's Review page offers a list of its own order numbers (GW-…), which mean nothing to the person deciding.
-- Admin Hub shows the thing PayTrace cannot: the player's deposit request, with the site, the player, the amount asked
-- and the TrxID the player typed. So Admin Hub gets a read-and-act door into Review:
--   hub_keys           a separate key (prefix pth_) for the Hub only. It can do exactly three things below; it cannot
--                      create deposits, verify transactions or anything a website key can.
--   hub_auth           key check + 120 calls a minute (the verify_rate table, key id 'hub:<id>').
--   hub_held           every payment held for review (30 days) with the deposit orders it could belong to, best first:
--                      typed (the player typed this very TrxID), typo (same after O->0, I/L->1), same_amount (same
--                      amount within an hour), other (same wallet within two hours).
--   hub_credit         credits a held payment to an order through the SAME code as the dashboard's manual match
--                      (manual_match_core), so the one-payment-one-order rule, the amount note and the website's
--                      webhook are untouched. The event says via: admin_hub and who clicked.
--   hub_ignore         ignores a held payment through ignore_payment_core (same as the dashboard's Ignore).
-- manual_match / ignore_payment keep their signatures: they are now thin admin wrappers over the _core functions.
-- Nothing here credits an order by itself; a person clicks, in one dashboard or the other.

-- ---------- the Hub's own key ----------
create table if not exists public.hub_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  key_hash text not null unique,
  key_prefix text not null,
  key_plain text not null,                -- shown again on request (reveal_hub_key), like api_keys.key_plain since 028
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.hub_keys enable row level security;
revoke all on public.hub_keys from anon, authenticated;
grant select (id, name, key_prefix, created_at, last_used_at, revoked_at) on public.hub_keys to authenticated;
create policy hub_keys_read on public.hub_keys for select to authenticated using (public.is_admin());

create or replace function public.create_hub_key(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; r public.hub_keys; nm text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if char_length(nm) < 1 or char_length(nm) > 60 then raise exception 'give the key a short name (1 to 60 characters)'; end if;
  if (select count(*) from public.hub_keys where revoked_at is null) >= 5 then raise exception 'too many active Hub keys: revoke one first'; end if;
  k := 'pth_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.hub_keys (name, key_hash, key_prefix, key_plain)
    values (nm, encode(sha256(convert_to(k, 'utf8')), 'hex'), left(k, 8), k) returning * into r;
  insert into public.events (kind, detail) values ('hub_key_created', jsonb_build_object('key_id', r.id, 'name', r.name, 'by', auth.uid()));
  return jsonb_build_object('id', r.id, 'name', r.name, 'key', k);
end $$;
create or replace function public.reveal_hub_key(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.hub_keys;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into r from public.hub_keys where id = p_id and revoked_at is null;
  if r.id is null then raise exception 'key not found or revoked'; end if;
  insert into public.events (kind, detail) values ('hub_key_revealed', jsonb_build_object('key_id', r.id, 'by', auth.uid()));
  return jsonb_build_object('key', r.key_plain);
end $$;
create or replace function public.revoke_hub_key(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.hub_keys;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.hub_keys set revoked_at = now() where id = p_id and revoked_at is null returning * into r;
  if r.id is null then raise exception 'key not found or already revoked'; end if;
  insert into public.events (kind, detail) values ('hub_key_revoked', jsonb_build_object('key_id', r.id, 'name', r.name, 'by', auth.uid()));
end $$;
revoke all on function public.create_hub_key(text) from public, anon;
revoke all on function public.reveal_hub_key(uuid) from public, anon;
revoke all on function public.revoke_hub_key(uuid) from public, anon;
grant execute on function public.create_hub_key(text) to authenticated;
grant execute on function public.reveal_hub_key(uuid) to authenticated;
grant execute on function public.revoke_hub_key(uuid) to authenticated;

-- ---------- key check + rate limit (service role; the hub edge function calls it) ----------
create or replace function public.hub_auth(p_key_hash text, p_limit integer default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare kid uuid; w timestamptz := date_trunc('minute', now()); n integer;
begin
  select id into kid from public.hub_keys where key_hash = p_key_hash and revoked_at is null;
  if kid is null then return jsonb_build_object('unauthorized', true); end if;
  update public.hub_keys set last_used_at = now() where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  insert into public.verify_rate as r (key_id, window_start, hits) values ('hub:' || kid::text, w, 1)
    on conflict (key_id, window_start) do update set hits = r.hits + 1 returning hits into n;
  if n > p_limit then return jsonb_build_object('limited', true); end if;
  return jsonb_build_object('id', kid);
end $$;
revoke all on function public.hub_auth(text, integer) from public, anon, authenticated;
grant execute on function public.hub_auth(text, integer) to service_role;

-- "DK664REONS" typed for "DK664RE0NS": the letters people mistake for digits.
create or replace function public.hub_trx_norm(p text) returns text language sql immutable as $$
  select translate(upper(btrim(coalesce(p, ''))), 'OIL', '011');
$$;

-- ---------- the shared credit / ignore code ----------
create or replace function public.manual_match_core(p_payment_id uuid, p_order_id uuid, p_by jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; o public.orders; asked numeric;
begin
  select * into p from public.payments where id = p_payment_id;
  if p.id is null then raise exception 'not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.provider || ':' || p.trx_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 1));
  select * into p from public.payments where id = p_payment_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if p.id is null or o.id is null then raise exception 'not found'; end if;
  if p.txn_type = 'cash_out' and coalesce(o.wallet_method, '') <> 'cash_out' then
    raise exception 'cash out receipts cannot credit orders';
  end if;
  if o.provider is not null and o.provider <> p.provider then
    raise exception 'this order was for % but the payment came in on %', o.provider, p.provider;
  end if;
  if p.status not in ('unmatched','review','tracked_only') then raise exception 'payment already %', p.status; end if;
  if o.status not in ('pending','review') and not (o.status = 'expired' and o.expires_at > now() - interval '48 hours') then
    raise exception 'order is %', o.status;
  end if;
  asked := o.expected_amount;
  update public.orders set status = 'paid', payment_id = p.id, paid_at = now(),
         claimed_provider = p.provider, claimed_trx_id = p.trx_id,
         expected_amount = p.amount,
         notes = case when p.amount <> asked
                      then coalesce(notes || E'\n', '') || format('Credited Tk %s by hand; the order asked for Tk %s', p.amount, asked)
                      else notes end
   where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null,
         confirmed_by = case when chain_status = 'mismatch' and confirmed_by is null then 'owner' else confirmed_by end
   where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('manual_match', p.provider, p.id, o.id, coalesce(p_by, '{}'::jsonb) || jsonb_build_object('was', o.status, 'paid_amount', p.amount, 'asked_amount', asked));
  return 'matched';
end $$;
revoke all on function public.manual_match_core(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.manual_match_core(uuid, uuid, jsonb) to service_role;

create or replace function public.manual_match(p_payment_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return public.manual_match_core(p_payment_id, p_order_id, jsonb_build_object('by', auth.uid()));
end $$;
revoke all on function public.manual_match(uuid,uuid) from public, anon;
grant execute on function public.manual_match(uuid,uuid) to authenticated;

create or replace function public.ignore_payment_core(p_payment_id uuid, p_by jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  update public.payments set status = 'ignored' where id = p_payment_id and status in ('unmatched','review') returning * into p;
  if p.id is null then raise exception 'payment is not waiting'; end if;
  insert into public.events(kind, payment_id, detail) values ('ignored', p_payment_id, coalesce(p_by, '{}'::jsonb));
  update public.orders set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled: the held payment was ignored'
   where kind = 'deposit' and status = 'review' and payment_id is null
     and claimed_provider = p.provider and claimed_trx_id = p.trx_id;
end $$;
revoke all on function public.ignore_payment_core(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ignore_payment_core(uuid, jsonb) to service_role;

create or replace function public.ignore_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform public.ignore_payment_core(p_payment_id, jsonb_build_object('by', auth.uid()));
end $$;
revoke all on function public.ignore_payment(uuid) from public, anon;
grant execute on function public.ignore_payment(uuid) to authenticated;

-- ---------- what the Hub reads ----------
create or replace function public.hub_held(p_key_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; rows jsonb;
begin
  a := public.hub_auth(p_key_hash, 120);
  if a->>'id' is null then return a; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'provider', p.provider, 'amount', p.amount, 'trx_id', p.trx_id,
           'at', coalesce(p.occurred_at, p.received_at), 'phone', d.name, 'sim_slot', p.sim_slot,
           'txn_type', p.txn_type, 'reason', p.review_reason, 'chain', p.chain_status, 'from', p.counterparty,
           'check_line', (select c.detail from public.payment_checks c where c.payment_id = p.id order by c.created_at desc limit 1),
           'candidates', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'order_id', c.id, 'order_no', c.order_no, 'site', c.site, 'site_ref', c.merchant_order_id,
                      'amount', c.expected_amount, 'typed_trx', c.claimed_trx_id, 'status', c.status,
                      'created_at', c.created_at, 'expires_at', c.expires_at, 'customer_phone', c.customer_phone,
                      'wallet_number', c.wallet_number, 'wallet_method', c.wallet_method, 'match', c.match)
                      order by c.rank, c.created_at desc), '[]'::jsonb)
               from (
                 select o.*, k.name as site,
                        case when o.claimed_trx_id = p.trx_id then 'typed'
                             when o.claimed_trx_id is not null and public.hub_trx_norm(o.claimed_trx_id) = public.hub_trx_norm(p.trx_id) then 'typo'
                             when abs(o.expected_amount - p.amount) < 0.005
                                  and abs(extract(epoch from (o.created_at - coalesce(p.occurred_at, p.received_at)))) <= 3600 then 'same_amount'
                             else 'other' end as match,
                        case when o.claimed_trx_id = p.trx_id then 0
                             when o.claimed_trx_id is not null and public.hub_trx_norm(o.claimed_trx_id) = public.hub_trx_norm(p.trx_id) then 1
                             when abs(o.expected_amount - p.amount) < 0.005
                                  and abs(extract(epoch from (o.created_at - coalesce(p.occurred_at, p.received_at)))) <= 3600 then 2
                             else 3 end as rank
                   from public.orders o left join public.api_keys k on k.id = o.api_key_id
                  where o.kind = 'deposit' and o.provider = p.provider and o.payment_id is null
                    and (o.status in ('pending', 'review') or (o.status = 'expired' and o.expires_at > now() - interval '48 hours'))
                    and (o.claimed_trx_id = p.trx_id
                         or (o.claimed_trx_id is not null and public.hub_trx_norm(o.claimed_trx_id) = public.hub_trx_norm(p.trx_id))
                         or o.created_at between coalesce(p.occurred_at, p.received_at) - interval '2 hours'
                                             and coalesce(p.occurred_at, p.received_at) + interval '2 hours')
                  order by
                        case when o.claimed_trx_id = p.trx_id then 0
                             when o.claimed_trx_id is not null and public.hub_trx_norm(o.claimed_trx_id) = public.hub_trx_norm(p.trx_id) then 1
                             when abs(o.expected_amount - p.amount) < 0.005
                                  and abs(extract(epoch from (o.created_at - coalesce(p.occurred_at, p.received_at)))) <= 3600 then 2
                             else 3 end, o.created_at desc
                  limit 12
               ) c)
         ) order by p.received_at desc), '[]'::jsonb)
    into rows
    from (select * from public.payments x where x.status = 'review' and x.received_at > now() - interval '30 days' order by x.received_at desc limit 100) p
    left join public.devices d on d.id = p.device_id;
  return jsonb_build_object('payments', rows, 'at', now());
end $$;
revoke all on function public.hub_held(text) from public, anon, authenticated;
grant execute on function public.hub_held(text) to service_role;

-- ---------- what the Hub does ----------
create or replace function public.hub_credit(p_key_hash text, p_payment uuid, p_order uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; r text;
begin
  a := public.hub_auth(p_key_hash, 120);
  if a->>'id' is null then return a; end if;
  begin
    r := public.manual_match_core(p_payment, p_order, jsonb_build_object('via', 'admin_hub', 'hub_key', a->>'id', 'actor', left(coalesce(p_actor, ''), 100)));
  exception when others then
    return jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object('result', r);
end $$;
create or replace function public.hub_ignore(p_key_hash text, p_payment uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := public.hub_auth(p_key_hash, 120);
  if a->>'id' is null then return a; end if;
  begin
    perform public.ignore_payment_core(p_payment, jsonb_build_object('via', 'admin_hub', 'hub_key', a->>'id', 'actor', left(coalesce(p_actor, ''), 100)));
  exception when others then
    return jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object('result', 'ignored');
end $$;
revoke all on function public.hub_credit(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.hub_ignore(text, uuid, text) from public, anon, authenticated;
grant execute on function public.hub_credit(text, uuid, uuid, text) to service_role;
grant execute on function public.hub_ignore(text, uuid, text) to service_role;
