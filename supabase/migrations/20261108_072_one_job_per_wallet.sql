-- 072: one job per wallet, chosen per phone (owner 2026-11-08: "job page need redo, very messy ... we should be able to change
-- anytime from dashboard the job, like from crypto to bkash send money ... the amount above 5k on rocket ... make sure we can
-- anytime convert job from taka to crypto for any device and bkash nagad rocket").
--
-- Before: two job types both switched on for EVERY wallet with one global amount each (crypto at Tk 10,000, Cash In to our
-- number at Tk 8,000), so a bKash wallet above Tk 10,000 had two jobs on the phone at once, and no wallet could have its own
-- amount. Now each wallet type has a default (bKash: Cash In at 8,000; Nagad: crypto at 10,000; Rocket: crypto at 5,000;
-- Upay: crypto at 10,000, the owner's choices) and each phone's wallet can be switched to the other job, to no job, or given
-- its own amount at any time. A wallet only ever has ONE job kind. The two master switches (job_settings.enabled and
-- cashin_settings.enabled) stay and are worked by one "Jobs on/off" switch on the page.

create table if not exists public.wallet_job_rules (
  provider text primary key check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  kind text not null check (kind in ('crypto', 'cashin', 'off')),
  threshold numeric not null check (threshold >= 100 and threshold <= 100000000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.wallet_job_rules enable row level security;
create policy wallet_job_rules_read on public.wallet_job_rules for select to authenticated using (public.is_admin());
insert into public.wallet_job_rules (provider, kind, threshold) values
  ('bkash', 'cashin', 8000), ('nagad', 'crypto', 10000), ('rocket', 'crypto', 5000), ('upay', 'crypto', 10000)
on conflict (provider) do nothing;

-- A phone's own choice for one wallet; null = use the wallet type's default.
alter table public.agent_jobs add column if not exists job_kind text check (job_kind in ('crypto', 'cashin', 'off'));
alter table public.agent_jobs add column if not exists threshold numeric check (threshold >= 100 and threshold <= 100000000);

-- The job a wallet has: its own choice, else its type's default. The old per-agent "off" switch still means no job.
create or replace function public.wallet_job_of(p_device uuid, p_provider text)
returns table (kind text, threshold numeric, kind_own boolean, threshold_own boolean)
language sql stable security definer set search_path = public as $$
  select case when a.enabled = false then 'off' else coalesce(a.job_kind, r.kind, 'off') end,
         coalesce(a.threshold, r.threshold, (select s.threshold from public.job_settings s limit 1)),
         coalesce(a.job_kind is not null or a.enabled = false, false),
         coalesce(a.threshold is not null, false)
    from (select 1) one
    left join public.wallet_job_rules r on r.provider = p_provider
    left join public.agent_jobs a on a.device_id = p_device and a.provider = p_provider;
$$;
revoke all on function public.wallet_job_of(uuid, text) from public, anon;
grant execute on function public.wallet_job_of(uuid, text) to authenticated, service_role;

-- The crypto job: only wallets whose job is crypto, from that wallet's own amount.
create or replace view public.device_open_jobs with (security_invoker = true) as
select b.device_id, b.provider, b.balance, b.at as balance_at, w.threshold::numeric(14,2) as threshold,
       coalesce(nullif(a.instruction, ''), s.instruction) as instruction,
       coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider) as wallet,
       coalesce(a.urgency, s.urgency) as urgency,
       coalesce(nullif(a.agent_name, ''), nullif(d.name, ''), d.pair_code) as agent_name,
       coalesce(nullif(a.network, ''), s.network) as network,
       b.balance - coalesce(f.reserved, 0) as own_money,
       coalesce(f.reserved, 0) as b2b_float
  from public.device_balances b
  join public.devices d on d.id = b.device_id and d.status = 'approved'
  join public.job_settings s on s.enabled
  cross join lateral public.wallet_job_of(b.device_id, b.provider) w
  left join public.agent_jobs a on a.device_id = b.device_id and a.provider = b.provider
  left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
 where w.kind = 'crypto'
   and b.balance - coalesce(f.reserved, 0) >= w.threshold
   and coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider, '') <> ''
   and coalesce(nullif(a.instruction, ''), s.instruction) <> ''
   and not exists (select 1 from public.job_completions c where c.device_id = b.device_id and c.provider = b.provider and c.done_at >= b.at);

-- The Cash In job: only wallets whose job is cashin, from that wallet's own amount. An unstarted one is cancelled the moment
-- the wallet is switched to another job or its money falls under its amount.
create or replace function public.cashin_sync(p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.cashin_settings; r record; n record; rows int;
begin
  select * into s from public.cashin_settings where id;
  -- Cancelled because the job was switched, switched off, or the money fell under the amount: marked 'switched', so a
  -- wallet switched back gets its Cash In job again at once (a job the owner cancels by hand still waits for a newer
  -- balance message, as before).
  update public.cashin_jobs j set status = 'cancelled', checked_at = now(), note = 'switched'
   where j.device_id = p_device and j.status = 'open'
     and (not s.enabled
          or (select w.kind from public.wallet_job_of(j.device_id, j.provider) w) <> 'cashin'
          or coalesce((select b.balance - coalesce(f.reserved, 0)
                         from public.device_balances b
                         left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
                        where b.device_id = j.device_id and b.provider = j.provider), 0)
             < (select w.threshold from public.wallet_job_of(j.device_id, j.provider) w));
  if not s.enabled then return; end if;
  for r in
    select b.provider, b.balance, b.at
      from public.device_balances b
      join public.devices d on d.id = b.device_id and d.status = 'approved'
      left join public.wallet_b2b_float f on f.device_id = b.device_id and f.provider = b.provider
      cross join lateral public.wallet_job_of(b.device_id, b.provider) w
     where b.device_id = p_device and w.kind = 'cashin' and (b.balance - coalesce(f.reserved, 0)) >= w.threshold
       and not exists (select 1 from public.cashin_jobs j where j.device_id = b.device_id and j.provider = b.provider
                          and (j.status in ('open', 'checking', 'mismatch', 'review')
                               or (j.balance_at >= b.at and coalesce(j.note, '') <> 'switched')))
       and not exists (select 1 from public.job_transfers t where t.device_id = b.device_id and t.provider = b.provider and t.status in ('checking', 'mismatch'))
  loop
    select id, number into n from public.cashin_numbers where provider = r.provider and enabled
     order by last_assigned_at asc nulls first, created_at limit 1;
    if n.id is not null then
      insert into public.cashin_jobs (device_id, provider, number, balance, balance_at, urgency)
      values (p_device, r.provider, n.number, r.balance, r.at, s.urgency) on conflict do nothing;
      get diagnostics rows = row_count;
      if rows > 0 then update public.cashin_numbers set last_assigned_at = now() where id = n.id; end if;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- the dashboard's controls (admin only)
create or replace function public.set_wallet_job_rule(p_provider text, p_kind text, p_threshold numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'unknown wallet'; end if;
  if p_kind not in ('crypto', 'cashin', 'off') then raise exception 'the job must be crypto, cash in or none'; end if;
  if p_threshold is null or p_threshold < 100 or p_threshold > 100000000 then raise exception 'the amount must be at least Tk 100'; end if;
  insert into public.wallet_job_rules (provider, kind, threshold, updated_at, updated_by)
  values (p_provider, p_kind, round(p_threshold, 2), now(), auth.uid())
  on conflict (provider) do update set kind = excluded.kind, threshold = excluded.threshold, updated_at = now(), updated_by = auth.uid();
  insert into public.events (kind, provider, detail) values ('wallet_job_rule_set', p_provider, jsonb_build_object('job', p_kind, 'threshold', p_threshold, 'by', auth.uid()));
end $$;

-- One phone's wallet: p_kind / p_threshold null = use the wallet type's default.
create or replace function public.set_wallet_job(p_device uuid, p_provider text, p_kind text, p_threshold numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'unknown wallet'; end if;
  if p_kind is not null and p_kind not in ('crypto', 'cashin', 'off') then raise exception 'the job must be crypto, cash in or none'; end if;
  if p_threshold is not null and (p_threshold < 100 or p_threshold > 100000000) then raise exception 'the amount must be at least Tk 100'; end if;
  if not exists (select 1 from public.devices where id = p_device and status = 'approved') then raise exception 'phone not found'; end if;
  insert into public.agent_jobs (device_id, provider, enabled, job_kind, threshold, updated_at, updated_by)
  values (p_device, p_provider, true, p_kind, round(p_threshold, 2), now(), auth.uid())
  on conflict (device_id, provider) do update
    set enabled = true, job_kind = excluded.job_kind, threshold = excluded.threshold, updated_at = now(), updated_by = auth.uid();
  insert into public.events (kind, provider, detail) values ('wallet_job_set', p_provider,
    jsonb_build_object('device_id', p_device, 'job', p_kind, 'threshold', p_threshold, 'by', auth.uid()));
  perform public.cashin_sync(p_device);
end $$;

-- The page's one "Jobs on/off" switch works both kinds.
create or replace function public.set_jobs_enabled(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.job_settings set enabled = coalesce(p_on, false), updated_at = now(), updated_by = auth.uid() where id;
  update public.cashin_settings set enabled = coalesce(p_on, false) where id;
  insert into public.events (kind, detail) values ('jobs_enabled_set', jsonb_build_object('on', p_on, 'by', auth.uid()));
end $$;

-- Every agent wallet with its job, amount, money and what the phone shows right now.
create or replace function public.admin_wallet_jobs()
returns table (device_id uuid, provider text, balance numeric, balance_at timestamptz, own_money numeric,
               kind text, kind_own boolean, threshold numeric, threshold_own boolean, showing text, numbers int)
language sql stable security definer set search_path = public as $$
  with w as (
    select d.id as device_id, p.provider
      from public.devices d cross join (values ('bkash'), ('nagad'), ('rocket'), ('upay')) as p(provider)
     where d.status = 'approved' and public.is_admin()
       and (exists (select 1 from public.device_balances b where b.device_id = d.id and b.provider = p.provider)
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) x
                        where x->>'provider' = p.provider and coalesce(x->>'kind', 'agent') <> 'personal')
            or exists (select 1 from public.agent_jobs a where a.device_id = d.id and a.provider = p.provider)
            or exists (select 1 from public.device_wallets dw where dw.device_id = d.id and dw.provider = p.provider and dw.enabled))
  )
  select w.device_id, w.provider, b.balance, b.at, b.balance - coalesce(f.reserved, 0),
         j.kind, j.kind_own, j.threshold, j.threshold_own,
         case when exists (select 1 from public.device_open_jobs o where o.device_id = w.device_id and o.provider = w.provider) then 'crypto'
              when exists (select 1 from public.cashin_jobs c where c.device_id = w.device_id and c.provider = w.provider
                              and c.status in ('open', 'checking', 'mismatch', 'review')) then 'cashin' end,
         (select count(*)::int from public.cashin_numbers n where n.provider = w.provider and n.enabled)
    from w
    left join public.device_balances b on b.device_id = w.device_id and b.provider = w.provider
    left join public.wallet_b2b_float f on f.device_id = w.device_id and f.provider = w.provider
    cross join lateral public.wallet_job_of(w.device_id, w.provider) j
   order by w.device_id, w.provider;
$$;

revoke all on function public.set_wallet_job_rule(text, text, numeric) from public, anon;
revoke all on function public.set_wallet_job(uuid, text, text, numeric) from public, anon;
revoke all on function public.set_jobs_enabled(boolean) from public, anon;
revoke all on function public.admin_wallet_jobs() from public, anon;
grant execute on function public.set_wallet_job_rule(text, text, numeric) to authenticated, service_role;
grant execute on function public.set_wallet_job(uuid, text, text, numeric) to authenticated, service_role;
grant execute on function public.set_jobs_enabled(boolean) to authenticated, service_role;
grant execute on function public.admin_wallet_jobs() to authenticated, service_role;
