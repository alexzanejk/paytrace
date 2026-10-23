-- Jobs per agent (owner correction 2026-10-23). Migration 020 gave a job to a phone as a whole. An "agent" is one wallet on a phone (its bKash,
-- Nagad, Rocket or Upay account), so each agent now has its own job: its own description, urgency and wallet address, shown on the phone when
-- that agent's own balance reaches the amount. The default job from migration 020 stays as the fallback, so nothing has to be typed twice.
-- Additive only: no statements the Supabase MCP cannot run (see migration 014).

alter table public.job_settings add column if not exists urgency text not null default 'normal' check (urgency in ('normal', 'urgent', 'critical'));

create table public.agent_jobs (
  device_id uuid not null references public.devices(id),
  provider text not null check (provider in ('bkash', 'nagad', 'rocket', 'upay')),
  agent_name text check (agent_name is null or length(agent_name) <= 40),
  enabled boolean not null default true,
  instruction text check (instruction is null or length(instruction) <= 1000),
  urgency text check (urgency is null or urgency in ('normal', 'urgent', 'critical')),
  wallet text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (device_id, provider)
);
alter table public.agent_jobs enable row level security;
create policy agent_jobs_read on public.agent_jobs for select to authenticated using (public.is_admin());
revoke all on public.agent_jobs from anon, authenticated;
grant select on public.agent_jobs to authenticated;

-- Same columns as before in the same order, two new ones at the end. An agent's own text, wallet and urgency win over the default.
create or replace view public.device_open_jobs with (security_invoker = true) as
select b.device_id, b.provider, b.balance, b.at as balance_at, s.threshold,
       coalesce(nullif(a.instruction, ''), s.instruction) as instruction,
       coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider) as wallet,
       coalesce(a.urgency, s.urgency) as urgency,
       coalesce(nullif(a.agent_name, ''), nullif(d.name, ''), d.pair_code) as agent_name
  from public.device_balances b
  join public.devices d on d.id = b.device_id and d.status = 'approved'
  join public.job_settings s on s.enabled
  left join public.agent_jobs a on a.device_id = b.device_id and a.provider = b.provider
 where b.balance >= s.threshold
   and coalesce(a.enabled, true)
   and coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider, '') <> ''
   and coalesce(nullif(a.instruction, ''), s.instruction) <> ''
   and not exists (
     select 1 from public.job_completions c
      where c.device_id = b.device_id and c.provider = b.provider and c.done_at >= b.at
   );

-- The default job, now with an urgency. (The older four-argument version keeps working and keeps the current urgency.)
create or replace function public.set_job_settings(p_enabled boolean, p_threshold numeric, p_instruction text, p_wallets jsonb, p_urgency text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_urgency is null or p_urgency not in ('normal', 'urgent', 'critical') then raise exception 'urgency must be normal, urgent or critical'; end if;
  perform public.set_job_settings(p_enabled, p_threshold, p_instruction, p_wallets);
  update public.job_settings set urgency = p_urgency where id;
end $$;
revoke all on function public.set_job_settings(boolean, numeric, text, jsonb, text) from public, anon;
grant execute on function public.set_job_settings(boolean, numeric, text, jsonb, text) to authenticated;

-- One agent's own job. Empty text / wallet / urgency means "use the default job".
create or replace function public.set_agent_job(p_device uuid, p_provider text, p_agent_name text, p_enabled boolean,
                                                p_instruction text, p_urgency text, p_wallet text)
returns void language plpgsql security definer set search_path = public as $$
declare
  nm text := nullif(btrim(coalesce(p_agent_name, '')), '');
  txt text := nullif(btrim(coalesce(p_instruction, '')), '');
  w text := nullif(btrim(coalesce(p_wallet, '')), '');
  u text := nullif(btrim(coalesce(p_urgency, '')), '');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'unknown provider'; end if;
  if not exists (select 1 from public.devices where id = p_device and status = 'approved') then raise exception 'phone not found'; end if;
  if nm is not null and length(nm) > 40 then raise exception 'the name is too long (40 characters at most)'; end if;
  if txt is not null and length(txt) > 1000 then raise exception 'the instruction is too long (1000 characters at most)'; end if;
  if u is not null and u not in ('normal', 'urgent', 'critical') then raise exception 'urgency must be normal, urgent or critical'; end if;
  if w is not null and w !~ '^[0-9A-Za-z+ ._:@/-]{6,60}$' then raise exception 'a wallet address must be 6 to 60 letters, numbers or . _ - characters'; end if;
  insert into public.agent_jobs(device_id, provider, agent_name, enabled, instruction, urgency, wallet, updated_at, updated_by)
    values (p_device, p_provider, nm, coalesce(p_enabled, true), txt, u, w, now(), auth.uid())
    on conflict (device_id, provider) do update
      set agent_name = excluded.agent_name, enabled = excluded.enabled, instruction = excluded.instruction,
          urgency = excluded.urgency, wallet = excluded.wallet, updated_at = now(), updated_by = auth.uid();
  insert into public.events(kind, provider, detail) values ('agent_job_set', p_provider, jsonb_build_object('device_id', p_device, 'by', auth.uid()));
end $$;
revoke all on function public.set_agent_job(uuid, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.set_agent_job(uuid, text, text, boolean, text, text, text) to authenticated;

-- What a phone shows: one entry per agent whose own balance reached the amount, most urgent first.
-- {agent}, {provider} and {balance} in the text are filled in for each agent.
create or replace function public.device_jobs(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb;
  names constant jsonb := '{"bkash":"bKash","nagad":"Nagad","rocket":"Rocket","upay":"Upay"}'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', j.provider,
           'agent', j.agent_name,
           'urgency', j.urgency,
           'balance', j.balance,
           'balance_at', j.balance_at,
           'threshold', j.threshold,
           'wallet', j.wallet,
           'instruction', replace(replace(replace(j.instruction, '{agent}', j.agent_name), '{provider}', coalesce(names ->> j.provider, j.provider)),
                                  '{balance}', 'Tk ' || to_char(j.balance, 'FM999,999,999,990.00'))
         ) order by case j.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, j.balance desc), '[]'::jsonb)
    into v_jobs
    from public.device_open_jobs j
   where j.device_id = p_device;
  return jsonb_build_object('jobs', v_jobs);
end $$;
revoke all on function public.device_jobs(uuid) from public, anon, authenticated;
grant execute on function public.device_jobs(uuid) to service_role;
