-- 117: ONLY the Telegram @username names a person (owner 2026-11-20: "no never use that [the site login], only
-- telegram user name"). Order: @username, else the display name (a person with no username), else "user <id>".
-- The site login typed in a post is still remembered on telegram_users.site_username (harmless), but names nothing.
-- Identity stays the permanent Telegram id. Bot-named rows and queued plan labels are renamed once more.
create or replace function public.tg_person_name(p_user bigint) returns text language sql stable as $$
  select coalesce(case when nullif(trim(u.username), '') is not null then '@' || trim(u.username) end, nullif(trim(u.name), ''), 'user ' || u.tg_user_id)
  from public.telegram_users u where u.tg_user_id = p_user;
$$;

update public.payment_names n set name = public.tg_person_name(n.tg_user_id), set_at = now()
 where n.source = 'telegram' and n.tg_user_id is not null and n.name is distinct from public.tg_person_name(n.tg_user_id);
update public.payout_plans p set label = public.tg_person_name(p.tg_user_id)
 where p.tg_user_id is not null and p.status in ('queued', 'sending') and p.label is distinct from public.tg_person_name(p.tg_user_id);
