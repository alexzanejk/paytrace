-- 109: a phone's own "timeout" means the PIN was never typed (since 107 the server's own give-up is "no_reply", and the
-- phone turns a timeout after the PIN into "no_answer_after_pin"), so nothing can have reached the wallet: the payout is
-- released at once instead of waiting for a wallet check. Found 2026-11-19: a Tk 1,750 Cash In on rubel's Xiaomi timed
-- out with "nothing of the dialer can be read", and the check then waited 15 minutes because the same phone could open
-- neither the bKash app nor the dialer for its own check.
create or replace function public.payout_never_started(p_error text)
returns boolean language sql immutable as $$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'cash_in_off', 'no_pin', 'no_accessibility',
    'accessibility_not_running', 'no_call_permission', 'unsupported', 'bad_cash_in', 'personal_off', 'no_personal',
    'phone_locked', 'dialer_blocked', 'too_soon', 'no_bkash_app', 'no_nagad_app', 'sim_not_found', 'sim_no_service',
    'dial_failed', 'app_not_opened', 'login_failed', 'pin_not_entered', 'secure_keyboard', 'timeout');
$$;

-- Payouts and commission payments already waiting on a check for a phone timeout are released the same way.
update public.payouts set status = 'failed', check_done_at = now(),
       check_note = 'The phone never typed the PIN (it timed out before the menu), so nothing was sent.'
 where status = 'sending' and check_done_at is null and check_error = 'timeout';
update public.payout_items i set live = false from public.payouts o
 where o.id = i.payout_id and o.status = 'failed' and o.check_error = 'timeout' and i.live;
update public.commission_pays set status = 'failed', check_done_at = now(),
       check_note = 'The phone never typed the PIN (it timed out before the menu), so nothing was sent.'
 where status = 'sending' and check_done_at is null and check_error = 'timeout';
update public.commission_pay_days d set live = false from public.commission_pays p
 where p.id = d.pay_id and p.status = 'failed' and p.check_error = 'timeout' and d.live;
