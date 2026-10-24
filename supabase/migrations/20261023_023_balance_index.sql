-- Every phone heartbeat (about every 30 seconds) now also looks up that phone's open jobs, which reads the newest printed balance per phone
-- and wallet (view device_balances). This index lets the database find those few rows without reading the whole payments table as it grows.
create index if not exists payments_device_balance_idx
  on public.payments (device_id, provider, (coalesce(occurred_at, received_at)) desc, received_at desc)
  where source = 'app' and balance is not null and device_id is not null;
