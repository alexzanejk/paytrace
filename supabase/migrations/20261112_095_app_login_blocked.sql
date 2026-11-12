-- 095: after a wallet app sign-in failed, NO automatic run of that wallet's app may try to sign in again
-- (owner 2026-11-12, Vivo's Nagad app: after the 09:48 read ended "still on the sign-in screen", the every-5-minutes
-- unpaid-TrxID search (094) still queued nagadsearch at 10:10 and 10:15, each one typing the PIN again; a wallet locks
-- an account after a few wrong PINs). Before, each tick looked only at its OWN kind's last command.
--
-- app_login_blocked(device, provider): the newest FINISHED run of that wallet's app on that phone (reads, searches,
-- app balance, app Cash In, B2B) ended login_failed. Only a run the owner starts by hand (a dashboard button) can
-- clear it, by finishing without login_failed. Nothing is removed.

create or replace function public.app_login_blocked(p_device uuid, p_provider text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select c.error = 'login_failed'
      from public.phone_commands c
     where c.device_id = p_device and c.status in ('done', 'failed')
       and case when p_provider = 'nagad'
                then c.kind in ('nagadread', 'nagadsearch') or (c.kind in ('balance', 'cashin') and c.provider = 'nagad' and c.via = 'app')
                else c.kind in ('appread', 'appsearch', 'btob') or (c.kind in ('balance', 'cashin') and c.provider = 'bkash' and c.via = 'app')
           end
     order by coalesce(c.finished_at, c.created_at) desc
     limit 1), false);
$function$;
revoke all on function public.app_login_blocked(uuid, text) from public, anon, authenticated;

do $$
declare src text; fn text;
begin
  -- the half-hourly reads
  foreach fn in array array['public.app_read_tick()', 'public.app_read_tick_nagad()'] loop
    src := pg_get_functiondef(fn::regprocedure);
    if position('app_login_blocked' in src) = 0 then
      src := replace(src, 'if last.error = ''login_failed'' then continue; end if;',
        'if last.error = ''login_failed'' or public.app_login_blocked(d.id, '
        || case when fn like '%nagad%' then '''nagad''' else '''bkash''' end || ') then continue; end if;');
      if position('app_login_blocked' in src) = 0 then raise exception 'line not found in %', fn; end if;
      execute src;
    end if;
  end loop;
  -- the every-5-minutes search for typed TrxIDs with no SMS
  src := pg_get_functiondef('public.app_search_unpaid_tick()'::regprocedure);
  if position('app_login_blocked' in src) = 0 then
    src := replace(src, 'continue when d.id is null or d.status <> ''approved'' or d.allow_balance is false;',
      'continue when d.id is null or d.status <> ''approved'' or d.allow_balance is false;' || chr(10)
      || '    continue when public.app_login_blocked(d.id, o.claimed_provider);');
    if position('app_login_blocked' in src) = 0 then raise exception 'line not found in app_search_unpaid_tick'; end if;
    execute src;
  end if;
end $$;
