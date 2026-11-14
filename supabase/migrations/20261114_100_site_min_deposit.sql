-- 100: a smallest deposit per website (owner 2026-11-14: "currently our minimum deposit for sites is 500; let me
-- optionally give specific sites a minimum of 100"; "same rule for USDT too").
-- Every site keeps 500 until the owner lowers it; it can never go under 100 (and never above the old 500). The
-- 50,000 maximum is the same for every site. The rule lives where the order is made (gw_create_deposit and
-- gw_create_crypto_deposit), so a website cannot get around it. Nothing removed (MCP rule).

alter table public.api_keys add column if not exists min_deposit integer not null default 500;
do $$ begin
  alter table public.api_keys add constraint api_keys_min_deposit_range check (min_deposit between 100 and 500);
exception when duplicate_object then null; end $$;
-- Admins read site settings column by column (the key itself is in no grant).
grant select (min_deposit) on public.api_keys to authenticated;

-- The smallest deposit a site may ask for; 500 for anything unknown.
create or replace function public.gw_min_deposit(p_key uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select k.min_deposit from public.api_keys k where k.id = p_key), 500)
$$;
revoke all on function public.gw_min_deposit(uuid) from public, anon, authenticated;
grant execute on function public.gw_min_deposit(uuid) to service_role;

-- The owner sets it on the Websites page: whole taka, 100 to 500.
create or replace function public.set_key_min_deposit(p_id uuid, p_amount integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_old integer;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 500 then
    raise exception 'the smallest deposit must be a whole amount from 100 to 500 taka';
  end if;
  select min_deposit into v_old from public.api_keys where id = p_id and revoked_at is null;
  if not found then raise exception 'unknown website'; end if;
  update public.api_keys set min_deposit = p_amount where id = p_id;
  insert into public.events (kind, detail) values ('site_min_deposit_set',
    jsonb_build_object('key_id', p_id, 'from', v_old, 'to', p_amount, 'by', auth.uid()));
end $$;
revoke all on function public.set_key_min_deposit(uuid, integer) from public, anon;
grant execute on function public.set_key_min_deposit(uuid, integer) to authenticated;

-- The two live deposit makers (taka with and without a partner group, and USDT) check the site's own minimum.
-- Patched in place: only the amount line and its message change; the site's id (kid) is known before that line.
do $$
declare r record; d text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('gw_create_deposit', 'gw_create_crypto_deposit')
      and pg_get_functiondef(p.oid) like '%p_amount < 500 or p_amount > 50000%'
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'p_amount < 500 or p_amount > 50000', 'p_amount < public.gw_min_deposit(kid) or p_amount > 50000');
    d := replace(d, '''amount must be between 500 and 50000 taka, with at most 2 decimals''',
      'format(''amount must be between %s and 50000 taka, with at most 2 decimals'', public.gw_min_deposit(kid))');
    execute d;
  end loop;
end $$;
