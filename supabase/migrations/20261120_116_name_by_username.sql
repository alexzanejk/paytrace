-- 116: the name on a transaction is the Telegram @username (owner 2026-11-20: "it should be telegram username";
-- display names are not unique, usernames are). Order: the site login the person typed in the group (113), else
-- @username, else the display name (only a person with no username), else "user <id>". The identity stays the
-- permanent Telegram id in payment_names.tg_user_id; this changes labels only. Bot-named rows are renamed once.
create or replace function public.tg_person_name(p_user bigint) returns text language sql stable as $$
  select coalesce(nullif(trim(u.site_username), ''), case when nullif(trim(u.username), '') is not null then '@' || trim(u.username) end, nullif(trim(u.name), ''), 'user ' || u.tg_user_id)
  from public.telegram_users u where u.tg_user_id = p_user;
$$;

update public.payment_names n set name = public.tg_person_name(n.tg_user_id), set_at = now()
 where n.source = 'telegram' and n.tg_user_id is not null and n.name is distinct from public.tg_person_name(n.tg_user_id);
update public.payout_plans p set label = public.tg_person_name(p.tg_user_id)
 where p.tg_user_id is not null and p.status in ('queued', 'sending') and p.label is distinct from public.tg_person_name(p.tg_user_id);
