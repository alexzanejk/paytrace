-- 128: the "payment not received" reply names the person (owner 2026-11-25). The reply is sent as a Telegram reply to the
-- post, but when the post was already deleted Telegram drops the quote and the text stands alone, naming only the TrxID
-- (76DDM48V, 24 Nov 13:01: @Kevin556011's 12:39 screenshot was gone). Now the text carries the person: {user} in the owner's
-- words is replaced by tg_who (the @username, else the display name, else "user N"; migration 123's helper), and words
-- without {user} get the person put in FRONT, so the stored text and the default work without re-saving. Only tg_nf_next
-- changes (127's definition, read live and identical); the rule, the wait, the 👎 and the take-back are untouched. No DROP.
create or replace function public.tg_nf_next(p_limit int default 5)
returns table (id uuid, chat_id bigint, message_id bigint, trx text, text text) language sql security definer set search_path = public as $$
  with w as (
    select coalesce((select s.not_found_text from public.telegram_settings s where s.id limit 1), public.tg_not_found_default_text()) as words
  )
  select c.id, c.chat_id, c.message_id, c.nf_trx,
         case when w.words like '%{user}%'
              then replace(replace(w.words, '{user}', coalesce(public.tg_who(c.tg_user_id), '')), '{trx}', coalesce(c.nf_trx, ''))
              else coalesce(public.tg_who(c.tg_user_id) || ' ', '') || replace(w.words, '{trx}', coalesce(c.nf_trx, ''))
         end
    from public.telegram_claims c, w
   where c.nf_pending and c.nf_tries < 3
   order by c.sent_at limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.tg_nf_next(int) from public, anon, authenticated;
grant execute on function public.tg_nf_next(int) to service_role;
