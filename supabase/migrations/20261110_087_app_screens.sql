-- 087: the bKash app recorder streams every screen (owner 2026-11-10: "we will finish the bkash app ... we need to map it
-- perfect"). The old recorder kept 2½ minutes of words packed into one 14,000-character answer, which cut long sessions short.
-- Now an "apprecord" command is answered at once and the phone then sends each new screen of the bKash app, for up to 10
-- minutes, through the ingest action "app_screen". Each screen keeps every element's hidden name (view id), kind, words,
-- hint, flags and position, so the map can be built on names that do not change with the app's language.
-- Read by the owner/Claude only (admins). The server never acts on these rows. No DROP or DELETE.

create table if not exists public.app_screens (
  id bigserial primary key,
  command_id uuid not null references public.phone_commands(id),
  device_id uuid not null references public.devices(id),
  seq int not null check (seq between 1 and 600),
  at timestamptz not null default now(),
  pkg text check (pkg is null or length(pkg) <= 120),
  screen text not null check (length(screen) <= 9000),
  unique (command_id, seq)
);
create index if not exists app_screens_command on public.app_screens (command_id, seq);
alter table public.app_screens enable row level security;
create policy app_screens_admin_read on public.app_screens for select to authenticated using (public.is_admin());

-- One screen from the phone: only for this phone's own recording, started in the last 20 minutes, at most 600 screens.
create or replace function public.app_screen_add(p_device uuid, p_command uuid, p_seq int, p_pkg text, p_screen text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.phone_commands c
                  where c.id = p_command and c.device_id = p_device and c.kind = 'apprecord'
                    and c.created_at > now() - interval '20 minutes') then
    return jsonb_build_object('ok', false, 'error', 'not_recording');
  end if;
  if p_seq is null or p_seq < 1 or p_seq > 600 or p_screen is null or length(p_screen) = 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_screen');
  end if;
  insert into public.app_screens (command_id, device_id, seq, pkg, screen)
    values (p_command, p_device, p_seq, left(p_pkg, 120), left(p_screen, 9000))
    on conflict (command_id, seq) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.app_screen_add(uuid, uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.app_screen_add(uuid, uuid, int, text, text) to service_role;
