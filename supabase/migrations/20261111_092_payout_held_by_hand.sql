-- A held transaction can be marked paid out BY HAND (owner 2026-11-11: "if I want to mark paid a transaction on payout which is
-- held on the review I should be able to"; "only be marked paid out"). It stays held on Review: nothing about the payment changes,
-- it is not counted in the totals and Admin Hub still sees it as held. A phone send (create_payout) still refuses it, so no phone
-- ever moves money for a payment nobody has proved; the same live-payout rule stops it being paid twice.

create or replace function public.payout_refusal_manual(p_payment uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.id is null then 'not found'
    when coalesce(p.review_reason, '') = 'not_ours' then 'not one of this phone''s wallets'
    when p.txn_type not in ('cash_out', 'send_money_received', 'payment_received') then 'not money received'
    when p.status = 'ignored' then 'ignored'
    when p.status <> 'review' and not public.payment_counted(p.status, p.chain_status, p.txn_type, p.review_reason) then 'not counted'
    when exists (select 1 from public.payout_items i where i.payment_id = p.id and i.live) then 'already paid out'
    else null end
  from (select 1) one left join public.payments p on p.id = p_payment;
$$;
revoke all on function public.payout_refusal_manual(uuid) from public, anon;
grant execute on function public.payout_refusal_manual(uuid) to authenticated, service_role;

-- manual_payout: the one check line changes, nothing else (the current definition is patched in place).
do $$
declare def text;
begin
  select pg_get_functiondef('public.manual_payout(uuid[], numeric, text, text, text)'::regprocedure) into def;
  if position('public.payout_refusal(pid)' in def) = 0 then raise exception 'manual_payout has changed; patch by hand'; end if;
  execute replace(def, 'public.payout_refusal(pid)', 'public.payout_refusal_manual(pid)');
end $$;
