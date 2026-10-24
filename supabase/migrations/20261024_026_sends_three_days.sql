-- Phone app: show a partner's sends of the last 3 days (not only the ones still open), so a rejected or "does not add up" send is easy to find,
-- the same 3-day window as the payments they were paid. Still open ones (waiting, needs a decision) show whatever their age.
-- Rows also carry when they were settled (resolved_at) and the owner's note, if any. Same function name and argument (create or replace).

create or replace function public.device_jobs(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_jobs jsonb;
  v_transfers jsonb;
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
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'provider', x.provider, 'amount', x.amount, 'charge', x.charge, 'status', x.status,
           'attempts', x.attempts, 'submitted_at', x.submitted_at, 'resolved_at', x.checked_at, 'note', x.note) order by x.submitted_at desc), '[]'::jsonb)
    into v_transfers
    from (select * from public.job_transfers t
           where t.device_id = p_device
             and (t.status in ('checking', 'mismatch', 'review') or t.submitted_at > now() - interval '3 days')
           order by t.submitted_at desc limit 10) x;
  return jsonb_build_object('jobs', v_jobs, 'transfers', v_transfers);
end $$;
revoke all on function public.device_jobs(uuid) from public, anon, authenticated;
grant execute on function public.device_jobs(uuid) to service_role;
