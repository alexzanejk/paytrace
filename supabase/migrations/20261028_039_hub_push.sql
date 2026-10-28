-- Tell Admin Hub the moment a payment (SMS) is stored, so a deposit waiting there for that TrxID turns VERIFIED at once
-- instead of at the next one-minute re-check. Only the TrxID is sent (no amount, number or message text). The address
-- (it carries a private token) is kept in this table and set from the database, never in the repo. It does nothing
-- until `enabled` is switched on, and it can never block or fail a payment insert.
create table if not exists public.hub_push (
  id boolean primary key default true check (id),
  url text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.hub_push (id) values (true) on conflict (id) do nothing;
alter table public.hub_push enable row level security;
revoke all on public.hub_push from anon, authenticated;

create or replace function public.hub_push_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  begin
    select url into u from public.hub_push where id and enabled;
    if u is not null and new.trx_id is not null then
      perform net.http_post(
        url := u,
        headers := '{"content-type":"application/json"}'::jsonb,
        body := jsonb_build_object('trx_ids', jsonb_build_array(new.trx_id)),
        timeout_milliseconds := 10000
      );
    end if;
  exception when others then
    null; -- never get in the way of saving a payment
  end;
  return null;
end $$;

create trigger payments_hub_push_insert after insert on public.payments
  for each row execute function public.hub_push_payment();
create trigger payments_hub_push_status after update of status on public.payments
  for each row when (old.status is distinct from new.status and new.status in ('unmatched', 'matched', 'tracked_only', 'review'))
  execute function public.hub_push_payment();
