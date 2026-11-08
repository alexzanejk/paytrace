-- 066a: paste this into the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> Run). The MCP cannot run it because
-- it removes two old checks. It only widens them: the new 'sendmoney' command kind may carry an amount and a number, like a
-- cash-in, and must name its wallet. Nothing else changes and no row is touched.
alter table public.phone_commands drop constraint if exists phone_commands_cashin_fields;
alter table public.phone_commands add constraint phone_commands_money_fields check (
  (kind in ('cashin', 'sendmoney') and amount is not null and to_number is not null)
  or (kind not in ('cashin', 'sendmoney') and amount is null and to_number is null));
alter table public.phone_commands drop constraint if exists phone_commands_wallet_or_not;
alter table public.phone_commands add constraint phone_commands_wallet_or_not2 check (
  (kind in ('balance', 'cashin', 'statement', 'sendmoney') and provider is not null)
  or (kind not in ('balance', 'cashin', 'statement', 'sendmoney') and provider is null));
