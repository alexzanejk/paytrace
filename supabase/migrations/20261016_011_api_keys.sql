-- API keys for the website's admin and super-admin servers, made and revoked from the dashboard (API access page).
-- Only a SHA-256 hash is stored; the key itself is shown once, when it is created, and cannot be recovered.
-- This replaces the VERIFY_API_KEYS secret idea: nothing has to be typed into Supabase.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  key_hash text not null unique,
  key_prefix text not null,           -- first characters, so the owner can tell keys apart
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;

-- Admins can read the list, but never the hash: only these columns are granted.
revoke all on public.api_keys from anon, authenticated;
grant select (id, name, key_prefix, created_at, last_used_at, revoked_at) on public.api_keys to authenticated;
drop policy if exists api_keys_admin_read on public.api_keys;
create policy api_keys_admin_read on public.api_keys for select to authenticated using (public.is_admin());

-- Makes a key. Returns it once. Admin only (and two-step login is enforced by is_admin()).
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
  insert into public.api_keys (name, key_hash, key_prefix)
    values (nm, encode(sha256(convert_to(k, 'utf8')), 'hex'), left(k, 8))
    returning * into r;
  insert into public.events (kind, detail) values ('api_key_created', jsonb_build_object('key_id', r.id, 'name', r.name, 'by', auth.uid()));
  return jsonb_build_object('id', r.id, 'name', r.name, 'key', k);
end $$;

create or replace function public.revoke_api_key(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.api_keys;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.api_keys set revoked_at = now() where id = p_id and revoked_at is null returning * into r;
  if r.id is null then raise exception 'key not found or already revoked'; end if;
  insert into public.events (kind, detail) values ('api_key_revoked', jsonb_build_object('key_id', r.id, 'name', r.name, 'by', auth.uid()));
end $$;

revoke all on function public.create_api_key(text) from public, anon;
revoke all on function public.revoke_api_key(uuid) from public, anon;
grant execute on function public.create_api_key(text) to authenticated;
grant execute on function public.revoke_api_key(uuid) to authenticated;

-- The lookup used by the verify-transaction function. p_key_id is now the SHA-256 hash of the key the caller sent
-- (the parameter keeps its old name because Postgres cannot rename a parameter in place). Unknown or revoked key:
-- {"unauthorized": true}. The rate limit is counted per key.
create or replace function public.verify_transaction(
  p_trx text,
  p_provider text,
  p_key_id text,
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := date_trunc('minute', now());
  kid uuid;
  n integer;
  c integer;
  a numeric;
  prov text;
begin
  select id into kid from public.api_keys where key_hash = p_key_id and revoked_at is null;
  if kid is null then
    return jsonb_build_object('unauthorized', true);
  end if;
  update public.api_keys set last_used_at = now()
   where id = kid and (last_used_at is null or last_used_at < now() - interval '1 minute');

  insert into public.verify_rate as r (key_id, window_start, hits) values (kid::text, w, 1)
  on conflict (key_id, window_start) do update set hits = r.hits + 1
  returning r.hits into n;

  if random() < 0.02 then
    delete from public.verify_rate where window_start < now() - interval '1 hour';
  end if;

  if n > p_limit then
    return jsonb_build_object('limited', true);
  end if;

  select count(*), (array_agg(amount order by received_at desc))[1], (array_agg(provider order by received_at desc))[1]
    into c, a, prov
    from public.payments
   where trx_id = upper(btrim(p_trx))
     and (p_provider is null or provider = p_provider)
     and status in ('unmatched', 'matched', 'tracked_only');

  if c = 0 then
    return jsonb_build_object('found', false);
  end if;
  if c > 1 then
    return jsonb_build_object('found', true, 'ambiguous', true);
  end if;
  return jsonb_build_object('found', true, 'provider', prov, 'amount', a);
end $$;
