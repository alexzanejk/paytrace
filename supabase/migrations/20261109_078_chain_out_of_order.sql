-- 078: two messages that arrive in the same moment can be stored in the wrong order, and the balance check then judges a
-- real receipt against the wrong predecessor (owner 2026-11-09, DK959OSWE3 on rubel's bKash, held as "possibly a fake SMS").
--
--   12:23  DK909NWYFC  balance 13,227.04
--   12:36  DK959OSWE3  +500  balance 14,231.04   stored 0.27 s FIRST  -> compared with 13,227.04 -> mismatch, held
--   12:36  DK989OM97W  +500  balance 13,729.04   stored second        -> compared with 13,227.04 -> ok
--   true order: 13,227.04 -> M97W 13,729.04 -> SWE3 14,231.04 (= 13,729.04 + 500 + 2.00 commission) -> 12:48 cash-in.
--
-- The fix is the normal balance check, done again against the messages that arrived around the same time: a held receipt
-- (balance_chain_mismatch, money in) is released when another message of the same phone, wallet and SIM, received within
-- 3 minutes of it, whose own balance check passed (chain ok), is exactly its predecessor:
--   held.balance = that balance + held.amount + commission
-- with the commission exact (1 paisa) when the receipt prints it (Nagad, Rocket) and 0 to 0.6% + Tk 0.50 when it does not
-- (bKash). This is the same proof the chain always uses (a forger cannot know a real running balance); it is NOT the "next
-- message continued from its balance" rule the owner turned down on 2026-11-07, because the held receipt's own balance is
-- checked against its own predecessor.
--
-- Runs from an AFTER INSERT trigger on payments (whichever of the two is stored second finds the other), wrapped so it can
-- never stop a payment from being stored. Release goes through payment_check_confirm (how = 'balance'), which reconciles the
-- order exactly as a wallet-confirmed hold does. No app or edge function change. No DROP or DELETE.

create or replace function public.chain_recheck_held(p_device uuid, p_provider text, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare h record; y record; why text; r text; out jsonb := '[]'::jsonb;
begin
  for h in
    select * from public.payments p
     where p.device_id = p_device and p.provider = p_provider
       and p.status = 'review' and p.review_reason = 'balance_chain_mismatch' and p.chain_status = 'mismatch'
       and p.txn_type in ('cash_out', 'send_money_received', 'payment_received')
       and p.balance is not null and p.amount > 0
       and p.received_at between p_at - interval '3 minutes' and p_at + interval '3 minutes'
  loop
    select x.* into y from public.payments x
     where x.device_id = h.device_id and x.provider = h.provider and x.id <> h.id
       and x.chain_status = 'ok' and x.balance is not null
       and coalesce(x.review_reason, '') <> 'not_ours'
       and (h.sim_slot is null or x.sim_slot is null or x.sim_slot = h.sim_slot)
       and abs(extract(epoch from x.received_at - h.received_at)) <= 180
       and case when coalesce(h.commission, 0) > 0
                then abs(h.balance - x.balance - h.amount - h.commission) <= 0.01
                else h.balance - x.balance - h.amount between -0.01 and h.amount * 0.006 + 0.5 end
     order by abs(extract(epoch from x.received_at - h.received_at)) limit 1;
    if y.id is null then continue; end if;
    why := format('The balance follows exactly from %s (Tk %s), which arrived at the same moment: the two messages were stored in the wrong order.',
                  y.trx_id, to_char(y.balance, 'FM999,999,990.00'));
    update public.payments set chain_status = 'ok' where id = h.id;
    insert into public.payment_checks (payment_id, step, status, detail, finished_at)
      values (h.id, 'balance', 'confirmed', why, now());
    begin
      update public.balance_gaps set explained_by = 'owner', explained_at = now(),
             note = left('Not a real gap: ' || why, 200)
       where payment_id = h.id and explained_by is null;
    exception when others then null;
    end;
    r := public.payment_check_confirm(h.id, 'balance', why);
    out := out || jsonb_build_object('payment_id', h.id, 'trx_id', h.trx_id, 'after', y.trx_id, 'result', r);
  end loop;
  return out;
end $$;

revoke all on function public.chain_recheck_held(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.chain_recheck_held(uuid, text, timestamptz) to service_role;

create or replace function public.payments_chain_recheck() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.device_id is not null and new.balance is not null then
    begin
      perform public.chain_recheck_held(new.device_id, new.provider, new.received_at);
    exception when others then null;
    end;
  end if;
  return new;
end $$;

create trigger payments_chain_recheck after insert on public.payments
  for each row execute function public.payments_chain_recheck();

-- Holds already waiting from the last 2 days (DK959OSWE3 among them).
do $b$
declare p record;
begin
  for p in select distinct device_id, provider, received_at from public.payments
            where status = 'review' and review_reason = 'balance_chain_mismatch' and device_id is not null
              and received_at > now() - interval '2 days'
  loop
    perform public.chain_recheck_held(p.device_id, p.provider, p.received_at);
  end loop;
end $b$;
