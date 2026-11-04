-- 055: webhook failures visible and alerted (audit 2026-11-04, batch 3).
--  1. Admins can read next_attempt_at, so the Websites page can say when the next try is.
--  2. gw_webhook_result2 (new name: the old one returns void and a return type cannot change in place) records a try and
--     says whether the owner should be told: at the 3rd failed try (about 20 minutes of trying) and when PayTrace gives up
--     after 8 tries, at most once an hour per website (webhook_outbox.alerted_at). The gateway sends the Telegram message.
--  3. retry_site_webhooks(key): "Retry all" on the Websites page. The existing retry_webhook(id) stays for one message.
-- "Run the parser again" for unread SMS needs no SQL: it lives in the ingest function and the events table.
-- No DROP or DELETE (the MCP hangs on them).

grant select (next_attempt_at) on public.webhook_outbox to authenticated;
alter table public.webhook_outbox add column if not exists alerted_at timestamptz;

create or replace function public.gw_webhook_result2(p_id bigint, p_ok boolean, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; ev text; gave boolean := false; kid uuid; kname text; oref text; recent int; alert boolean := false;
begin
  if p_ok then
    update public.webhook_outbox set delivered_at = now(), attempts = attempts + 1, last_status = left(p_status, 60) where id = p_id;
    return jsonb_build_object('ok', true);
  end if;
  update public.webhook_outbox set attempts = attempts + 1, last_status = left(p_status, 60) where id = p_id returning attempts, event into a, ev;
  if a is null then return jsonb_build_object('ok', false); end if;
  if a >= 8 then
    update public.webhook_outbox set gave_up_at = now() where id = p_id;
    gave := true;
  else
    -- 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h
    update public.webhook_outbox set next_attempt_at = now() + (array[1,5,15,60,180,360,720])[least(a, 7)] * interval '1 minute' where id = p_id;
  end if;
  select k.id, k.name, coalesce(o.merchant_order_id, o.order_no) into kid, kname, oref
    from public.webhook_outbox w join public.orders o on o.id = w.order_id join public.api_keys k on k.id = o.api_key_id
   where w.id = p_id;
  if a = 3 or gave then
    select count(*) into recent
      from public.webhook_outbox w2 join public.orders o2 on o2.id = w2.order_id
     where o2.api_key_id = kid and w2.alerted_at > now() - interval '1 hour';
    if recent = 0 then
      update public.webhook_outbox set alerted_at = now() where id = p_id;
      alert := true;
    end if;
  end if;
  return jsonb_build_object('ok', false, 'attempts', a, 'gave_up', gave, 'alert', alert, 'site_name', kname, 'order_ref', oref, 'event', ev);
end $$;

create or replace function public.retry_site_webhooks(p_key uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.webhook_outbox w set gave_up_at = null, next_attempt_at = now(), attempts = least(w.attempts, 7)
    from public.orders o
   where o.id = w.order_id and o.api_key_id = p_key and w.delivered_at is null and w.created_at > now() - interval '30 days';
  get diagnostics n = row_count;
  insert into public.events(kind, detail) values ('webhooks_retried', jsonb_build_object('by', auth.uid(), 'key_id', p_key, 'count', n));
  return n;
end $$;
revoke all on function public.retry_site_webhooks(uuid) from public, anon;
grant execute on function public.retry_site_webhooks(uuid) to authenticated;
