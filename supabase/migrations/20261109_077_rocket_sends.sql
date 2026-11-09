-- 077: a Rocket agent wallet can send a payout or a commission payment by Cash In (owner 2026-11-09: "why sadikur rocket
-- not showing?" on the Payout page's sender list).
--
-- The phone card's own Cash In has accepted Rocket since 2026-11-02 (the owner chose to allow Rocket's bare PIN screen, which
-- never repeats the number and amount back; PayTrace types both into Rocket's own boxes first). `create_payout` (065-067)
-- and `create_commission_pay` (068) were written later with a bKash/Nagad-only line. This lifts that line for an AGENT Cash
-- In only; personal Send Money stays bKash only (no recording of Rocket's or Nagad's personal Send Money menu).
--
-- The two functions are patched in place (replace on their current definition) so nothing else in them changes. The SMS
-- triggers that settle a payment (payouts_follow_sms, commission_pays_follow_sms) never looked at the provider, and Rocket's
-- "B2C: Cash-In to A/C" SMS is read as cash_in_sent since 075, so a Rocket send settles by SMS like the others.

do $m$
declare src text; out text;
begin
  select pg_get_functiondef('public.create_payout(uuid[], uuid, text, text, numeric, text, text)'::regprocedure) into src;
  out := replace(src, $x$if p_provider not in ('bkash', 'nagad') then raise exception 'only bKash and Nagad wallets can send'; end if;$x$,
                      $x$if p_provider not in ('bkash', 'nagad', 'rocket') then raise exception 'only bKash, Nagad and Rocket wallets can send'; end if;$x$);
  if out = src then raise exception 'create_payout: line not found'; end if;
  execute out;

  select pg_get_functiondef('public.create_commission_pay(uuid, date[], text, uuid, text, text)'::regprocedure) into src;
  out := replace(src, $x$if p_provider not in ('bkash', 'nagad') then raise exception 'only bKash and Nagad can send'; end if;$x$,
                      $x$if p_provider not in ('bkash', 'nagad', 'rocket') then raise exception 'only bKash, Nagad and Rocket can send'; end if;$x$);
  if out = src then raise exception 'create_commission_pay: line not found'; end if;
  execute out;
end $m$;
