-- 071: the Jobs page could not load ("permission denied for function wallet_ledger_rows", owner screenshot 2026-11-08).
-- Since migration 059/063 the view device_open_jobs subtracts the B2B float, which is worked out by wallet_ledger_rows, a
-- server-only function; Postgres checks that function against the signed-in admin, not the view's owner. Same cause and
-- same cure as migration 060 (wallet_b2b_floats): an admin-only security-definer doorway. The view itself is unchanged,
-- so the phones' jobs (read by the server) were never affected.
create or replace function public.admin_open_jobs() returns setof public.device_open_jobs
language sql stable security definer set search_path = public as $$
  select * from public.device_open_jobs where public.is_admin();
$$;

revoke all on function public.admin_open_jobs() from public, anon;
grant execute on function public.admin_open_jobs() to authenticated, service_role;
