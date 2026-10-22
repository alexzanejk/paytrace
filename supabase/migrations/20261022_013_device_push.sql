-- Wake-up pushes (Firebase Cloud Messaging). Each phone registers a push address; when a phone goes quiet the
-- server sends it a high-priority message that makes Android start PayTrace again.
-- Only the server touches this table: RLS is on and there are no policies, so the dashboard cannot read the addresses.
create table public.device_push (
  device_id uuid primary key references public.devices(id) on delete cascade,
  token text not null check (length(token) between 100 and 400),
  updated_at timestamptz not null default now(),
  woken_at timestamptz
);
alter table public.device_push enable row level security;
revoke all on public.device_push from anon, authenticated;
