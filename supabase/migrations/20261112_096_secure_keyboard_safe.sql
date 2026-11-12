-- 096: a wallet app run that stopped because the phone's own secure PIN keyboard hid the keys (Vivo "Secure input",
-- 2026-11-12) typed nothing and pressed nothing, so a payout or commission pay that ended this way sent nothing.
create or replace function public.payout_safe_error(p_error text)
 returns boolean language sql immutable
as $function$
  select coalesce(p_error, '') in ('expired', 'not_allowed', 'no_accessibility', 'accessibility_not_running', 'no_call_permission', 'no_pin',
    'busy', 'too_soon', 'cash_in_off', 'bad_cash_in', 'confirm_does_not_match', 'wallet_refused', 'phone_locked', 'unsupported',
    'dialled_as_call', 'sim_no_service', 'sim_not_found', 'dial_failed', 'network_refused', 'personal_off', 'no_personal',
    'no_bkash_app', 'app_not_opened', 'login_failed', 'pin_not_entered', 'app_stopped_before_send', 'insufficient_balance',
    'pin_refused', 'no_nagad_app', 'app_error', 'secure_keyboard');
$function$;
