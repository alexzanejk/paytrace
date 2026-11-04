-- 056: housekeeping, batch 4 of the 2026-11-04 audit.
--  1. Indexes: the transaction-check API looks payments up by TrxID alone (the unique index starts with provider, so
--     that was a full scan), plus the seven foreign keys Supabase's advisor listed without a covering index.
--  2. Four SECURITY DEFINER functions were callable by anyone holding the public key (anon) and by any signed-in user,
--     although only the Edge Functions (service role) ever call them. They could not credit money, but they could
--     write command results and webhook tries. Now service role only.
--  3. The admins policy evaluates auth.uid() once per query instead of once per row (advisor lint).
--  4. gw_deliver_gate: the gateway's /deliver route (called by pg_cron, which cannot present a secret) now does work
--     at most once every 2 seconds for an unauthenticated caller; the Edge Functions call it with the service key
--     and are never gated. Outsiders can no longer burn Edge Function time through it.
-- No DROP or DELETE (the MCP hangs on them).

create index if not exists payments_trx_idx on public.payments (trx_id);
create index if not exists orders_device_idx on public.orders (device_id);
create index if not exists webhook_outbox_order_idx on public.webhook_outbox (order_id);
create index if not exists phone_commands_kind_idx on public.phone_commands (kind);
create index if not exists devices_default_group_idx on public.devices (default_group);
create index if not exists cashin_jobs_payment_idx on public.cashin_jobs (payment_id);
create index if not exists job_transfers_payment_idx on public.job_transfers (payment_id);

revoke all on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.balance_chain_check(text, timestamptz, numeric, numeric, numeric, numeric, uuid) to service_role;
revoke all on function public.device_command_finish(uuid, uuid, boolean, numeric, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.device_command_finish(uuid, uuid, boolean, numeric, text, jsonb, text) to service_role;
revoke all on function public.device_command_result(uuid, uuid, boolean, numeric, text, text) from public, anon, authenticated;
grant execute on function public.device_command_result(uuid, uuid, boolean, numeric, text, text) to service_role;
revoke all on function public.gw_webhook_result2(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.gw_webhook_result2(bigint, boolean, text) to service_role;

alter policy admins_read on public.admins using (user_id = (select auth.uid()));

create table if not exists public.gw_runs (
  id boolean primary key default true,
  last_run_at timestamptz not null default to_timestamp(0),
  constraint gw_runs_one check (id)
);
alter table public.gw_runs enable row level security;
revoke all on public.gw_runs from anon, authenticated;
insert into public.gw_runs (id) values (true) on conflict do nothing;

create or replace function public.gw_deliver_gate(p_min_gap_ms integer default 2000) returns boolean
language plpgsql security definer set search_path = public as $$
declare last_at timestamptz;
begin
  insert into public.gw_runs (id) values (true) on conflict do nothing;
  select last_run_at into last_at from public.gw_runs where id for update;
  if last_at > now() - make_interval(secs => greatest(coalesce(p_min_gap_ms, 2000), 100) / 1000.0) then
    return false;
  end if;
  update public.gw_runs set last_run_at = now() where id;
  return true;
end $$;
revoke all on function public.gw_deliver_gate(integer) from public, anon, authenticated;
grant execute on function public.gw_deliver_gate(integer) to service_role;
