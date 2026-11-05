-- 060: the dashboard could not read the B2B float (owner 2026-11-05: "opening b2b not saving").
-- The save worked (set_wallet_b2b_opening is a security-definer function), but the page reads wallet_b2b_float, a view that
-- calls wallet_ledger_rows. Postgres checks EXECUTE on a function called inside a view against the person running the
-- query, and wallet_ledger_rows is (on purpose) executable only by the server. So every read from the signed-in admin
-- failed with "permission denied for function wallet_ledger_rows" (PostgREST 403, error 42501) and the page, which hides
-- a failure there, showed Tk 0.00 for every opening.
-- Fix: an admin-only wrapper that runs as its owner, so the view's inner function is allowed. The view and everything that
-- already reads it as the server (jobs, cash-in jobs) stay exactly as they are.
create or replace function public.wallet_b2b_floats()
returns setof public.wallet_b2b_float
language sql stable security definer set search_path = public as $$
  select * from public.wallet_b2b_float where public.is_admin()
$$;
revoke all on function public.wallet_b2b_floats() from public, anon;
grant execute on function public.wallet_b2b_floats() to authenticated, service_role;
