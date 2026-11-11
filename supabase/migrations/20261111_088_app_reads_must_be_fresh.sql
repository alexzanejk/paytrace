-- 088: a bKash app read only counts as "covering" a payment when its list was FRESH past that payment.
-- Found 2026-11-11: a real Tk 2,000 Cash Out (DKB6CCN518, Vivo, 13:16) was flagged `not_in_bkash_app` ("likely a fake
-- SMS") by two reads at 13:33 and 13:34 whose Inbox list had not refreshed: their newest rows were 13:15 and 11:38. The
-- balance arithmetic proves the payment was real (13:15 B2B left 7,037.82; +2,000 +8 commission = 9,045.82, the SMS
-- balance; the 13:57 Cash Out's balance continues from it). The 085 rule counted any read that started 2 minutes after
-- the SMS and reached back before it, so a stale list "proved" a real payment absent.
-- Now a read covers a payment only if it ALSO listed a row at or after the payment's minute. No DROP or DELETE.

create or replace function public.app_reads_covering(p_payment uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.payments p
    join public.phone_commands c on c.device_id = p.device_id and c.kind = 'appread' and c.status = 'done'
   where p.id = p_payment
     and c.started_at >= coalesce(p.occurred_at, p.received_at) + interval '2 minutes'
     and substring(c.screens->>0 from 'oldest: ([0-9]{10,14})') is not null
     and to_timestamp((substring(c.screens->>0 from 'oldest: ([0-9]{10,14})'))::bigint / 1000.0)
         <= coalesce(p.occurred_at, p.received_at) - interval '1 minute'
     -- the list itself reached past the payment: a stale list (cached, not refreshed) decides nothing
     and exists (select 1 from jsonb_array_elements(public.app_read_lines(c.screens)) x
                  where (x->>'at')::timestamptz >= date_trunc('minute', coalesce(p.occurred_at, p.received_at)));
$$;
revoke all on function public.app_reads_covering(uuid) from public, anon, authenticated;
grant execute on function public.app_reads_covering(uuid) to service_role;

-- The one payment wrongly flagged this way goes back to an ordinary chain hold, so the next read looks for it again
-- (by its TrxID in the Statements search too) instead of calling it a fake.
update public.payments
   set review_reason = 'balance_chain_mismatch'
 where review_reason = 'not_in_bkash_app'
   and status = 'review'
   and public.app_reads_covering(id) < 2;
