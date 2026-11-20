-- 120: a name typed by the owner as "@username" links the transaction to that Telegram person (owner 2026-11-20:
-- "@Cra_zy1 done a paid out but no paid out message, not to user inbox nor to group reply").
-- WHY: the "payout sent" notice (118/119) finds the person through payment_names.tg_user_id. Names typed on the Payout
-- page's chip ("@Cra_zy1", source owner) carried only the words and no Telegram id, so a payout made from the Payout page
-- for a hand-named person found nobody and sent nothing (141 such rows on the day). A typed "@handle" that is a known
-- Telegram username (one person, case-insensitive) now resolves to that person: on save, in the payout's person lookup,
-- and once for the rows already there. A handle nobody known carries stays a plain name (no notice, as before).
create or replace function public.tg_user_by_handle(p_name text) returns bigint language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then min(u.tg_user_id) end
    from public.telegram_users u
   where nullif(trim(u.username), '') is not null
     and lower(trim(u.username)) = lower(regexp_replace(trim(coalesce(p_name, '')), '^@', ''))
     and trim(coalesce(p_name, '')) like '@%';
$$;
revoke all on function public.tg_user_by_handle(text) from public, anon;
grant execute on function public.tg_user_by_handle(text) to authenticated, service_role;

create or replace function public.set_payment_name(p_payment uuid, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  nm text := nullif(left(trim(coalesce(p_name, '')), 64), '');
  claim uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from public.payments where id = p_payment) then raise exception 'no such transaction'; end if;
  if nm is not null then
    insert into public.payment_names (payment_id, name, tg_user_id, source, set_by, set_at) values (p_payment, nm, public.tg_user_by_handle(nm), 'owner', auth.uid(), now())
    on conflict (payment_id) do update set name = excluded.name, tg_user_id = excluded.tg_user_id, source = 'owner', set_by = excluded.set_by, set_at = now();
  else
    select c.id into claim from public.telegram_claims c
     where c.payment_id = p_payment and c.status in ('matched', 'paid', 'held', 'duplicate') order by c.sent_at limit 1;
    insert into public.payment_names (payment_id, name, source, set_by, set_at) values (p_payment, null, 'telegram', auth.uid(), now())
    on conflict (payment_id) do update set name = null, tg_user_id = null, claim_id = null, source = 'telegram', set_by = excluded.set_by, set_at = now();
    if claim is not null then perform public.payment_name_from_claim(claim); end if;
  end if;
  insert into public.events (kind, provider, detail) values ('payment_name_set', null, jsonb_build_object('payment', p_payment, 'name', nm, 'by', auth.uid()));
  return (select to_jsonb(n) from public.payment_names n where n.payment_id = p_payment);
end $$;

-- The person a payout belongs to: the plan it came from, else the one Telegram id its transactions are named with,
-- else the one "@handle" its transactions are named with that is a known person.
create or replace function public.tg_payout_person(p_payout uuid) returns bigint language sql stable security definer set search_path = public as $$
  with by_plan as (select tg_user_id from public.payout_plans where payout_id = p_payout and tg_user_id is not null limit 1),
  by_name as (
    select n.tg_user_id from public.payout_items i join public.payment_names n on n.payment_id = i.payment_id
     where i.payout_id = p_payout and n.tg_user_id is not null group by n.tg_user_id),
  by_handle as (
    select public.tg_user_by_handle(n.name) as tg_user_id from public.payout_items i join public.payment_names n on n.payment_id = i.payment_id
     where i.payout_id = p_payout and n.tg_user_id is null and n.name like '@%' group by n.name)
  select coalesce((select tg_user_id from by_plan),
                  case when (select count(*) from by_name) = 1 then (select tg_user_id from by_name) end,
                  case when (select count(*) from by_name) = 0 and (select count(*) from by_handle) = 1 then (select tg_user_id from by_handle) end);
$$;

-- Once: the rows typed before this.
update public.payment_names n set tg_user_id = public.tg_user_by_handle(n.name)
 where n.tg_user_id is null and n.name like '@%' and public.tg_user_by_handle(n.name) is not null;
