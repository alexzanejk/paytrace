-- Personal bKash balance by USSD (owner's recording 2026-11-17): *247# -> My bKash -> Check Balance -> PIN.
-- A dashboard command of its own kind, "pbalance", that names no wallet on the server: the phone checks every personal
-- bKash account saved in its app (one per SIM, each with its own PIN that never leaves the phone) and answers with one
-- line per account. Queued through the existing admin RPC queue_phone_action, which already accepts any kind with
-- needs_wallet = false. Read only: nothing here can move money.

insert into public.phone_command_kinds (kind, needs_wallet) values ('pbalance', false)
on conflict (kind) do nothing;

-- It walks the phone's dialer like a balance check, so it waits for any other menu or app work on that phone (and they
-- wait for it), instead of being handed over and answered "busy".
do $$
declare d text;
begin
  select pg_get_functiondef('public.device_next_command(uuid)'::regprocedure) into d;
  if position('''pbalance''' in d) = 0 then
    d := replace(d, '''nagadrecord'')', '''nagadrecord'', ''pbalance'')');
    execute d;
  end if;
end $$;
