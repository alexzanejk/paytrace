-- Device pairing: each phone makes its own random key, asks to join, and an admin approves it in the dashboard.
-- Only a SHA-256 hash of the key is stored. A phone can be removed on its own without touching the others.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  pair_code text not null,
  name text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  last_seen_at timestamptz
);
create index devices_pending_idx on public.devices (created_at) where status = 'pending';

alter table public.devices enable row level security;
create policy devices_read on public.devices for select to authenticated using (public.is_admin());
revoke all on public.devices from anon;
revoke insert, update, delete on public.devices from authenticated;

-- Approve a pending phone, or remove (revoke) any phone. A removed phone must pair again with a new code.
create or replace function public.set_device_status(p_device_id uuid, p_status text)
returns text language plpgsql security definer set search_path = public as $$
declare d public.devices;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('approved','revoked') then raise exception 'bad status'; end if;
  update public.devices
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() else approved_at end
   where id = p_device_id and (p_status = 'revoked' or status = 'pending')
  returning * into d;
  if d.id is null then raise exception 'device not found or not pending'; end if;
  insert into public.events(kind, detail)
    values ('device_' || p_status, jsonb_build_object('device_id', d.id, 'name', d.name, 'code', d.pair_code, 'by', auth.uid()));
  return d.status;
end $$;

revoke all on function public.set_device_status(uuid,text) from public, anon;
grant execute on function public.set_device_status(uuid,text) to authenticated;
