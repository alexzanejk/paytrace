-- The newest phone-app version, so the Phones page can flag phones that are behind (update system, step 1).
-- One row. For now the owner types the number on the Phones page; later the build can set it by itself.
-- `apk_url` and `required` are kept for the in-app updater (steps 2-3) and are not used yet.
create table if not exists public.app_release (
  id boolean primary key default true check (id),
  version_code integer not null default 0 check (version_code >= 0),
  version_name text not null default '',
  notes text check (notes is null or length(notes) <= 300),
  apk_url text,
  required boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.app_release (id, version_code, version_name) values (true, 64, '1.0.64') on conflict (id) do nothing;

alter table public.app_release enable row level security;
create policy app_release_read on public.app_release for select to authenticated using (public.is_admin());
revoke all on public.app_release from anon, authenticated;
grant select on public.app_release to authenticated;

create or replace function public.set_app_release(p_version_code integer, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_version_code is null or p_version_code < 1 or p_version_code > 100000 then raise exception 'version must be a whole number from 1 to 100000'; end if;
  update public.app_release
     set version_code = p_version_code, version_name = '1.0.' || p_version_code, notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
   where id;
end $$;
revoke all on function public.set_app_release(integer, text) from public, anon, authenticated;
grant execute on function public.set_app_release(integer, text) to authenticated;

-- The instant-push trigger function (migration 039) is only ever run by the trigger, never through the public API.
revoke all on function public.hub_push_payment() from public, anon, authenticated;
