-- The owner wants every kind of stored transaction to count as found: payments, send money AND cash-out receipts.
-- Still not found: a payment held for review (it could be a forged SMS) and one marked ignored.
create or replace function public.verify_transaction(
  p_trx text,
  p_provider text,
  p_key_id text,
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := date_trunc('minute', now());
  n integer;
begin
  insert into public.verify_rate as r (key_id, window_start, hits) values (p_key_id, w, 1)
  on conflict (key_id, window_start) do update set hits = r.hits + 1
  returning r.hits into n;

  if random() < 0.02 then
    delete from public.verify_rate where window_start < now() - interval '1 hour';
  end if;

  if n > p_limit then
    return jsonb_build_object('limited', true);
  end if;

  -- Every kind of stored transaction counts (payment, send money, cash out). Only payments held for review
  -- (could be a forged SMS) or marked ignored do not.
  return jsonb_build_object('found', exists (
    select 1 from public.payments
     where trx_id = upper(btrim(p_trx))
       and (p_provider is null or provider = p_provider)
       and status in ('unmatched', 'matched', 'tracked_only')
  ));
end $$;
