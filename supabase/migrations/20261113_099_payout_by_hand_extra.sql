-- 099: record a payout paid by hand for money that is NOT on the Payout list (owner 2026-11-13: "if we payout any
-- transaction that is not in our payout transaction we should be able to add that on payout as paid manually").
-- Typical case: a Cash Out the wallet's own app listed with no SMS, so PayTrace has no payment row to tick.
-- The record is a normal `payouts` row (method manual, status paid) with NO payout_items; `extra` marks it, `for_trx`
-- names the transaction it paid on (optional), `for_device`/`for_provider` the wallet that received that money.
-- A transaction PayTrace DOES hold must be ticked in the list instead (so it shows Paid out and can never be paid twice):
-- this function refuses it. The same TrxID cannot be recorded twice while the earlier record stands.
-- Undo is the existing resolve_payout(id, false) (manual + paid -> cancelled). Nothing removed (MCP rule).

alter table public.payouts add column if not exists extra boolean not null default false;
alter table public.payouts add column if not exists for_trx text;
alter table public.payouts add column if not exists for_device uuid references public.devices(id);
alter table public.payouts add column if not exists for_provider text;
do $$ begin
  alter table public.payouts add constraint payouts_for_trx_shape check (for_trx is null or for_trx ~ '^[A-Z0-9]{4,24}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.payouts add constraint payouts_for_provider_check check (for_provider is null or for_provider in ('bkash', 'nagad', 'rocket', 'upay'));
exception when duplicate_object then null; end $$;
create index if not exists payouts_extra_idx on public.payouts (created_at desc) where extra;

create or replace function public.manual_payout_extra(
  p_received numeric, p_sent numeric, p_for_trx text default null, p_device uuid default null, p_provider text default null,
  p_to_number text default null, p_trx text default null, p_paid_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_for text; v_num text := null; v_trx text; v_keep numeric; v_pct numeric; v_day date; v_today date; v_at timestamptz;
  v_payout uuid; pay public.payments; v_note text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_received is null or p_received <= 0 or p_received > 1000000 then raise exception 'type the amount that came in (more than 0)'; end if;
  if p_sent is null or p_sent <= 0 then raise exception 'type the amount you paid out (more than 0)'; end if;
  if p_sent > p_received then raise exception 'you paid out more than came in: check the two amounts'; end if;
  v_for := nullif(upper(regexp_replace(coalesce(p_for_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if v_for is not null and v_for !~ '^[A-Z0-9]{4,24}$' then raise exception 'the TrxID of the transaction looks wrong'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_for is null and v_note is null then raise exception 'type the TrxID of the transaction you paid on, or a note saying what it was for'; end if;
  if p_provider is not null and p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'bad wallet'; end if;
  if p_device is not null and not exists (select 1 from public.devices where id = p_device) then raise exception 'unknown phone'; end if;
  if nullif(trim(coalesce(p_to_number, '')), '') is not null then
    v_num := public.bd_number(p_to_number);
    if v_num is null then raise exception 'the number you paid must be a Bangladesh mobile number (11 digits starting 01)'; end if;
  end if;
  v_trx := nullif(upper(regexp_replace(coalesce(p_trx, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if v_trx is not null and length(v_trx) > 24 then raise exception 'the TrxID of your payment is too long'; end if;
  v_today := (now() at time zone 'Asia/Dhaka')::date;
  v_day := coalesce(p_paid_on, v_today);
  if v_day > v_today then raise exception 'the day you paid cannot be in the future'; end if;
  if v_day < v_today - 90 then raise exception 'the day you paid must be within the last 90 days'; end if;
  v_at := case when v_day = v_today then now() else (v_day::timestamp + time '12:00') at time zone 'Asia/Dhaka' end;

  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  if v_for is not null then
    select * into pay from public.payments where upper(trx_id) = v_for order by received_at desc limit 1;
    if pay.id is not null then
      if exists (select 1 from public.payout_items i where i.payment_id = pay.id and i.live) then
        raise exception 'listed: % is already paid out on the Payout page', v_for;
      end if;
      if public.payout_refusal_manual(pay.id) is null then
        raise exception 'listed: % is on the Payout list (Tk %): search for it there and tick it, so it shows Paid out', v_for, pay.amount;
      end if;
    end if;
    if exists (select 1 from public.payouts o where o.for_trx = v_for and o.status in ('paid', 'sending', 'unsure')) then
      raise exception 'a payout for % is already recorded; undo that one first if it was wrong', v_for;
    end if;
  end if;

  v_keep := round(p_received - p_sent, 2);
  v_pct := round(v_keep * 100 / p_received, 2);
  insert into public.payouts (method, status, extra, for_trx, for_device, for_provider, to_number, total_amount, keep_pct, keep_amount,
                              send_amount, trx_id, note, created_by, paid_at, resolved_by, resolved_at)
  values ('manual', 'paid', true, v_for, p_device, p_provider, v_num, round(p_received, 2), v_pct, v_keep,
          round(p_sent, 2), v_trx, left(v_note, 200), auth.uid(), v_at, auth.uid(), now())
  returning id into v_payout;
  insert into public.events (kind, provider, detail) values ('payout_manual_extra', p_provider, jsonb_build_object(
    'payout_id', v_payout, 'for_trx', v_for, 'device_id', p_device, 'to', v_num, 'received', p_received, 'sent', p_sent, 'by', auth.uid()));
  return jsonb_build_object('payout_id', v_payout, 'keep', v_keep, 'send', round(p_sent, 2), 'keep_pct', v_pct);
end $$;
revoke all on function public.manual_payout_extra(numeric, numeric, text, uuid, text, text, text, date, text) from public, anon;
grant execute on function public.manual_payout_extra(numeric, numeric, text, uuid, text, text, text, date, text) to authenticated;
