-- The watcher says when it last looked at each network and whether it had a problem, so the owner can see the check is alive on the Crypto page.
alter table public.crypto_settings
  add column if not exists bep20_checked_at timestamptz,
  add column if not exists bep20_error text,
  add column if not exists trc20_checked_at timestamptz,
  add column if not exists trc20_error text;
grant select (bep20_checked_at, bep20_error, trc20_checked_at, trc20_error) on public.crypto_settings to authenticated;

create or replace function public.crypto_report(p_chain text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_chain = 'bep20' then update public.crypto_settings set bep20_checked_at = now(), bep20_error = left(p_error, 200) where id;
  elsif p_chain = 'trc20' then update public.crypto_settings set trc20_checked_at = now(), trc20_error = left(p_error, 200) where id;
  end if;
end $$;
revoke all on function public.crypto_report(text, text) from public, anon, authenticated;
grant execute on function public.crypto_report(text, text) to service_role;
