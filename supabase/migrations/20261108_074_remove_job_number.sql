-- 074: remove one of our numbers from the Taka job (owner 2026-11-08: "when we add our number for jobs there is no option to
-- remove them"). A number stays in the table (past jobs and payouts name it) but is marked removed: hidden on the Jobs page,
-- switched off, never handed out again. A partner's open (not yet done) job that shows it is cancelled and comes back at once
-- with another of our numbers (cashin_sync, on the phone's next heartbeat). Adding the same number again brings it back.

alter table public.cashin_numbers add column if not exists removed_at timestamptz;

create or replace function public.remove_cashin_number(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n public.cashin_numbers;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.cashin_numbers set enabled = false, removed_at = now() where id = p_id returning * into n;
  if n.id is null then raise exception 'number not found'; end if;
  update public.cashin_jobs set status = 'cancelled', checked_at = now(), note = 'switched'
   where number = n.number and status = 'open';
  insert into public.events (kind, provider, detail) values ('cashin_number_removed', n.provider, jsonb_build_object('number', n.number, 'by', auth.uid()));
end $$;

revoke all on function public.remove_cashin_number(uuid) from public, anon;
grant execute on function public.remove_cashin_number(uuid) to authenticated, service_role;

create or replace function public.add_cashin_number(p_provider text, p_number text, p_label text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g'); lab text := left(nullif(btrim(coalesce(p_label, '')), ''), 40);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_provider is null or p_provider not in ('bkash', 'nagad', 'rocket', 'upay') then raise exception 'choose bKash, Nagad, Rocket or Upay'; end if;
  if left(d, 3) = '880' and char_length(d) = 13 then d := '0' || substr(d, 4); end if;
  if d !~ '^01[0-9]{9}$' then raise exception 'a mobile number has 11 digits and starts with 01'; end if;
  insert into public.cashin_numbers (provider, number, label) values (p_provider, d, lab)
    on conflict (provider, number) do update set enabled = true, removed_at = null, label = coalesce(excluded.label, public.cashin_numbers.label);
  insert into public.events(kind, provider, detail) values ('cashin_number_added', p_provider, jsonb_build_object('by', auth.uid()));
end $$;
