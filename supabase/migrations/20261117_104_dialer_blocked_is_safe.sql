-- A payout whose phone never opened the dialer (owner 2026-11-17, Xiaomi 2209116AG: "it didn't even open USSD") ended as
-- "unsure", so its transactions stayed taken until the owner pressed "It was NOT sent". Two answers mean nothing was typed:
--   dialer_blocked - new in app build 1.0.250: the dialer never came on screen within 12 s (Xiaomi's pop-up permission off).
--   timeout        - the run's time ran out BEFORE the PIN went into the box (once the PIN is typed the phone answers
--                    no_answer_after_pin instead, and that stays unsure).
-- Both now count as safe: the payout ends "failed" and its transactions are free to pay again.
create or replace function public.payout_safe_error(p_error text)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused', 'personal_off', 'no_personal',
    'no_bkash_app', 'app_not_opened', 'login_failed', 'pin_not_entered', 'app_stopped_before_send', 'insufficient_balance',
    'pin_refused', 'no_nagad_app', 'app_error', 'secure_keyboard', 'dialer_blocked', 'timeout');
$function$;
