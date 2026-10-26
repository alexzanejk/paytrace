-- Fewer Edge Function calls (owner request 2026-10-26: "without putting Supabase under pressure"). Applied live with cron.alter_job.
-- The every-minute jobs for the crypto watcher and for webhook delivery now run the SQL check first and only call the function when there is
-- something to do (database work, not an Edge Function call). A slow sweep every 10 minutes keeps the crypto cursors fresh and still records
-- a stray transfer that arrives when no order is open.
select cron.alter_job(
  job_id := 4,
  command := $c$ select net.http_post(url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/crypto-watch', body := '{}'::jsonb)
    where exists (select 1 from public.orders where crypto_chain is not null and (status = 'pending' or (status in ('expired', 'review') and expires_at > now() - interval '30 minutes'))); $c$
);
select cron.alter_job(
  job_id := 3,
  command := $c$ select net.http_post(url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/gateway/deliver', body := '{}'::jsonb)
    where exists (select 1 from public.webhook_outbox where delivered_at is null and gave_up_at is null)
       or exists (select 1 from public.orders where kind = 'deposit' and status = 'pending'); $c$
);
select cron.schedule('paytrace-crypto-sweep', '*/10 * * * *',
  $c$ select net.http_post(url := 'https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/crypto-watch', body := '{}'::jsonb); $c$
);
