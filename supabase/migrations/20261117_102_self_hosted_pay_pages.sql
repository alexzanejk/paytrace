-- Self-hosted pay pages (owner 2026-11-17): a website can show the customer its OWN copy of the bKash / Nagad / Rocket
-- submission page instead of PayTrace's /pay/ page. For that its server needs the wallet number the customer must pay to,
-- and a way to hand PayTrace the TrxID the customer typed (the gateway's new server route submit-trx, which reuses
-- gw_merchant_order for the key check and rate limit, then gw_submit_trx -> claim_order, the one crediting path).
--
-- Additive only: two answers gain fields, nothing is removed or renamed. Wallet numbers are not secret (every customer
-- is shown one).

-- 1. order-status answers and every webhook body carry the number the customer was shown and how it is paid.
create or replace function public.order_payload(o orders) returns jsonb
language sql stable set search_path to 'public' as $function$
select jsonb_build_object(
  'tracking_number', o.tracking_number,
  'order_id', o.merchant_order_id,
  'status', case o.status when 'pending' then 'pending' when 'paid' then 'paid' when 'review' then 'review'
                          when 'expired' then 'expired' else 'cancelled' end,
  'amount', o.expected_amount,
  'currency', o.currency,
  'provider', o.provider,
  'trx_id', coalesce(o.claimed_trx_id, o.crypto_tx_hash),
  'paid_at', o.paid_at,
  'wallet_number', o.wallet_number,
  'wallet_method', o.wallet_method
) || case when o.crypto_chain is null then '{}'::jsonb
          else jsonb_build_object('crypto', jsonb_build_object('chain', o.crypto_chain, 'asset', 'USDT', 'amount', o.crypto_amount, 'address', o.crypto_address)) end;
$function$;

-- 2. create-deposit's answer also says how much, which wallet and which number, so the site can draw its own page at once.
--    Patched in place (only the final return line), like migrations 077/092: nothing else in the function changes.
do $$
declare d text; old text := '''group'', coalesce(o.wallet_group, ''main''));';
begin
  select pg_get_functiondef('public.gw_create_deposit(text,numeric,text,text,text,integer,text,text,text,integer,text)'::regprocedure) into d;
  if position('''wallet_number'', o.wallet_number' in d) = 0 then
    if position(old in d) = 0 then raise exception 'gw_create_deposit: return line not found'; end if;
    d := replace(d, old, '''group'', coalesce(o.wallet_group, ''main''), ''amount'', o.expected_amount, ''provider'', o.provider, ''wallet_number'', o.wallet_number, ''wallet_method'', o.wallet_method);');
    execute d;
  end if;
end $$;
