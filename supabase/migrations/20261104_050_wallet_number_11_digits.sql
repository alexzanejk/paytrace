-- 050: a deposit number must be a real Bangladesh mobile number (owner 2026-11-04).
-- WHY: the Nagad number on one phone was saved with 10 digits ("0183493489"); 89 deposit orders in three days showed it to
-- customers and none could pay. The old rule allowed 10 to 13 digits. Now the number must be 11 digits starting with 01;
-- "+880 17..." and "880 17..." are folded to the 01 form first, so a number pasted from a contact still works.
-- The old CHECK stays (DROP hangs through the MCP); the new one is NOT VALID so the one wrong row that exists keeps its
-- place until the owner replaces it (adding the same wallet again replaces the number).
alter table public.device_wallets
  add constraint device_wallets_wallet_number_bd check (wallet_number ~ '^01[0-9]{9}$') not valid;

create or replace function public.set_device_wallet(p_device_id uuid, p_provider text, p_number text, p_method text, p_enabled boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n text := regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('bkash','nagad','rocket','upay') then raise exception 'unknown provider'; end if;
  if p_method not in ('send_money','cash_out') then raise exception 'method must be send_money or cash_out'; end if;
  -- +880 1712 345678 / 880 1712345678 -> 01712345678
  if n ~ '^8801[0-9]{9}$' then n := '0' || substr(n, 4); end if;
  if n !~ '^01[0-9]{9}$' then
    raise exception 'enter the full 11-digit wallet number starting with 01 (you typed % digits)', length(n);
  end if;
  if not exists (select 1 from public.devices where id = p_device_id and status = 'approved') then
    raise exception 'phone not found or not approved';
  end if;
  insert into public.device_wallets (device_id, provider, wallet_number, method, enabled, wallet_group)
    values (p_device_id, p_provider, n, p_method, coalesce(p_enabled, true),
            coalesce((select default_group from public.devices where id = p_device_id), 'main'))
  on conflict (device_id, provider) do update
    set wallet_number = excluded.wallet_number, method = excluded.method, enabled = excluded.enabled;
  insert into public.events(kind, provider, detail)
    values ('wallet_set', p_provider, jsonb_build_object('device_id', p_device_id, 'method', p_method, 'enabled', coalesce(p_enabled, true), 'by', auth.uid()));
end $function$;
