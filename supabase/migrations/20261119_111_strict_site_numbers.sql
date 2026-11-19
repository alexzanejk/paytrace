-- 111: a per-site "only the numbers I ticked" switch (owner 2026-11-19: "even if I unselect a number for a site, those
-- deposit numbers are showing on all the sites"). Since 057 a site with NO tick for a wallet type is given every main
-- number of that type (so a site works on day one). That fallback is what the owner saw. With strict_numbers ON a site
-- is given ONLY its ticked numbers, and a wallet type with no tick refuses that deposit (no_wallet, HTTP 409, event
-- deposit_refused_no_wallet) instead of showing somebody else's number. Off by default: nothing changes until the
-- owner switches a site over, and the Numbers by site page says what each site would refuse.
alter table public.api_keys add column if not exists strict_numbers boolean not null default false;
grant select (strict_numbers) on public.api_keys to authenticated;

create or replace function public.set_key_strict_numbers(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.api_keys set strict_numbers = coalesce(p_on, false) where id = p_id and revoked_at is null;
  if not found then raise exception 'website key not found'; end if;
  insert into public.events (kind, detail) values ('site_strict_numbers_set', jsonb_build_object('key_id', p_id, 'on', coalesce(p_on, false), 'by', auth.uid()));
end $$;
revoke all on function public.set_key_strict_numbers(uuid, boolean) from public, anon;
grant execute on function public.set_key_strict_numbers(uuid, boolean) to authenticated;

-- The same function as 057 with one more line in the pool: the fallback to every main number only while the site is
-- not strict. Everything else (main group, approved phone, online first, least recently handed out) is unchanged.
create or replace function public.gw_find_wallet_for_site(p_key uuid, p_provider text, p_method text)
returns public.device_wallets language sql stable security definer set search_path = public as $$
  select w.* from public.device_wallets w where w.id = (
    with mine as (
      select w2.id, w2.last_assigned_at, d.last_seen_at
        from public.device_wallets w2 join public.devices d on d.id = w2.device_id
       where w2.provider = p_provider and w2.enabled and d.status = 'approved' and w2.wallet_group = 'main'
         and (p_method is null or w2.method = p_method)
    ), chosen as (
      select m.* from mine m
       where exists (select 1 from public.site_wallets s where s.api_key_id = p_key and s.wallet_id = m.id and s.enabled)
    ), pool as (
      select * from chosen
      union all
      select * from mine
       where not exists (select 1 from chosen)
         and not coalesce((select k.strict_numbers from public.api_keys k where k.id = p_key), false)
    )
    select p.id from pool p
     order by (p.last_seen_at is not null and p.last_seen_at > now() - interval '90 seconds') desc,
              (p.last_seen_at is not null and p.last_seen_at > now() - interval '10 minutes') desc,
              p.last_assigned_at asc nulls first
     limit 1);
$$;
