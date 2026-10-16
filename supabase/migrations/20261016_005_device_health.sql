-- Phone health. Each approved phone sends a heartbeat every ~15 minutes; the server keeps what it
-- reported, and a scheduled watchdog alerts the owner (once) when a phone goes quiet.

alter table public.devices
  add column if not exists info jsonb not null default '{}'::jsonb,
  add column if not exists silent_alerted_at timestamptz;

comment on column public.devices.info is
  'Last heartbeat: battery, monitoring on/off, SMS permission, messages waiting/failed, app version. Cleaned by the server.';
comment on column public.devices.silent_alerted_at is
  'Set when the owner was told this phone went quiet; cleared when it speaks again. Stops repeat alerts.';

-- The scheduler. Every 10 minutes the database calls the ingest function's watchdog action.
-- The function needs no secret for this: it returns nothing, only acts on real timestamps, and alerts
-- each phone once, so repeated calls from anyone cannot cause a flood.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'paytrace-watchdog',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/ingest',
       body := '{"action":"watchdog"}'::jsonb
     ); $$
);
