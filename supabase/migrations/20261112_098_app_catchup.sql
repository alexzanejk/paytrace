-- 098: the wallet app fills in what was missed (owner 2026-11-12: "if a phone is off for a couple of minutes our system
-- can check the app for what it missed ... whenever something does not match, solve it from the app, because it shows
-- 100% accurate data").
--
-- Before: the bKash app was read at :03/:33 and the Nagad app at :18/:48, whatever happened in between; a balance gap
-- only asked for a *247#/*167# statement (no times, few entries); a held Nagad payment only had the USSD checks.
-- Now, every minute, a phone's wallet app is read AT ONCE when
--   (a) the phone comes back after 3+ minutes offline (everything that happened while it was off is in the app), or
--   (b) that wallet has an open balance gap or a held payment newer than its last finished app read.
-- What the read brings back goes through the existing paths: rows into statement_lines/app_rows, gaps explained by the
-- app's exact times (081), held payments released only by their own TrxID in the app (086/093), deposits with no SMS
-- credited from the app (094). Same guards as the half-hourly reads: dashboard balance switch, the build's app flag,
-- an agent wallet of that kind, never after a failed sign-in (095), never while the phone is busy.

create table if not exists public.app_catchup_state (
  device_id uuid primary key references public.devices(id),
  offline_since timestamptz,      -- set while the phone is silent
  back_pending boolean not null default false,  -- came back after 3+ min, a read still to be queued
  updated_at timestamptz not null default now()
);
alter table public.app_catchup_state enable row level security;
revoke all on public.app_catchup_state from public, anon, authenticated;

create or replace function public.app_catchup_tick() returns integer
language plpgsql security definer set search_path = public as $$
declare
  d record; st record; w record; last record;
  online boolean; n int := 0; why text; read_kind text; flag_ok boolean; has_wallet boolean; mismatch boolean;
begin
  for d in
    select v.id, v.last_seen_at, v.info from public.devices v
     where v.status = 'approved' and coalesce(v.allow_balance, false)
  loop
    online := d.last_seen_at is not null and d.last_seen_at > now() - interval '90 seconds';
    select * into st from public.app_catchup_state s where s.device_id = d.id;
    if not online then
      insert into public.app_catchup_state (device_id, offline_since, updated_at)
      values (d.id, coalesce(d.last_seen_at, now()), now())
      on conflict (device_id) do update
        set offline_since = coalesce(public.app_catchup_state.offline_since, excluded.offline_since), updated_at = now();
      continue;
    end if;
    if st.offline_since is not null then
      update public.app_catchup_state
         set back_pending = back_pending or (now() - st.offline_since >= interval '3 minutes'),
             offline_since = null, updated_at = now()
       where device_id = d.id;
      select * into st from public.app_catchup_state s where s.device_id = d.id;
    end if;
    if exists (select 1 from public.phone_commands c where c.device_id = d.id and c.status = 'running') then continue; end if;

    for w in select unnest(array['bkash', 'nagad']) as provider loop
      read_kind := case w.provider when 'bkash' then 'appread' else 'nagadread' end;
      flag_ok := w.provider = 'bkash' or coalesce((d.info->>'app_nagad')::boolean, false);
      has_wallet := exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'wallets') = 'array' then d.info->'wallets' else '[]'::jsonb end) x
                             where x->>'provider' = w.provider and coalesce(x->>'kind', 'agent') = 'agent');
      if not flag_ok or not has_wallet then continue; end if;
      if public.app_login_blocked(d.id, w.provider) then continue; end if;

      last := null;
      select c.status, c.error, c.created_at, c.finished_at into last from public.phone_commands c
       where c.device_id = d.id and c.kind = read_kind order by c.created_at desc limit 1;
      if last.status in ('queued', 'running') then continue; end if;
      if last.error in ('no_bkash_app', 'no_nagad_app', 'no_pin', 'not_allowed', 'unsupported')
         and last.created_at > now() - interval '24 hours' then continue; end if;

      mismatch := exists (
          select 1 from public.balance_gaps g
           where g.device_id = d.id and g.provider = w.provider and g.explained_by is null
             and g.created_at > now() - interval '48 hours'
             and g.created_at > coalesce(last.created_at, '-infinity'::timestamptz))
        or exists (
          select 1 from public.payments p
           where p.device_id = d.id and p.provider = w.provider and p.status = 'review'
             and p.review_reason in ('balance_chain_mismatch', 'not_in_bkash_app')
             and p.received_at > now() - interval '48 hours'
             and p.received_at > coalesce(last.created_at, '-infinity'::timestamptz));

      why := case when coalesce(st.back_pending, false) then 'back_online' when mismatch then 'mismatch' else null end;
      if why is null then continue; end if;
      -- never more often than every 3 minutes per wallet app; a "back online" read is skipped when the app was read in
      -- the last 10 minutes anyway (a phone that blinks off and on must not sign in to the wallet app all day)
      if last.created_at > now() - interval '3 minutes' then continue; end if;
      if why = 'back_online' and not mismatch and last.created_at > now() - interval '10 minutes' then continue; end if;

      begin
        insert into public.phone_commands (device_id, kind) values (d.id, read_kind);
        insert into public.events (kind, provider, detail)
        values ('app_catchup', w.provider, jsonb_build_object('device_id', d.id, 'why', why, 'kind', read_kind));
        n := n + 1;
      exception when unique_violation then null;
      end;
    end loop;
    if coalesce(st.back_pending, false) then
      update public.app_catchup_state set back_pending = false, updated_at = now() where device_id = d.id;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.app_catchup_tick() from public, anon, authenticated;
grant execute on function public.app_catchup_tick() to service_role;

select cron.schedule('paytrace-app-catchup', '* * * * *', $$select public.app_catchup_tick()$$);
