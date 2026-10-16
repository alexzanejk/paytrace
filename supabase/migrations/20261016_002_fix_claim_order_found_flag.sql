-- Applied as migration "fix_claim_order_found_flag". Fixes claim_order reporting 'no_payment' when a claim
-- arrived before its payment: the FOUND flag was reset by later statements, so test the row id instead.
create or replace function public.claim_order(p_order_no text, p_provider text, p_trx_id text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders; pay public.payments; t text := upper(btrim(p_trx_id)); r text;
begin
  if p_provider not in ('bkash','nagad','rocket','upay') or length(t) < 6 then
    return jsonb_build_object('result', 'invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || t, 0));

  select * into o from public.orders where order_no = p_order_no for update;
  if o.id is null then return jsonb_build_object('result', 'order_not_found'); end if;
  if o.status = 'paid' then return jsonb_build_object('result', 'already_paid'); end if;
  if o.status <> 'pending' then return jsonb_build_object('result', o.status); end if;
  if o.expires_at < now() then
    update public.orders set status = 'expired' where id = o.id;
    return jsonb_build_object('result', 'expired');
  end if;
  if o.claim_attempts >= 5 then return jsonb_build_object('result', 'too_many_attempts'); end if;
  update public.orders set claim_attempts = claim_attempts + 1,
         customer_phone = coalesce(customer_phone, nullif(btrim(p_phone), ''))
   where id = o.id;

  select * into pay from public.payments where provider = p_provider and trx_id = t;
  if pay.id is not null and pay.status in ('matched','ignored','tracked_only') then
    return jsonb_build_object('result', 'payment_already_used');
  end if;

  begin
    update public.orders set claimed_provider = p_provider, claimed_trx_id = t where id = o.id;
  exception when unique_violation then
    return jsonb_build_object('result', 'trx_already_claimed');
  end;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('claim', p_provider, pay.id, o.id, jsonb_build_object('trx_id', t));

  if pay.id is not null then r := public.reconcile_payment(pay.id); else r := 'waiting_for_payment'; end if;
  return jsonb_build_object('result', r);
end $$;

revoke all on function public.claim_order(text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_order(text,text,text,text) to service_role;
