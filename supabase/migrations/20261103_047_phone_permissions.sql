-- 047: the switches "let the dashboard check the balance" and "let the dashboard send money from this phone" move from the
-- phone app to the dashboard (owner 2026-11-03: these must be changed from the dashboard only, so nobody changes them by
-- mistake on a phone). The phone follows what it is told on its heartbeat reply (ingest v32).
--   allow_balance  default TRUE  : balance checks and statements worked before this change, so they keep working.
--   allow_cashin   default FALSE : sending money stays off until the owner switches it on, here.
-- The cash-in daily limit (cashin_limits, 0 = off) and every phone-side safety rule are unchanged and still apply on top.
alter table public.devices add column if not exists allow_balance boolean not null default true;
alter table public.devices add column if not exists allow_cashin boolean not null default false;

create or replace function public.set_device_permissions(p_device uuid, p_balance boolean, p_cashin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.devices
     set allow_balance = coalesce(p_balance, allow_balance), allow_cashin = coalesce(p_cashin, allow_cashin)
   where id = p_device and status <> 'revoked';
  if not found then raise exception 'phone not found'; end if;
  insert into public.events(kind, detail)
    values ('phone_permissions_set', jsonb_build_object('device_id', p_device, 'balance', p_balance, 'cashin', p_cashin, 'by', auth.uid()));
end $$;
revoke all on function public.set_device_permissions(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_device_permissions(uuid, boolean, boolean) to authenticated;
