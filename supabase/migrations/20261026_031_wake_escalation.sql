-- Faster, stronger wake-up pushes (owner 2026-10-26): the server remembers how many pushes in a row went unanswered and when it last
-- sent a visible one, so it can retry quickly, slow down, and add a visible notification after several tries.
-- Only the server touches this table (RLS on, no policies). No DROP/DELETE statements: the Supabase MCP hangs on them.
alter table public.device_push
  add column if not exists wake_tries int not null default 0,
  add column if not exists visible_at timestamptz;
