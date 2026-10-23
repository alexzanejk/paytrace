-- Agent jobs (owner request 2026-10-23). The owner writes ONE job in the dashboard: what to do, and the wallet address to do it with
-- (one per provider). Whenever a phone's newest printed balance for a provider reaches the threshold (default 10,000), that phone's app
-- shows the job ("কাজ করুন এখনই"). PayTrace only shows the instruction; it never moves money.
-- Sending money out produces no message PayTrace stores, so the balance cannot tell that the work was done. The agent taps Done; the job
-- then stays hidden until a NEWER balance message arrives, and comes back only if that balance is still at or above the threshold.
-- Nothing existing is changed; this file only adds. No statements that the Supabase MCP cannot run (see migration 014).

create table public.job_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  threshold numeric(14, 2) not null default 10000 check (threshold >= 100 and threshold <= 100000000),
  instruction text not null default '' check (length(instruction) <= 1000),
  wallets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.job_settings (id) values (true) on conflict (id) do nothing;

create table public.job_completions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  balance numeric(14, 2),
  done_at timestamptz not null default now()
);
create index job_completions_idx on public.job_completions (device_id, provider, done_at desc);

alter table public.job_settings enable row level security;
alter table public.job_completions enable row level security;
create policy job_settings_read on public.job_settings for select to authenticated using (public.is_admin());
create policy job_completions_read on public.job_completions for select to authenticated using (public.is_admin());
revoke all on public.job_settings, public.job_completions from anon, authenticated;
grant select on public.job_settings, public.job_completions to authenticated;

-- Phones that have a job right now: newest balance at or above the threshold, a wallet set for that provider, and not marked done since
-- that balance was printed.
create view public.device_open_jobs with (security_invoker = true) as
select b.device_id, b.provider, b.balance, b.at as balance_at, s.threshold, s.instruction, s.wallets ->> b.provider as wallet
  from public.device_balances b
  join public.devices d on d.id = b.device_id and d.status = 'approved'
  join public.job_settings s on s.enabled
 where b.balance >= s.threshold
   and coalesce(s.wallets ->> b.provider, '') <> ''
   and not exists (
     select 1 from public.job_completions c
      where c.device_id = b.device_id and c.provider = b.provider and c.done_at >= b.at
   );
revoke all on public.device_open_jobs from anon;
grant select on public.device_open_jobs to authenticated;

-- The one place the owner writes the job. wallets = {"bkash":"01712345678", ...}; a provider left empty gets no job.
create or replace function public.set_job_settings(p_enabled boolean, p_threshold numeric, p_instruction text, p_wallets jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text; v text; clean jsonb := '{}'::jsonb; txt text := btrim(coalesce(p_instruction, ''));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_threshold is null or p_threshold < 100 or p_threshold > 100000000 then raise exception 'the amount must be between 100 and 100,000,000'; end if;
  if length(txt) > 1000 then raise exception 'the instruction is too long (1000 characters at most)'; end if;
  if coalesce(p_enabled, false) and txt = '' then raise exception 'write what the agent should do first'; end if;
  if p_wallets is null or jsonb_typeof(p_wallets) <> 'object' then raise exception 'wallets must be an object'; end if;
  for k, v in select key, btrim(value) from jsonb_each_text(p_wallets) loop
    if k not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'unknown provider'; end if;
    if v <> '' then
      if v !~ '^[0-9A-Za-z+ ._:@/-]{6,60}$' then raise exception 'a wallet address must be 6 to 60 letters, numbers or . _ - characters'; end if;
      clean := clean || jsonb_build_object(k, v);
    end if;
  end loop;
  if coalesce(p_enabled, false) and clean = '{}'::jsonb then raise exception 'add at least one wallet address'; end if;
  update public.job_settings
     set enabled = coalesce(p_enabled, false), threshold = round(p_threshold, 2), instruction = txt, wallets = clean,
         updated_at = now(), updated_by = auth.uid()
   where id;
  insert into public.events(kind, detail) values ('job_settings_set', jsonb_build_object('enabled', coalesce(p_enabled, false), 'threshold', round(p_threshold, 2), 'by', auth.uid()));
end $$;
revoke all on function public.set_job_settings(boolean, numeric, text, jsonb) from public, anon;
grant execute on function public.set_job_settings(boolean, numeric, text, jsonb) to authenticated;

-- What a phone's own app shows (called by the ingest function with the phone's key already checked; service role only).
-- {provider} and {balance} in the owner's text are filled in for each job.
create or replace function public.device_jobs(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb;
  names constant jsonb := '{"bkash":"bKash","nagad":"Nagad","rocket":"Rocket","upay":"Upay"}'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', j.provider,
           'balance', j.balance,
           'balance_at', j.balance_at,
           'threshold', j.threshold,
           'wallet', j.wallet,
           'instruction', replace(replace(j.instruction, '{provider}', coalesce(names ->> j.provider, j.provider)),
                                  '{balance}', 'Tk ' || to_char(j.balance, 'FM999,999,999,990.00'))
         ) order by j.balance desc), '[]'::jsonb)
    into v_jobs
    from public.device_open_jobs j
    join public.devices d on d.id = j.device_id and d.status = 'approved'
   where j.device_id = p_device;
  return jsonb_build_object('jobs', v_jobs);
end $$;
revoke all on function public.device_jobs(uuid) from public, anon, authenticated;
grant execute on function public.device_jobs(uuid) to service_role;

-- The agent says the work is done. Only counts while that job is really open for that phone.
create or replace function public.device_job_done(p_device uuid, p_provider text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_balance numeric;
begin
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then return false; end if;
  select balance into v_balance from public.device_open_jobs where device_id = p_device and provider = p_provider;
  if not found then return false; end if;
  insert into public.job_completions(device_id, provider, balance) values (p_device, p_provider, v_balance);
  insert into public.events(kind, provider, detail) values ('job_done', p_provider, jsonb_build_object('device_id', p_device, 'balance', v_balance));
  return true;
end $$;
revoke all on function public.device_job_done(uuid, text) from public, anon, authenticated;
grant execute on function public.device_job_done(uuid, text) to service_role;
