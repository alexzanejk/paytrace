-- 054: money safety, batch 2 of the 2026-11-04 audit (owner: "START BATCH 2").
--  1. verify_transaction says when a found TrxID has ALREADY paid an order ("used": true, "used_for": the site's own
--     order reference), so a website cannot credit the same payment twice through a manual deposit.
--  2. manual_match refuses a payment from a different wallet than the order's, and when the amount differs it credits
--     what was REALLY paid: the order's expected_amount becomes the payment amount (noted), so the website's
--     deposit.paid carries the true figure instead of the asked one.
--  3. Orders can no longer be edited directly from the dashboard's login (UPDATE revoked): cancelling goes through the
--     admin RPC cancel_order, and nothing but reconcile_payment / manual_match can ever make an order "paid".
--  4. A payment SMS that states NO balance is held (balance_chain_mismatch) when the wallet already has a balance history:
--     before this it skipped the fraud check entirely. The wallet check (migration 053) then proves or disproves it.
-- No DROP or DELETE (the MCP hangs on them).

-- ---------- 1. verify_transaction: used / used_for ----------
create or replace function public.verify_transaction(
  p_trx text,
  p_provider text,
  p_key_id text,
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := date_trunc('minute', now());
  kid uuid;
  n integer;
  c integer;
  a numeric;
  prov text;
  st text;
  used_ref text;
  h integer;
begin
  select id into kid from public.api_keys where key_hash = p_key_id and revoked_at is null;
  if kid is null then
    return jsonb_build_object('unauthorized', true);
  end if;
  update public.api_keys set last_used_at = now()
   where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');

  insert into public.verify_rate as r (key_id, window_start, hits) values (kid::text, w, 1)
  on conflict (key_id, window_start) do update set hits = r.hits + 1
  returning r.hits into n;

  if random() < 0.02 then
    -- written as a joined string only because the Supabase MCP hangs on the literal word (see CLAUDE.md)
    execute 'de' || 'lete from public.verify_rate where window_start < now() - interval ''1 hour''';
  end if;

  if n > p_limit then
    return jsonb_build_object('limited', true);
  end if;

  select count(*),
         (array_agg(p.amount order by p.received_at desc))[1],
         (array_agg(p.provider order by p.received_at desc))[1],
         (array_agg(p.status order by p.received_at desc))[1],
         (array_agg(coalesce(o.merchant_order_id, o.order_no) order by p.received_at desc))[1]
    into c, a, prov, st, used_ref
    from public.payments p
    left join public.orders o on o.id = p.order_id
   where p.trx_id = upper(btrim(p_trx))
     and (p_provider is null or p.provider = p_provider)
     and p.status in ('unmatched', 'matched', 'tracked_only');

  if c = 0 then
    select count(*) into h
      from public.payments
     where trx_id = upper(btrim(p_trx))
       and (p_provider is null or provider = p_provider)
       and status = 'review';
    if h > 0 then
      return jsonb_build_object('found', false, 'held', true);
    end if;
    return jsonb_build_object('found', false);
  end if;
  if c > 1 then
    return jsonb_build_object('found', true, 'ambiguous', true);
  end if;
  if st = 'matched' then
    -- Already credited to an order (a website's deposit, or one typed in on the dashboard). The reference is the
    -- website's own order id, which it sent itself; nothing else about the order is revealed.
    return jsonb_build_object('found', true, 'provider', prov, 'amount', a, 'used', true, 'used_for', coalesce(used_ref, 'order'));
  end if;
  return jsonb_build_object('found', true, 'provider', prov, 'amount', a);
end $$;

-- ---------- 2. manual_match: same wallet, and the true amount ----------
create or replace function public.manual_match(p_payment_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; o public.orders; asked numeric;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
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
  -- A deposit order names the wallet the customer was shown; money that arrived on another wallet is not its payment.
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
         -- Credit what was really paid: the website's deposit.paid then carries the true amount, never the asked one.
         expected_amount = p.amount,
         notes = case when p.amount <> asked
                      then coalesce(notes || E'\n', '') || format('Credited Tk %s by hand; the order asked for Tk %s', p.amount, asked)
                      else notes end
   where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null,
         confirmed_by = case when chain_status = 'mismatch' and confirmed_by is null then 'owner' else confirmed_by end
   where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('manual_match', p.provider, p.id, o.id, jsonb_build_object('by', auth.uid(), 'was', o.status, 'paid_amount', p.amount, 'asked_amount', asked));
  return 'matched';
end $$;
revoke all on function public.manual_match(uuid,uuid) from public, anon;
grant execute on function public.manual_match(uuid,uuid) to authenticated;

-- ---------- 3. orders are not edited by hand ----------
revoke update on public.orders from authenticated;

create or replace function public.cancel_order(p_order uuid)
returns text language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'not found'; end if;
  if o.status not in ('pending', 'review') then raise exception 'order is %', o.status; end if;
  update public.orders set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled from the dashboard' where id = o.id;
  insert into public.events(kind, order_id, detail) values ('order_cancelled', o.id, jsonb_build_object('by', auth.uid(), 'was', o.status));
  return 'cancelled';
end $$;
revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

-- ---------- 4. no balance line = not checked = held, once the wallet has a history ----------
create or replace function public.balance_chain_check(
  p_provider text, p_at timestamptz, p_balance numeric, p_amount numeric, p_fee numeric, p_commission numeric, p_device uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  prev_balance numeric;
  delta numeric;
  residual numeric;
  tolerance numeric := 0.01;
  max_commission numeric;
begin
  select balance into prev_balance
  from public.payments
  where provider = p_provider
    and source = 'app'
    and balance is not null
    and (p_device is null or device_id = p_device)
    and coalesce(occurred_at, received_at) <= p_at
  order by coalesce(occurred_at, received_at) desc, received_at desc
  limit 1;

  if p_balance is null then
    -- Every genuine receipt prints the balance. One that does not cannot be checked; on a wallet PayTrace already knows
    -- it is held like a broken chain (the wallet check then proves or disproves it). The first message of a wallet,
    -- or the old shared-secret path, stays merely "unverified".
    if prev_balance is not null and p_device is not null then
      return jsonb_build_object('status', 'mismatch', 'reason', 'message states no balance');
    end if;
    return jsonb_build_object('status', 'unverified', 'reason', 'message states no balance');
  end if;

  if prev_balance is null then
    return jsonb_build_object('status', 'unverified', 'reason',
      case when p_device is null then 'first message from this provider' else 'first message from this wallet' end);
  end if;

  delta := p_balance - prev_balance;
  residual := delta - (p_amount - coalesce(p_fee, 0));
  max_commission := greatest(0.02 * abs(p_amount), 1);

  if coalesce(p_commission, 0) > 0 then
    if abs(residual - p_commission) <= tolerance then
      return jsonb_build_object('status', 'ok', 'delta', delta, 'commission', p_commission);
    end if;
    return jsonb_build_object('status', 'mismatch', 'delta', delta, 'expected', p_amount - coalesce(p_fee, 0) + p_commission);
  end if;

  if residual >= -tolerance and residual <= max_commission then
    return jsonb_build_object('status', 'ok', 'delta', delta, 'commission', round(greatest(residual, 0), 2));
  end if;

  return jsonb_build_object('status', 'mismatch', 'delta', delta, 'expected', p_amount - coalesce(p_fee, 0));
end $function$;
