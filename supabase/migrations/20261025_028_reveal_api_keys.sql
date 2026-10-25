-- The owner asked to be able to see a website's key at any time (eye + copy on the Websites page), not only once.
-- So the key is now also kept in `key_plain`. Authentication still uses only the SHA-256 hash. `key_plain` is NOT in any column grant,
-- so it is readable only through reveal_api_key(), which is admin-only (two-step login applies through is_admin()) and is logged.
-- Keys made before this migration have no stored copy and cannot be shown (only their hash exists): make a new key for that site.
-- No DROP/DELETE statements: the Supabase MCP hangs on them.

alter table public.api_keys add column if not exists key_plain text;

-- Same as migration 011 plus the stored copy.
create or replace function public.create_api_key(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text;
  r public.api_keys;
  nm text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if char_length(nm) < 1 or char_length(nm) > 60 then raise exception 'give the key a short name (1 to 60 characters)'; end if;
  if (select count(*) from public.api_keys where revoked_at is null) >= 20 then
    raise exception 'too many active keys: revoke one you no longer use';
  end if;
  k := 'ptk_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.api_keys (name, key_hash, key_prefix, key_plain)
    values (nm, encode(sha256(convert_to(k, 'utf8')), 'hex'), left(k, 8), k)
    returning * into r;
  insert into public.events (kind, detail) values ('api_key_created', jsonb_build_object('key_id', r.id, 'name', r.name, 'by', auth.uid()));
  return jsonb_build_object('id', r.id, 'name', r.name, 'key', k);
end $$;

-- Shows the key (and the result-address signing secret, if one is set) of an ACTIVE website. Admin only; every look is logged.
create or replace function public.reveal_api_key(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.api_keys;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into r from public.api_keys where id = p_id and revoked_at is null;
  if r.id is null then raise exception 'key not found or revoked'; end if;
  insert into public.events (kind, detail) values ('api_key_revealed', jsonb_build_object('key_id', r.id, 'name', r.name, 'by', auth.uid()));
  return jsonb_build_object('key', r.key_plain, 'webhook_secret', r.webhook_secret);
end $$;
revoke all on function public.reveal_api_key(uuid) from public, anon;
grant execute on function public.reveal_api_key(uuid) to authenticated;
