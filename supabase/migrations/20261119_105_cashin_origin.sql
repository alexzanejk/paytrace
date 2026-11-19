-- 105: was this Cash In started by the dashboard? (owner 2026-11-19: "all this cash-in is initiated by us from the
-- dashboard, but if a cash-in happens that is not initiated by the dashboard I should be able to tell it from
-- transactions"). Every payout, commission payout and manual Cash In is a dashboard command (cashin / sendmoney); a
-- Cash In or Send Money from an agent/personal wallet that no command explains was done by hand on the phone.
--
-- Rule, per Cash In / Send Money movement (all_movements_rows, 097):
--   'dashboard'         a dashboard command on the same phone carries the same TrxID (or the row IS PayTrace's own send)
--   'dashboard_likely'  no TrxID match, but a command on the same phone and wallet, same amount, finished within 15 min,
--                       to the same number (full or masked); one command explains one movement only
--   'acked'             none of that, but the owner marked it "I know about this"
--   'unexpected'        none of that. A partner's own Taka job Cash In is included on purpose (owner's choice); the
--                       row says partner_job = true as extra information.
-- A command that ended failed with an error that does NOT mean "nothing was sent" (e.g. no_answer_after_pin) still
-- counts as the dashboard's: the money may have gone, and it was the dashboard that asked.
-- B2B is not judged: B2B to the DSO is done by hand on purpose (the "We did a B2B" button).
-- Labels only: nothing about money changes. Read through the admin wrapper; the watchdog asks for new ones to alert.

-- A full number against the shape a wallet prints: bKash 0171XXXX678, Nagad 016****3414, Rocket ***024.
create or replace function public.number_fits(p_full text, p_shown text)
returns boolean language sql immutable set search_path = public as $$
  with v as (
    select regexp_replace(coalesce(p_full, ''), '\D', '', 'g') as f,
           regexp_replace(coalesce(p_shown, ''), '[^0-9Xx*]', '', 'g') as s
  )
  select case
    when p_full is null or p_shown is null or v.s = '' or v.f = '' then true
    when length(v.s) = 11 and length(v.f) = 11 then
      (select bool_and(substr(v.s, i, 1) !~ '[0-9]' or substr(v.s, i, 1) = substr(v.f, i, 1)) from generate_series(1, 11) i)
    else coalesce(right(v.f, length(substring(v.s from '[0-9]+$'))) = substring(v.s from '[0-9]+$'), true)
  end
  from v;
$$;

create table if not exists public.cashin_acks (
  mkey text primary key,
  note text not null check (length(note) between 1 and 200),
  by_email text,
  at timestamptz not null default now()
);
alter table public.cashin_acks enable row level security;

-- Movements already told about on Telegram (one message each, ever).
create table if not exists public.cashin_alerts (
  mkey text primary key,
  at timestamptz not null default now()
);
alter table public.cashin_alerts enable row level security;

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
       and (c.status = 'done' or (c.status = 'failed' and not public.payout_safe_error(c.error)))
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

-- The Transactions page's list: all_movements plus who started each Cash In.
create or replace function public.all_movements2(p_from date, p_to date, p_device uuid default null, p_provider text default null)
returns table(at timestamptz, exact_time boolean, day date, device_id uuid, provider text, account text, kind text,
              amount numeric, commission numeric, balance numeric, trx_id text, counterparty text, status text,
              review_reason text, chain_status text, seen text, payment_id uuid, raw text,
              mkey text, origin text, origin_ref text, partner_job boolean, ack_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then raise exception 'bad_range'; end if;
  return query select * from public.movement_origins(p_from, p_to, p_device, p_provider) order by 1 desc;
end;
$$;
revoke all on function public.all_movements2(date, date, uuid, text) from public, anon;
grant execute on function public.all_movements2(date, date, uuid, text) to authenticated, service_role;

-- How many Cash Ins the dashboard did not start, per phone, for the Home page and the phone list.
create or replace function public.unexpected_cashins(p_days int default 7)
returns table(device_id uuid, n bigint, amount numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    select o.device_id, count(*), sum(abs(o.amount))
      from public.movement_origins(today - greatest(least(coalesce(p_days, 7), 31), 1), today) o
     where o.origin = 'unexpected'
     group by o.device_id;
end;
$$;
revoke all on function public.unexpected_cashins(int) from public, anon;
grant execute on function public.unexpected_cashins(int) to authenticated, service_role;

-- "I know about this" (or take it back with an empty note).
create or replace function public.ack_cashin(p_key text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare who text := (select email from auth.users where id = auth.uid());
        v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_key is null or length(p_key) > 200 then raise exception 'bad_key'; end if;
  if v_note is null then
    -- taking a mark back: keep the row out of the way by renaming its key (the MCP cannot run a statement that removes rows)
    update public.cashin_acks set mkey = 'undone:' || gen_random_uuid()::text || ':' || mkey where mkey = p_key;
  else
    insert into public.cashin_acks(mkey, note, by_email) values (p_key, left(v_note, 200), who)
      on conflict (mkey) do update set note = excluded.note, by_email = excluded.by_email, at = now();
  end if;
  insert into public.events(kind, provider, detail)
    values ('cashin_acked', null, jsonb_build_object('mkey', p_key, 'note', v_note, 'by', who));
end;
$$;
revoke all on function public.ack_cashin(text, text) from public, anon;
grant execute on function public.ack_cashin(text, text) to authenticated;

-- Several at once ("I know about all N shown"), one note for all. At most 200.
create or replace function public.ack_cashins(p_keys text[], p_note text)
returns int language plpgsql security definer set search_path = public as $$
declare k text; n int := 0;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_keys is null or cardinality(p_keys) = 0 or cardinality(p_keys) > 200 then raise exception 'bad_keys'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'note_needed'; end if;
  foreach k in array p_keys loop
    perform public.ack_cashin(k, p_note);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.ack_cashins(text[], text) from public, anon;
grant execute on function public.ack_cashins(text[], text) to authenticated;

-- For the watchdog (every minute): Cash Ins no command explains, at least 10 minutes old (so a dashboard send that is
-- still finishing is not mistaken for one), not alerted before. Each is returned once, with the phone's name.
create or replace function public.unexpected_cashin_claim()
returns table(mkey text, device_name text, provider text, account text, kind text, amount numeric, trx_id text,
              counterparty text, at timestamptz, partner_job boolean, seen text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  return query
  with o as (
    select o.* from public.movement_origins(today - 1, today) o
     where o.origin = 'unexpected' and o.at < now() - interval '10 minutes'
       and not exists (select 1 from public.cashin_alerts a where a.mkey = o.mkey)
  ),
  ins as (
    insert into public.cashin_alerts(mkey) select o.mkey from o on conflict do nothing returning cashin_alerts.mkey
  )
  select o.mkey, coalesce(nullif(d.name, ''), d.pair_code), o.provider, o.account, o.kind, abs(o.amount), o.trx_id,
         o.counterparty, o.at, o.partner_job, o.seen
    from o join ins on ins.mkey = o.mkey left join public.devices d on d.id = o.device_id;
end;
$$;
revoke all on function public.unexpected_cashin_claim() from public, anon, authenticated;
grant execute on function public.unexpected_cashin_claim() to service_role;

-- What exists now is shown red on the page but not sent to Telegram (only new ones are).
insert into public.cashin_alerts(mkey)
  select o.mkey from public.movement_origins((now() at time zone 'Asia/Dhaka')::date - 31, (now() at time zone 'Asia/Dhaka')::date) o
   where o.origin = 'unexpected'
  on conflict do nothing;
