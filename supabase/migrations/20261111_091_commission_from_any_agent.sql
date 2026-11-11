-- 091: a partner's commission may be paid by Cash In from ANY of our agent wallets, not only the partner's own phone
-- (owner 2026-11-11: "on commission payout we can not pay from our other bKash Nagad agent; we should be able to pay from
-- our preferred one"). Only the one rule in create_commission_pay changes; everything else in it stays as it is, so it is
-- patched in place. In its place: the sending phone must list an agent wallet of that kind in its app (a phone that lists no
-- wallets at all, an old build, is still allowed, as before). Settling by SMS already follows the SENDING phone
-- (commission_pays_follow_sms uses from_device_id), so nothing else changes. No DROP or DELETE.
do $$
declare def text; old text := $o$  if p_method = 'cash_in' and p_from_device <> p_device then raise exception 'a Cash In payment comes from the partner''s own phone'; end if;$o$;
begin
  def := pg_get_functiondef('public.create_commission_pay(uuid,date[],text,uuid,text,text)'::regprocedure);
  if position(old in def) = 0 then raise exception 'create_commission_pay is not the expected version'; end if;
  def := replace(def, old, $n$  if p_method = 'cash_in' and exists (
       select 1 from public.devices x where x.id = p_from_device and jsonb_typeof(x.info->'wallets') = 'array'
          and jsonb_array_length(x.info->'wallets') > 0)
     and not exists (
       select 1 from public.devices x, jsonb_array_elements(x.info->'wallets') w
        where x.id = p_from_device and w->>'provider' = p_provider and coalesce(w->>'kind', 'agent') = 'agent') then
    raise exception 'the sending phone has no % agent wallet saved in its app', p_provider;
  end if;$n$);
  execute def;
end $$;
