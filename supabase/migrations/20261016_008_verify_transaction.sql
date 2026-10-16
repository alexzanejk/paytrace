-- Read-only "was this transaction ID really paid to us?" lookup, for the website's admin and super-admin servers
-- (Edge Function `verify-transaction`). It answers only true/false, never amounts or details.
--
-- What counts as found: an incoming payment (payment_received / send_money_received) that is stored and not held
-- or ignored. Agent cash-out receipts are money going OUT and must never prove a customer paid; a payment held in
-- `review` (for example a possibly forged SMS) is not trusted yet, so it is reported as not found.
--
-- A rate limit per API key stops anyone with a key from guessing IDs at speed.

create table if not exists public.verify_rate (
  key_id text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key_id, window_start)
);
alter table public.verify_rate enable row level security; -- no policies: only the service role can touch it

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

  return jsonb_build_object('found', exists (
    select 1 from public.payments
     where trx_id = upper(btrim(p_trx))
       and (p_provider is null or provider = p_provider)
       and txn_type in ('payment_received', 'send_money_received')
       and status in ('unmatched', 'matched')
  ));
end $$;

revoke all on function public.verify_transaction(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.verify_transaction(text, text, text, integer) to service_role;
