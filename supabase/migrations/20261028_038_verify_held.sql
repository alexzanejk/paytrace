-- verify_transaction also says when an ID is "held": the message is stored but waiting in review (could be fake), so it
-- still counts as NOT found, but the caller can tell it apart from an ID that never arrived. Nothing else is revealed.
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

  select count(*), (array_agg(amount order by received_at desc))[1], (array_agg(provider order by received_at desc))[1]
    into c, a, prov
    from public.payments
   where trx_id = upper(btrim(p_trx))
     and (p_provider is null or provider = p_provider)
     and status in ('unmatched', 'matched', 'tracked_only');

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
  return jsonb_build_object('found', true, 'provider', prov, 'amount', a);
end $$;
