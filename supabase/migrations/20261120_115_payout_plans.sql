-- 115: Telegram step 4, "Pay all verified" (owner 2026-11-20): one payout per person, all of that person's matched
-- transactions in one send to a number the owner types for that person, FED TO THE PHONES OVER TIME. A phone runs one
-- send at a time and a queued phone command is cancelled after 10 minutes, so several people cannot be handed to one
-- phone at once: each "Pay out" becomes a PLAN in `payout_plans`; `payout_plan_tick()` (run when a plan is made, when a
-- payout ends, and by pg_cron every minute) starts the next plan of a phone only when that phone has no send under way.
-- A plan's payout is the ordinary payout (same rules, same table, same items, same wallet check on failure): the only
-- change to the maker is that its body moved into `create_payout_core(..., p_by)`, which carries the acting admin's id
-- instead of reading auth.uid(), so the tick can run it from a timer. `create_payout` keeps its name, arguments, admin
-- check and behaviour; the `_via` / `_via_account` wrappers call it unchanged.

-- ---------- the maker, split ----------
create or replace function public.create_payout_core(
  p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric, p_from_account text, p_note text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices; v_num text; v_total numeric := 0; v_keep numeric; v_send numeric; v_why text; pid uuid;
  v_cmd uuid; v_payout uuid; n int; v_limit numeric; v_today numeric; v_kind text; v_method text; v_fee numeric := 0;
begin
  n := coalesce(array_length(p_payments, 1), 0);
  if n = 0 then raise exception 'tick at least one transaction'; end if;
  if n > 200 then raise exception 'at most 200 transactions in one payout'; end if;
  if (select count(distinct x) from unnest(p_payments) x) <> n then raise exception 'a transaction is ticked twice'; end if;
  if p_keep_pct is null or p_keep_pct < 0 or p_keep_pct > 100 then raise exception 'the share you keep must be 0 to 100 percent'; end if;
  v_num := public.bd_number(p_to_number);
  if v_num is null then raise exception 'the receiving number must be a Bangladesh mobile number (11 digits starting 01)'; end if;
  if p_from_account not in ('agent', 'personal') then raise exception 'bad account'; end if;
  if p_from_account = 'personal' and p_provider <> 'bkash' then
    raise exception 'send_money_not_ready: sending from a personal % account is not built yet (it needs a recording of its Send Money menu)', p_provider;
  end if;
  if p_provider not in ('bkash', 'nagad', 'rocket') then raise exception 'only bKash, Nagad and Rocket wallets can send'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'unknown phone'; end if;
  if not d.allow_cashin then raise exception 'sending money is switched off for that phone (Phones page, "What the dashboard may do")'; end if;
  if p_from_account = 'personal' then
    if not coalesce(d.allow_personal, false) then raise exception 'personal accounts are switched off for that phone (Phones page)'; end if;
    if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) w
                    where w->>'provider' = p_provider and w->>'kind' = 'personal') then
      raise exception 'that phone has no personal % account saved in its app yet', p_provider;
    end if;
  end if;
  v_kind := case when p_from_account = 'personal' then 'sendmoney' else 'cashin' end;
  v_method := case when p_from_account = 'personal' then 'send_money' else 'cash_in' end;

  perform pg_advisory_xact_lock(hashtext('paytrace:payout'));
  foreach pid in array p_payments loop
    v_why := public.payout_refusal(pid);
    if v_why is not null then raise exception 'transaction % cannot be paid out: %', (select trx_id from public.payments where id = pid), v_why; end if;
  end loop;
  select sum(amount) into v_total from public.payments where id = any(p_payments);
  select s.keep_amount, s.send_amount into v_keep, v_send from public.payout_split(v_total, p_keep_pct) s;
  if v_kind = 'sendmoney' then
    select coalesce(send_money_fee, 0) into v_fee from public.payout_settings limit 1;
    v_send := floor(v_total - round(v_total * p_keep_pct / 100, 2) - v_fee);
    v_keep := round(v_total - v_send - v_fee, 2);
  end if;
  if v_send < 100 then raise exception 'Tk % is under the Tk 100 one send can carry; tick more transactions together', v_send; end if;
  if v_send > 50000 then raise exception 'Tk % is over the Tk 50,000 one send can carry; tick fewer transactions', v_send; end if;
  if v_kind = 'sendmoney' then
    select coalesce(daily_limit, 0) into v_limit from public.cashin_limits limit 1;
    if coalesce(v_limit, 0) <= 0 then raise exception 'personal Send Money is off: set its daily limit on the Jobs page first'; end if;
    v_today := public.personal_sent_today(p_device);
    if v_today + v_send > v_limit then
      raise exception 'that would make Tk % sent by personal Send Money from this phone today, over the daily limit of Tk %', v_today + v_send, v_limit;
    end if;
  end if;

  perform public.phone_commands_tidy(p_device);
  begin
    insert into public.phone_commands (device_id, kind, provider, amount, to_number, created_by)
    values (p_device, v_kind, p_provider, v_send, v_num, p_by) returning id into v_cmd;
  exception when unique_violation then
    raise exception 'that phone is already sending from this wallet; wait for it to finish';
  end;
  insert into public.payouts (method, status, device_id, provider, from_account, to_number, total_amount, keep_pct, keep_amount, send_amount, fee_reserved, command_id, note, created_by)
  values (v_method, 'sending', p_device, p_provider, p_from_account, v_num, v_total, round(p_keep_pct, 2), v_keep, v_send, v_fee, v_cmd, left(p_note, 200), p_by)
  returning id into v_payout;
  insert into public.payout_items (payout_id, payment_id, amount)
  select v_payout, p.id, p.amount from public.payments p where p.id = any(p_payments);
  insert into public.events (kind, provider, detail) values ('payout_created', p_provider,
    jsonb_build_object('payout_id', v_payout, 'device_id', p_device, 'to', v_num, 'total', v_total, 'keep', v_keep, 'send', v_send, 'count', n, 'method', v_method, 'fee', v_fee, 'by', p_by));
  return jsonb_build_object('payout_id', v_payout, 'command_id', v_cmd, 'device_id', p_device, 'total', v_total, 'keep', v_keep, 'send', v_send, 'fee', v_fee);
end $$;
revoke all on function public.create_payout_core(uuid[], uuid, text, text, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_payout_core(uuid[], uuid, text, text, numeric, text, text, uuid) to service_role;

create or replace function public.create_payout(
  p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric, p_from_account text default 'agent', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return public.create_payout_core(p_payments, p_device, p_provider, p_to_number, p_keep_pct, p_from_account, p_note, auth.uid());
end $$;

-- ---------- plans ----------
create table if not exists public.payout_plans (
  id uuid primary key default gen_random_uuid(),
  label text not null,                         -- who is paid: the person's site login or name
  tg_user_id bigint references public.telegram_users (tg_user_id),
  payment_ids uuid[] not null,
  count int not null,
  total numeric(14,2) not null,
  device_id uuid not null references public.devices (id),
  provider text not null,
  from_account text not null check (from_account in ('agent', 'personal')),
  account int check (account in (1, 2)),
  via text not null default 'ussd' check (via in ('ussd', 'app')),
  to_number text not null,
  keep_pct numeric(6,2) not null,
  note text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'paid', 'unsure', 'failed', 'cancelled')),
  payout_id uuid references public.payouts (id),
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists payout_plans_device_idx on public.payout_plans (device_id, created_at) where status = 'queued';
create index if not exists payout_plans_created_idx on public.payout_plans (created_at desc);
alter table public.payout_plans enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'payout_plans' and policyname = 'payout_plans_admin_read') then
    create policy payout_plans_admin_read on public.payout_plans for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.payout_plans to authenticated;

-- A transaction sits in at most one LIVE plan (queued), the way payout_items keeps it in at most one live payout.
create table if not exists public.payout_plan_items (
  plan_id uuid not null references public.payout_plans (id),
  payment_id uuid not null references public.payments (id),
  live boolean not null default true,
  primary key (plan_id, payment_id)
);
create unique index if not exists payout_plan_items_one_live on public.payout_plan_items (payment_id) where live;
alter table public.payout_plan_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'payout_plan_items' and policyname = 'payout_plan_items_admin_read') then
    create policy payout_plan_items_admin_read on public.payout_plan_items for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.payout_plan_items to authenticated;

-- Starts the next plan on every phone that is free. Safe to call often: a phone with a send under way (a live cashin /
-- sendmoney command, or a plan whose payout is still 'sending', which includes the wallet check after a failure) is left
-- alone. A plan that the maker refuses becomes 'failed' with the maker's own words; nothing was sent.
create or replace function public.payout_plan_tick() returns int language plpgsql security definer set search_path = public as $$
declare dev record; pl public.payout_plans; r jsonb; started int := 0;
begin
  for dev in select distinct p.device_id from public.payout_plans p where p.status = 'queued' loop
    if exists (select 1 from public.phone_commands c where c.device_id = dev.device_id and c.kind in ('cashin', 'sendmoney') and c.status in ('queued', 'running')) then continue; end if;
    if exists (select 1 from public.payout_plans p join public.payouts o on o.id = p.payout_id where p.device_id = dev.device_id and p.status = 'sending' and o.status = 'sending') then continue; end if;
    select * into pl from public.payout_plans p where p.device_id = dev.device_id and p.status = 'queued' order by p.created_at limit 1 for update skip locked;
    if pl.id is null then continue; end if;
    begin
      r := public.create_payout_core(pl.payment_ids, pl.device_id, pl.provider, pl.to_number, pl.keep_pct, pl.from_account, pl.note, pl.created_by);
      if pl.via = 'app' then perform public.phone_command_set_via((r->>'command_id')::uuid, 'app'); end if;
      if pl.account is not null and pl.from_account = 'personal' then perform public.phone_command_set_account((r->>'command_id')::uuid, pl.account); end if;
      update public.payout_plans set status = 'sending', payout_id = (r->>'payout_id')::uuid, started_at = now() where id = pl.id;
      update public.payout_plan_items set live = false where plan_id = pl.id;
      insert into public.events (kind, provider, detail) values ('payout_plan_started', pl.provider, jsonb_build_object('plan', pl.id, 'payout_id', r->>'payout_id', 'label', pl.label, 'send', r->>'send'));
      started := started + 1;
    exception when others then
      update public.payout_plans set status = 'failed', error = left(sqlerrm, 300), finished_at = now() where id = pl.id;
      update public.payout_plan_items set live = false where plan_id = pl.id;
      insert into public.events (kind, provider, detail) values ('payout_plan_failed', pl.provider, jsonb_build_object('plan', pl.id, 'label', pl.label, 'error', left(sqlerrm, 300)));
    end;
  end loop;
  return started;
end $$;
revoke all on function public.payout_plan_tick() from public, anon, authenticated;
grant execute on function public.payout_plan_tick() to service_role;

-- The owner queues one person's payout. The same checks the maker will make, made now so a refusal shows at once; the
-- maker checks again when the plan starts. Starts at once when the phone is free.
create or replace function public.queue_payout(
  p_label text, p_tg_user bigint, p_payments uuid[], p_device uuid, p_provider text, p_to_number text, p_keep_pct numeric,
  p_from_account text, p_via text, p_account int, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices; v_num text; v_total numeric; v_keep numeric; v_send numeric; v_fee numeric := 0; pid uuid; v_why text; n int;
  lbl text; pl public.payout_plans;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  n := coalesce(array_length(p_payments, 1), 0);
  if n = 0 then raise exception 'tick at least one transaction'; end if;
  if n > 200 then raise exception 'at most 200 transactions in one payout'; end if;
  if (select count(distinct x) from unnest(p_payments) x) <> n then raise exception 'a transaction is ticked twice'; end if;
  if p_keep_pct is null or p_keep_pct < 0 or p_keep_pct > 100 then raise exception 'the share you keep must be 0 to 100 percent'; end if;
  v_num := public.bd_number(p_to_number);
  if v_num is null then raise exception 'the receiving number must be a Bangladesh mobile number (11 digits starting 01)'; end if;
  if p_from_account not in ('agent', 'personal') then raise exception 'bad account'; end if;
  if p_provider not in ('bkash', 'nagad', 'rocket') then raise exception 'only bKash, Nagad and Rocket wallets can send'; end if;
  if coalesce(p_via, 'ussd') not in ('ussd', 'app') then raise exception 'bad_via'; end if;
  if p_account is not null and p_account not in (1, 2) then raise exception 'bad_account'; end if;
  select * into d from public.devices where id = p_device;
  if d.id is null or d.status <> 'approved' then raise exception 'unknown phone'; end if;
  if not d.allow_cashin then raise exception 'sending money is switched off for that phone (Phones page, "What the dashboard may do")'; end if;
  lbl := nullif(left(trim(coalesce(p_label, '')), 64), '');
  if lbl is null and p_tg_user is not null then lbl := public.tg_person_name(p_tg_user); end if;
  if lbl is null then raise exception 'who is this payout for? give a name'; end if;
  foreach pid in array p_payments loop
    v_why := public.payout_refusal(pid);
    if v_why is not null then raise exception 'transaction % cannot be paid out: %', (select trx_id from public.payments where id = pid), v_why; end if;
  end loop;
  select sum(amount) into v_total from public.payments where id = any(p_payments);
  select s.keep_amount, s.send_amount into v_keep, v_send from public.payout_split(v_total, p_keep_pct) s;
  if p_from_account = 'personal' then
    select coalesce(send_money_fee, 0) into v_fee from public.payout_settings limit 1;
    v_send := floor(v_total - round(v_total * p_keep_pct / 100, 2) - v_fee);
  end if;
  if v_send < 100 then raise exception 'Tk % is under the Tk 100 one send can carry; tick more transactions together', v_send; end if;
  if v_send > 50000 then raise exception 'Tk % is over the Tk 50,000 one send can carry; tick fewer transactions', v_send; end if;
  insert into public.payout_plans (label, tg_user_id, payment_ids, count, total, device_id, provider, from_account, account, via, to_number, keep_pct, note, created_by)
  values (lbl, p_tg_user, p_payments, n, v_total, p_device, p_provider, p_from_account, p_account, coalesce(p_via, 'ussd'), v_num, round(p_keep_pct, 2),
          left(coalesce(nullif(trim(p_note), ''), 'Payout to ' || lbl), 200), auth.uid())
  returning * into pl;
  begin
    insert into public.payout_plan_items (plan_id, payment_id) select pl.id, x from unnest(p_payments) x;
  exception when unique_violation then
    raise exception 'one of these transactions is already queued in another payout';
  end;
  if p_tg_user is not null then update public.telegram_users set last_number = v_num where tg_user_id = p_tg_user; end if;
  insert into public.events (kind, provider, detail) values ('payout_queued', p_provider,
    jsonb_build_object('plan', pl.id, 'label', lbl, 'tg_user_id', p_tg_user, 'count', n, 'total', v_total, 'send', v_send, 'device_id', p_device, 'to', v_num, 'by', auth.uid()));
  perform public.payout_plan_tick();
  return (select to_jsonb(p) from public.payout_plans p where p.id = pl.id);
end $$;
grant execute on function public.queue_payout(text, bigint, uuid[], uuid, text, text, numeric, text, text, int, text) to authenticated;

-- A plan still waiting can be taken back. One that started is an ordinary payout: the Payout page's rules apply.
create or replace function public.cancel_payout_plan(p_plan uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.payout_plans set status = 'cancelled', finished_at = now() where id = p_plan and status = 'queued';
  if not found then raise exception 'this payout has already started; see it on the Payout page'; end if;
  update public.payout_plan_items set live = false where plan_id = p_plan;
  insert into public.events (kind, detail) values ('payout_plan_cancelled', jsonb_build_object('plan', p_plan, 'by', auth.uid()));
end $$;
grant execute on function public.cancel_payout_plan(uuid) to authenticated;

-- A plan follows its payout, and the next plan on that phone starts the moment a payout ends.
create or replace function public.payout_plans_follow() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.payout_plans
       set status = case new.status when 'paid' then 'paid' when 'failed' then 'failed' when 'cancelled' then 'failed' when 'unsure' then 'unsure' else status end,
           error = case when new.status in ('failed', 'cancelled', 'unsure') then coalesce(new.error, error) else error end,
           finished_at = case when new.status in ('paid', 'failed', 'cancelled', 'unsure') then coalesce(finished_at, now()) else finished_at end
     where payout_id = new.id;
    if new.status in ('paid', 'failed', 'cancelled', 'unsure') then
      begin perform public.payout_plan_tick(); exception when others then
        insert into public.events (kind, detail) values ('payout_plan_tick_failed', jsonb_build_object('payout_id', new.id, 'error', left(sqlerrm, 200)));
      end;
    end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'zz_payouts_plans_follow') then
    create trigger zz_payouts_plans_follow after update of status on public.payouts for each row execute function public.payout_plans_follow();
  end if;
end $$;

-- The safety net: a stuck plan is picked up within a minute.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'paytrace-payout-plans') then
    perform cron.schedule('paytrace-payout-plans', '* * * * *', $cron$select public.payout_plan_tick()$cron$);
  end if;
end $$;
