-- 106: a dashboard order is handed to the phone ONCE, and an SMS that proves a "failed" payout went puts it right
-- (owner 2026-11-19: "a transaction initiated from our dashboard says NOT dashboard").
--
-- What happened, seven times between 9 and 19 Nov: when a payout was queued, the dashboard's wake-up push and the
-- phone's own 30-second check reached the server together. device_next_command picked the queued row in a subquery
-- and updated "where id = (...)"; the second, concurrent call waited for the first, re-checked only "id = ..." (still
-- true) and returned the SAME command. The phone started one copy (which sent the money) and answered the other
-- "busy". "busy" reached the server first, so the payout was marked failed and its transactions freed; the real
-- "done" was then refused (the command was no longer running). The owner saw a failed payout, paid it again, and the
-- Transactions page called the first send "NOT dashboard" because failed-busy commands were not counted.
--
-- Fixes here: (1) one command hand-out at a time per phone, and only a row that is still queued; (2) an SMS of
-- exactly the payout's amount to its number from its phone, arriving while the "failed" command ran or within 3
-- minutes after, marks that payout paid (transactions taken back) or, if they were already paid again, paid with
-- error 'paid_twice'; (3) any dashboard money command that ended failed still vouches for a Cash In of its amount and
-- number within 15 minutes (the dashboard asked for it). The phone also ignores a command id it already has.

-- (1) ------------------------------------------------------------------------------------------------------------
create or replace function public.device_next_command(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  -- Two heartbeats of one phone at the same moment must never both receive the same command.
  perform pg_advisory_xact_lock(hashtext('paytrace:next_command:' || p_device::text));
  perform public.phone_commands_tidy(p_device);
  update public.phone_commands set status = 'running', started_at = now()
  where status = 'queued' and id = (
    select c.id from public.phone_commands c
    where c.device_id = p_device and c.status = 'queued'
      and not (c.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord', 'btob', 'appsearch', 'nagadread', 'nagadsearch', 'nagadrecord', 'pbalance')
               and exists (select 1 from public.phone_commands r where r.device_id = p_device and r.status = 'running'
                              and r.kind in ('balance', 'cashin', 'statement', 'sendmoney', 'appread', 'apprecord', 'btob', 'appsearch', 'nagadread', 'nagadsearch', 'nagadrecord', 'pbalance')))
    order by c.created_at limit 1
  )
  returning jsonb_build_object(
    'id', id, 'kind', kind, 'provider', provider,
    'amount', amount, 'to_number', to_number, 'item', item, 'via', via, 'account', account,
    'look', case when kind = 'appread' then public.app_look(p_device)
                 when kind = 'appsearch' then jsonb_build_object('query', query)
                 when kind = 'nagadread' then public.app_look_nagad(p_device)
                 when kind = 'nagadsearch' then jsonb_build_object('query', app_query) end
  ) into v;
  return v;
end $$;

-- (2) ------------------------------------------------------------------------------------------------------------
create or replace function public.payout_rescue_by_sms(p_payment uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p record; o record; v_method text; v_twice uuid;
begin
  select * into p from public.payments where id = p_payment;
  if not found or p.device_id is null or p.trx_id is null then return null; end if;
  v_method := case coalesce(p.review_reason, '') when 'cash_in_sent' then 'cash_in' when 'send_money_sent' then 'send_money' else null end;
  if v_method is null then return null; end if;
  -- An SMS that already belongs to a payout or a commission payment is that one's, never a second one's.
  if exists (select 1 from public.payouts where upper(trx_id) = upper(p.trx_id))
     or exists (select 1 from public.commission_pays where upper(trx_id) = upper(p.trx_id)) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  select po.id, c.error as cmd_error into o
    from public.payouts po join public.phone_commands c on c.id = po.command_id
   where po.method = v_method and po.status = 'failed' and po.trx_id is null
     and po.device_id = p.device_id and po.provider = p.provider and po.send_amount = p.amount
     and public.number_fits(po.to_number, p.counterparty)
     and p.received_at >= c.created_at
     and p.received_at <= coalesce(c.finished_at, c.created_at) + interval '3 minutes'
   order by po.created_at desc limit 1;
  if o.id is null then return null; end if;
  select x.payout_id into v_twice
    from public.payout_items i join public.payout_items x on x.payment_id = i.payment_id and x.live and x.payout_id <> i.payout_id
   where i.payout_id = o.id limit 1;
  if v_twice is null then
    update public.payout_items set live = true where payout_id = o.id;
    update public.payouts set status = 'paid', trx_id = left(p.trx_id, 24), balance_after = coalesce(balance_after, p.balance),
           paid_at = coalesce(paid_at, p.received_at), error = null where id = o.id;
    insert into public.events (kind, provider, detail, payment_id)
      values ('payout_rescued_by_sms', p.provider, jsonb_build_object('payout_id', o.id, 'phone_said', o.cmd_error), p.id);
  else
    update public.payouts set status = 'paid', trx_id = left(p.trx_id, 24), balance_after = coalesce(balance_after, p.balance),
           paid_at = coalesce(paid_at, p.received_at), error = 'paid_twice' where id = o.id;
    insert into public.events (kind, provider, detail, payment_id)
      values ('payout_paid_twice', p.provider, jsonb_build_object('payout_id', o.id, 'also_paid_by', v_twice, 'phone_said', o.cmd_error), p.id);
  end if;
  return o.id;
end $$;
revoke all on function public.payout_rescue_by_sms(uuid) from public, anon, authenticated;
grant execute on function public.payout_rescue_by_sms(uuid) to service_role;

create or replace function public.payouts_follow_sms()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_method text;
begin
  v_method := case coalesce(new.review_reason, '') when 'cash_in_sent' then 'cash_in' when 'send_money_sent' then 'send_money' else null end;
  if v_method is null or new.device_id is null then return new; end if;
  begin
    select o.id into v_id from public.payouts o
     where o.method = v_method and o.status in ('sending', 'unsure') and o.device_id = new.device_id and o.provider = new.provider
       and o.send_amount = new.amount and o.created_at > new.received_at - interval '30 minutes' and o.created_at <= new.received_at
     order by o.created_at limit 1;
    if v_id is not null then
      update public.payouts set status = 'paid', trx_id = coalesce(trx_id, left(new.trx_id, 24)), balance_after = coalesce(balance_after, new.balance), paid_at = coalesce(paid_at, now())
       where id = v_id;
      insert into public.events (kind, provider, detail, payment_id) values ('payout_paid_by_sms', new.provider, jsonb_build_object('payout_id', v_id), new.id);
    else
      -- A payout the phone called failed although this SMS shows the money went (106).
      v_id := public.payout_rescue_by_sms(new.id);
    end if;
    if v_method = 'send_money' then
      update public.payouts set fee_actual = new.fee
       where method = 'send_money' and fee_actual is null and device_id = new.device_id
         and (id = v_id or upper(trx_id) = upper(new.trx_id));
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

-- (3) ------------------------------------------------------------------------------------------------------------
create or replace function public.movement_origins(p_from date, p_to date, p_device uuid default null, p_provider text default null)
returns table(at timestamptz, exact_time boolean, day date, device_id uuid, provider text, account text, kind text,
              amount numeric, commission numeric, balance numeric, trx_id text, counterparty text, status text,
              review_reason text, chain_status text, seen text, payment_id uuid, raw text,
              mkey text, origin text, origin_ref text, partner_job boolean, ack_note text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with
  m as (
    select r.*,
           coalesce(r.payment_id::text,
                    r.device_id::text || '|' || r.provider || '|' || floor(extract(epoch from r.at))::bigint::text || '|' || abs(r.amount)::text) as mkey,
           (r.kind in ('cash_in_sent', 'send_money_out')) as judged,
           (r.kind in ('cash_in_sent', 'send_money_out') and r.seen <> 'paytrace') as watch
      from public.all_movements_rows(p_from, p_to, p_device, p_provider) r
  ),
  cmd as (
    select c.id, c.device_id, c.provider, c.amount, c.to_number, upper(c.trx_id) as trx, coalesce(c.finished_at, c.created_at) as fin
      from public.phone_commands c
     where c.kind in ('cashin', 'sendmoney') and c.amount is not null
       and c.status in ('done', 'failed')
       and coalesce(c.finished_at, c.created_at) >= (p_from::timestamp at time zone 'Asia/Dhaka') - interval '1 day'
       and coalesce(c.finished_at, c.created_at) < ((p_to + 2)::timestamp at time zone 'Asia/Dhaka')
       and (p_device is null or c.device_id = p_device)
  ),
  bytrx as (
    select m.mkey, (select c.id from cmd c where c.device_id = m.device_id and c.trx = upper(m.trx_id) order by c.fin limit 1) as cid
      from m where m.watch and m.trx_id is not null
  ),
  used as (select b.cid from bytrx b where b.cid is not null),
  pairs as (
    select m.mkey, c.id as cid, abs(extract(epoch from (c.fin - m.at))) as dist
      from m join cmd c
        on c.device_id = m.device_id and c.provider = m.provider and c.amount = abs(m.amount)
       -- a statement line carries only its date: then the same Bangladesh day stands in for the 15 minutes
       and (case when m.exact_time then abs(extract(epoch from (c.fin - m.at))) <= 900
                 else (c.fin at time zone 'Asia/Dhaka')::date = m.day end)
       and public.number_fits(c.to_number, m.counterparty)
     where m.watch
       and not exists (select 1 from bytrx b where b.mkey = m.mkey and b.cid is not null)
       and c.id not in (select u.cid from used u)
  ),
  best as (
    select x.mkey, x.cid from (
      select p.*, row_number() over (partition by p.mkey order by p.dist, p.cid) as rm,
                  row_number() over (partition by p.cid order by p.dist, p.mkey) as rc
        from pairs p
    ) x where x.rm = 1 and x.rc = 1
  ),
  j as (
    select m.mkey, coalesce(b1.cid, b2.cid) as cid,
           case when not m.judged then null
                when m.seen = 'paytrace' or b1.cid is not null then 'dashboard'
                when b2.cid is not null then 'dashboard_likely'
                when a.mkey is not null then 'acked'
                else 'unexpected' end as origin,
           a.note as ack_note
      from m
      left join bytrx b1 on b1.mkey = m.mkey and b1.cid is not null
      left join best b2 on b2.mkey = m.mkey
      left join public.cashin_acks a on a.mkey = m.mkey
  )
  select m.at, m.exact_time, m.day, m.device_id, m.provider, m.account, m.kind, m.amount, m.commission, m.balance,
         m.trx_id, m.counterparty, m.status, m.review_reason, m.chain_status, m.seen, m.payment_id, m.raw,
         m.mkey, j.origin,
         case when j.cid is null then null
              when exists (select 1 from public.payouts po where po.command_id = j.cid) then 'payout'
              when exists (select 1 from public.commission_pays cp where cp.command_id = j.cid) then 'commission'
              else 'cashin' end,
         -- a partner's own Taka / crypto job: the message that proved it, or the amount the partner typed that day
         (m.watch and (
            (m.payment_id is not null and (
               exists (select 1 from public.cashin_jobs cj where cj.payment_id = m.payment_id)
               or exists (select 1 from public.job_transfers jt where jt.payment_id = m.payment_id)))
            or exists (select 1 from public.cashin_jobs cj where cj.device_id = m.device_id and cj.provider = m.provider
                         and cj.amount = abs(m.amount) and (cj.submitted_at at time zone 'Asia/Dhaka')::date = m.day)
            or exists (select 1 from public.job_transfers jt where jt.device_id = m.device_id and jt.provider = m.provider
                         and jt.amount = abs(m.amount) and (jt.submitted_at at time zone 'Asia/Dhaka')::date = m.day))),
         j.ack_note
    from m join j on j.mkey = m.mkey;
end;
$$;
revoke all on function public.movement_origins(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.movement_origins(date, date, uuid, text) to service_role;

-- Put the seven payouts of 9-19 Nov right (each was paid again by hand afterwards, so they become 'paid_twice').
select public.payout_rescue_by_sms(p.id)
  from public.payments p
 where p.review_reason in ('cash_in_sent', 'send_money_sent') and p.received_at > now() - interval '30 days'
 order by p.received_at;

-- The owner marks a paid-twice payout as dealt with (the extra money came back, or was let go). Kept as a record.
create or replace function public.settle_paid_twice(p_payout uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare who text := (select email from auth.users where id = auth.uid());
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.payouts set error = 'paid_twice_settled',
         note = left(coalesce(nullif(btrim(p_note), ''), note), 200)
   where id = p_payout and error = 'paid_twice';
  if not found then raise exception 'not_paid_twice'; end if;
  insert into public.events (kind, detail) values ('paid_twice_settled', jsonb_build_object('payout_id', p_payout, 'note', p_note, 'by', who));
end $$;
revoke all on function public.settle_paid_twice(uuid, text) from public, anon;
grant execute on function public.settle_paid_twice(uuid, text) to authenticated;
