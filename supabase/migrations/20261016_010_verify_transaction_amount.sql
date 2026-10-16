-- The transaction check now also returns the provider and amount of the found transaction (owner's request), so a
-- website can compare it with what the customer claims. If the same ID exists on two providers and the caller did not
-- name one, it answers found + ambiguous without an amount instead of guessing.
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
  c integer;
  a numeric;
  prov text;
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

  select count(*), (array_agg(amount order by received_at desc))[1], (array_agg(provider order by received_at desc))[1]
    into c, a, prov
    from public.payments
   where trx_id = upper(btrim(p_trx))
     and (p_provider is null or provider = p_provider)
     and status in ('unmatched', 'matched', 'tracked_only');

  if c = 0 then
    return jsonb_build_object('found', false);
  end if;
  if c > 1 then
    return jsonb_build_object('found', true, 'ambiguous', true);
  end if;
  return jsonb_build_object('found', true, 'provider', prov, 'amount', a);
end $$;
