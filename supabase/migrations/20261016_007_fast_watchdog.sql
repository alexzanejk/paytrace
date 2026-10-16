-- Offline detection in about a minute and a half. Phones now send a heartbeat every 30 seconds (the app's
-- always-on service), the dashboard calls a phone Offline after 90 seconds, and the watchdog below runs every
-- minute and sends the Telegram alert once a phone has been offline for 3 minutes (ALERT_AFTER_MIN in the
-- ingest function). Scheduling under the same name replaces the old every-10-minutes job.
select cron.schedule(
  'paytrace-watchdog',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/ingest',
       body := '{"action":"watchdog"}'::jsonb
     ); $$
);
