-- Every stored payment now says which phone it came from, so the dashboard can show, filter and total by phone.

alter table public.payments add column device_id uuid references public.devices(id) on delete set null;
create index payments_device_idx on public.payments (device_id, (coalesce(occurred_at, received_at)) desc);

-- Older payments: the "created" event recorded the phone.
update public.payments p
   set device_id = (e.detail->>'device_id')::uuid
  from public.events e
 where e.payment_id = p.id and e.kind = 'created' and p.device_id is null
   and e.detail->>'device_id' is not null
   and exists (select 1 from public.devices d where d.id = (e.detail->>'device_id')::uuid);

-- Totals per Bangladesh calendar day (12:00 AM to 11:59 PM), phone, provider, type and status.
create view public.device_day_totals with (security_invoker = true) as
select (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date as day,
       device_id, provider, txn_type, status,
       count(*) as n, sum(amount) as amount, sum(fee) as fee, sum(commission) as commission
  from public.payments
 where source = 'app'
 group by 1, 2, 3, 4, 5;

-- Last balance each phone saw for each provider (the balance printed in the newest message).
create view public.device_balances with (security_invoker = true) as
select distinct on (device_id, provider)
       device_id, provider, balance, coalesce(occurred_at, received_at) as at
  from public.payments
 where source = 'app' and balance is not null and device_id is not null
 order by device_id, provider, coalesce(occurred_at, received_at) desc, received_at desc;

-- Last known balance per provider across all phones.
create view public.provider_balances with (security_invoker = true) as
select distinct on (provider)
       provider, device_id, balance, coalesce(occurred_at, received_at) as at
  from public.payments
 where source = 'app' and balance is not null
 order by provider, coalesce(occurred_at, received_at) desc, received_at desc;

revoke all on public.device_day_totals, public.device_balances, public.provider_balances from anon;
grant select on public.device_day_totals, public.device_balances, public.provider_balances to authenticated;

-- Give a phone a name the owner recognises ("Shop counter", "Agent bKash 1").
create or replace function public.rename_device(p_device_id uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_name, '')); d public.devices;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if length(n) < 1 or length(n) > 40 then raise exception 'name must be 1 to 40 characters'; end if;
  update public.devices set name = n where id = p_device_id and status <> 'revoked' returning * into d;
  if d.id is null then raise exception 'device not found'; end if;
  insert into public.events(kind, detail)
    values ('device_renamed', jsonb_build_object('device_id', d.id, 'name', n, 'by', auth.uid()));
  return n;
end $$;
revoke all on function public.rename_device(uuid,text) from public, anon;
grant execute on function public.rename_device(uuid,text) to authenticated;
