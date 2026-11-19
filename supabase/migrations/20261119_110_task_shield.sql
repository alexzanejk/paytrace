-- 110: the touch freeze during dashboard tasks, a per-phone switch (owner 2026-11-19: "when PayTrace is doing a task,
-- every other app and screen touch frozen so nothing can disturb"). Off by default: the owner switches it on per phone
-- once a task has been seen to work through it on one phone. The phone reads it from the heartbeat reply's allow.shield.
alter table public.devices add column if not exists allow_shield boolean not null default false;

create or replace function public.set_device_shield(p_device uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.devices set allow_shield = coalesce(p_on, false) where id = p_device and status <> 'revoked';
  if not found then raise exception 'phone not found'; end if;
  insert into public.events (kind, detail) values ('phone_shield_set', jsonb_build_object('device_id', p_device, 'on', coalesce(p_on, false), 'by', auth.uid()));
end $$;
revoke all on function public.set_device_shield(uuid, boolean) from public, anon;
grant execute on function public.set_device_shield(uuid, boolean) to authenticated;
