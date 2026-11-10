-- 083a: let phone_commands hold a "btob" command (B2B; kind names are letters only, so not "b2b") (owner 2026-11-10: "now we will build full b2b perform on app").
--
-- Three CHECKs name the kinds that carry money / a wallet and the largest amount; a CHECK cannot be widened in place, so each
-- is replaced. This is the only part of 083 that removes anything, so it is its own file: if the Supabase MCP stalls on it,
-- the owner pastes it into the SQL editor (as with 054 and 066a). The per-kind limits stay in the functions that queue
-- commands too; the table keeps the hard ceiling per kind: 50,000 for a cash-in or Send Money as before, 250,000 for a B2B
-- (the largest quick-pick the bKash app itself offers on its B2B screen).

alter table public.phone_commands drop constraint if exists phone_commands_money_fields;
alter table public.phone_commands add constraint phone_commands_money_fields check (
  (kind in ('cashin', 'sendmoney', 'btob') and amount is not null and to_number is not null)
  or (kind not in ('cashin', 'sendmoney', 'btob') and amount is null and to_number is null));

alter table public.phone_commands drop constraint if exists phone_commands_wallet_or_not2;
alter table public.phone_commands drop constraint if exists phone_commands_wallet_or_not3;
alter table public.phone_commands add constraint phone_commands_wallet_or_not3 check (
  (kind in ('balance', 'cashin', 'statement', 'sendmoney', 'btob') and provider is not null)
  or (kind not in ('balance', 'cashin', 'statement', 'sendmoney', 'btob') and provider is null));

alter table public.phone_commands drop constraint if exists phone_commands_amount_check4;
alter table public.phone_commands drop constraint if exists phone_commands_amount_check5;
alter table public.phone_commands add constraint phone_commands_amount_check5 check (
  amount is null or (amount >= 100 and amount <= case when kind = 'btob' then 250000 else 50000 end));
