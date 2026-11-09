-- 079: a phone control that reads the bKash APP's screens (test step, owner 2026-11-10: "on dial it only shows 6, we are
-- missing so many transactions ... test on the Vivo first"). The *247# statement lists only the newest few entries with no
-- times; the bKash Agent app's own list goes back days with the time of each entry. Before PayTrace can read that app by
-- itself, the phone must show what an accessibility service is allowed to read there, so this kind only records: the phone
-- opens the bKash app and writes down the words on its screens for 2½ minutes while a person logs in and scrolls by hand,
-- and sends them back as the command's screens (the existing command_result path, 12 x 2,000 characters). It names no
-- wallet, so it is queued with queue_phone_action like the other controls.
insert into public.phone_command_kinds (kind, needs_wallet) values ('apprecord', false) on conflict (kind) do nothing;
