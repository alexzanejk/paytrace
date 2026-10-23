-- The wallet for the job is the owner's crypto wallet (Trust Wallet, BNB Smart Chain), so the job carries a network, and an address that
-- starts with 0x must be a real BNB Smart Chain / EVM address (0x + 40 hex characters). The default job is Urgent. Additive only.

alter table public.job_settings add column if not exists network text not null default 'BNB Smart Chain (BEP20)' check (length(network) between 2 and 60);
alter table public.agent_jobs add column if not exists network text check (network is null or length(network) between 2 and 60);
update public.job_settings set urgency = 'urgent' where id and urgency = 'normal';

create or replace view public.device_open_jobs with (security_invoker = true) as
select b.device_id, b.provider, b.balance, b.at as balance_at, s.threshold,
       coalesce(nullif(a.instruction, ''), s.instruction) as instruction,
       coalesce(nullif(a.wallet, ''), s.wallets ->> b.provider) as wallet,
       coalesce(a.urgency, s.urgency) as urgency,
       coalesce(nullif(a.agent_name, ''), nullif(d.name, ''), d.pair_code) as agent_name,
       coalesce(nullif(a.network, ''), s.network) as network
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

create or replace function public.set_job_settings(p_enabled boolean, p_threshold numeric, p_instruction text, p_wallets jsonb, p_urgency text, p_network text)
returns void language plpgsql security definer set search_path = public as $$
declare nw text := btrim(coalesce(p_network, '')); v text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if length(nw) < 2 or length(nw) > 60 then raise exception 'type the network, for example BNB Smart Chain (BEP20)'; end if;
  if p_wallets is not null and jsonb_typeof(p_wallets) = 'object' then
    for v in select btrim(value) from jsonb_each_text(p_wallets) loop
      if v like '0x%' and v !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'that is not a valid BNB Smart Chain address (0x followed by 40 letters or numbers)'; end if;
    end loop;
  end if;
  perform public.set_job_settings(p_enabled, p_threshold, p_instruction, p_wallets, p_urgency);
  update public.job_settings set network = nw where id;
end $$;
revoke all on function public.set_job_settings(boolean, numeric, text, jsonb, text, text) from public, anon;
grant execute on function public.set_job_settings(boolean, numeric, text, jsonb, text, text) to authenticated;

create or replace function public.set_agent_job(p_device uuid, p_provider text, p_agent_name text, p_enabled boolean,
                                                p_instruction text, p_urgency text, p_wallet text, p_network text)
returns void language plpgsql security definer set search_path = public as $$
declare w text := btrim(coalesce(p_wallet, '')); nw text := nullif(btrim(coalesce(p_network, '')), '');
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if w like '0x%' and w !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'that is not a valid BNB Smart Chain address (0x followed by 40 letters or numbers)'; end if;
  if nw is not null and (length(nw) < 2 or length(nw) > 60) then raise exception 'the network name must be 2 to 60 characters'; end if;
  perform public.set_agent_job(p_device, p_provider, p_agent_name, p_enabled, p_instruction, p_urgency, p_wallet);
  update public.agent_jobs set network = nw where device_id = p_device and provider = p_provider;
end $$;
revoke all on function public.set_agent_job(uuid, text, text, boolean, text, text, text, text) from public, anon;
grant execute on function public.set_agent_job(uuid, text, text, boolean, text, text, text, text) to authenticated;

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
           'network', j.network,
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
