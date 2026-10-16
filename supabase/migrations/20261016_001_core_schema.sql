-- Applied to project mkjcqwkfbamnuibmurcd as migration "core_schema" on 2026-10-16.
-- NOTE: later changes are in the following files; apply all in filename order on a fresh project.

-- ============ Admins ============
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ============ Settings (single row) ============
create table public.settings (
  id boolean primary key default true check (id),
  enabled_providers text[] not null default '{bkash,nagad,rocket,upay}',
  order_expiry_minutes int not null default 60 check (order_expiry_minutes > 0),
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

-- ============ Payments ============
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('bkash','nagad','rocket','upay')),
  txn_type text not null check (txn_type in ('payment_received','send_money_received','cash_out','unknown')),
  trx_id text not null check (trx_id = upper(btrim(trx_id)) and length(trx_id) >= 6),
  amount numeric(14,2) not null check (amount >= 0),
  fee numeric(14,2) not null default 0 check (fee >= 0),
  commission numeric(14,2) not null default 0 check (commission >= 0),
  balance numeric(14,2),
  counterparty text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  raw_message text not null,
  source text not null default 'app' check (source in ('app','test')),
  status text not null default 'unmatched'
    check (status in ('unmatched','matched','review','tracked_only','ignored')),
  review_reason text,
  order_id uuid,
  unique (provider, trx_id)
);
create index payments_status_idx on public.payments (status, received_at desc);
create index payments_day_idx on public.payments ((coalesce(occurred_at, received_at)) desc);

-- ============ Orders ============
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  customer_name text,
  customer_phone text,
  expected_amount numeric(14,2) not null check (expected_amount > 0),
  status text not null default 'pending'
    check (status in ('pending','paid','review','expired','cancelled')),
  claimed_provider text check (claimed_provider in ('bkash','nagad','rocket','upay')),
  claimed_trx_id text check (claimed_trx_id is null or claimed_trx_id = upper(btrim(claimed_trx_id))),
  claim_attempts int not null default 0,
  payment_id uuid unique references public.payments(id),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 minutes')
);
create index orders_status_idx on public.orders (status, created_at desc);

alter table public.payments
  add constraint payments_order_fk foreign key (order_id) references public.orders(id);
-- one payment per order, one order per payment (backstops against double credit)
create unique index payments_one_order_idx on public.payments (order_id) where order_id is not null;
-- a TrxID can be actively claimed by only one order
create unique index orders_active_claim_idx on public.orders (claimed_provider, claimed_trx_id)
  where claimed_trx_id is not null and status in ('pending','paid','review');

-- ============ Events (logs + audit) ============
create table public.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  provider text,
  payment_id uuid,
  order_id uuid,
  detail jsonb not null default '{}'::jsonb
);
create index events_at_idx on public.events (at desc);

-- ============ Reconcile: payment -> claimed order (atomic, one-time) ============
create or replace function public.reconcile_payment(p_payment_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  p public.payments; o public.orders;
  pay_digits text; ord_digits text; k int; ptime timestamptz; reason text;
begin
  select * into p from public.payments where id = p_payment_id;
  if not found then return 'no_payment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.provider || ':' || p.trx_id, 0));
  select * into p from public.payments where id = p_payment_id for update;
  if p.txn_type = 'cash_out' or p.status <> 'unmatched' then return p.status; end if;

  select * into o from public.orders
   where claimed_provider = p.provider and claimed_trx_id = p.trx_id and status = 'pending'
   order by created_at limit 1 for update;
  if not found then return 'no_claim'; end if;

  ptime := coalesce(p.occurred_at, p.received_at);
  if p.txn_type not in ('payment_received','send_money_received') then
    reason := 'unsupported_type';
  elsif p.amount <> o.expected_amount then
    reason := format('amount_mismatch: received %s expected %s', p.amount, o.expected_amount);
  elsif ptime > o.expires_at then
    reason := 'order_expired_before_payment';
  elsif o.customer_phone is not null and p.counterparty is not null then
    -- compare the visible trailing digits (SMS numbers are often masked)
    pay_digits := substring(p.counterparty from '(\d+)$');
    ord_digits := regexp_replace(o.customer_phone, '\D', '', 'g');
    k := least(coalesce(length(pay_digits), 0), 4);
    if k >= 3 and right(pay_digits, k) <> right(ord_digits, k) then
      reason := 'phone_mismatch';
    end if;
  end if;

  if reason is not null then
    update public.payments set status = 'review', review_reason = reason, order_id = null where id = p.id;
    update public.orders set status = 'review', notes = coalesce(notes || E'\n', '') || 'Held: ' || reason where id = o.id;
    insert into public.events(kind, provider, payment_id, order_id, detail)
      values ('review', p.provider, p.id, o.id, jsonb_build_object('reason', reason));
    return 'review';
  end if;

  update public.orders set status = 'paid', payment_id = p.id, paid_at = now() where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('matched', p.provider, p.id, o.id, jsonb_build_object('amount', p.amount));
  return 'matched';
end $$;

-- ============ Claim: customer says "order X was paid with TrxID Y" ============
-- (superseded by 20261016_002; kept here so the history matches what was applied)
create or replace function public.claim_order(p_order_no text, p_provider text, p_trx_id text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders; pay public.payments; t text := upper(btrim(p_trx_id)); r text;
begin
  if p_provider not in ('bkash','nagad','rocket','upay') or length(t) < 6 then
    return jsonb_build_object('result', 'invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || t, 0));

  select * into o from public.orders where order_no = p_order_no for update;
  if not found then return jsonb_build_object('result', 'order_not_found'); end if;
  if o.status = 'paid' then return jsonb_build_object('result', 'already_paid'); end if;
  if o.status <> 'pending' then return jsonb_build_object('result', o.status); end if;
  if o.expires_at < now() then
    update public.orders set status = 'expired' where id = o.id;
    return jsonb_build_object('result', 'expired');
  end if;
  if o.claim_attempts >= 5 then return jsonb_build_object('result', 'too_many_attempts'); end if;
  update public.orders set claim_attempts = claim_attempts + 1,
         customer_phone = coalesce(customer_phone, nullif(btrim(p_phone), ''))
   where id = o.id;

  select * into pay from public.payments where provider = p_provider and trx_id = t;
  if found and pay.status in ('matched','ignored','tracked_only') then
    return jsonb_build_object('result', 'payment_already_used');
  end if;

  begin
    update public.orders set claimed_provider = p_provider, claimed_trx_id = t where id = o.id;
  exception when unique_violation then
    return jsonb_build_object('result', 'trx_already_claimed');
  end;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('claim', p_provider, pay.id, o.id, jsonb_build_object('trx_id', t));

  if found then r := public.reconcile_payment(pay.id); else r := 'waiting_for_payment'; end if;
  return jsonb_build_object('result', r);
end $$;

-- ============ Admin actions ============
create or replace function public.manual_match(p_payment_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; o public.orders;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 1));
  select * into p from public.payments where id = p_payment_id for update;
  select * into o from public.orders where id = p_order_id for update;
  if p.id is null or o.id is null then raise exception 'not found'; end if;
  if p.txn_type = 'cash_out' then raise exception 'cash out receipts cannot credit orders'; end if;
  if p.status not in ('unmatched','review') then raise exception 'payment already %', p.status; end if;
  if o.status not in ('pending','review') then raise exception 'order is %', o.status; end if;
  update public.orders set status = 'paid', payment_id = p.id, paid_at = now(),
         claimed_provider = p.provider, claimed_trx_id = p.trx_id where id = o.id;
  update public.payments set status = 'matched', order_id = o.id, review_reason = null where id = p.id;
  insert into public.events(kind, provider, payment_id, order_id, detail)
    values ('manual_match', p.provider, p.id, o.id, jsonb_build_object('by', auth.uid()));
  return 'matched';
end $$;

create or replace function public.ignore_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.payments set status = 'ignored' where id = p_payment_id and status in ('unmatched','review');
  insert into public.events(kind, payment_id, detail) values ('ignored', p_payment_id, jsonb_build_object('by', auth.uid()));
end $$;

-- ============ Dashboard totals (Bangladesh time) ============
create view public.payment_totals with (security_invoker = true) as
select (coalesce(occurred_at, received_at) at time zone 'Asia/Dhaka')::date as day,
       provider, txn_type,
       count(*) as n, sum(amount) as amount, sum(fee) as fee, sum(commission) as commission
from public.payments where source = 'app'
group by 1, 2, 3;

-- ============ Security: RLS ============
alter table public.admins   enable row level security;
alter table public.settings enable row level security;
alter table public.payments enable row level security;
alter table public.orders   enable row level security;
alter table public.events   enable row level security;

create policy admins_read    on public.admins   for select to authenticated using (user_id = auth.uid());
create policy settings_read  on public.settings for select to authenticated using (public.is_admin());
create policy settings_write on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy payments_read  on public.payments for select to authenticated using (public.is_admin());
create policy orders_read    on public.orders   for select to authenticated using (public.is_admin());
create policy orders_insert  on public.orders   for insert to authenticated with check (public.is_admin());
create policy orders_update  on public.orders   for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy events_read    on public.events   for select to authenticated using (public.is_admin());

revoke all on public.admins, public.settings, public.payments, public.orders, public.events from anon;
revoke insert, update, delete on public.payments, public.events, public.admins from authenticated;
revoke delete on public.orders, public.settings from authenticated;
revoke all on public.payment_totals from anon;

-- ============ Function permissions ============
revoke all on function public.reconcile_payment(uuid) from public, anon, authenticated;
revoke all on function public.claim_order(text,text,text,text) from public, anon, authenticated;
grant execute on function public.reconcile_payment(uuid) to service_role;
grant execute on function public.claim_order(text,text,text,text) to service_role;
revoke all on function public.manual_match(uuid,uuid) from public, anon;
revoke all on function public.ignore_payment(uuid) from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.manual_match(uuid,uuid), public.ignore_payment(uuid), public.is_admin() to authenticated;
