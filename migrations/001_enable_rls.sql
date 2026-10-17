-- Enable Row Level Security on every table in the public schema.
--
-- The backend uses the service-role key, which bypasses RLS, so backend
-- behaviour is unchanged. What this blocks is the *anon* key that ships in the
-- frontend bundle: without RLS, anyone can read/write every table with it
-- (including users.password_hash and whatsapp_number).
--
-- Users authenticate with the backend's own JWT, not Supabase Auth, so
-- auth.uid() is always NULL for browser requests. Per-user policies therefore
-- can't work from the browser; user-specific reads/writes must go through the API.
--
-- Safe to re-run.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Public read access the frontend currently depends on.
-- events: listing + detail pages read this table directly.
DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'Public can read events'
  ) THEN
    CREATE POLICY "Public can read events" ON public.events FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- event_attendees: the event page checks attendance / counts attendees directly.
-- This exposes (event_id, user_id) pairs only. TODO: move these reads behind the API
-- and drop this policy.
DO $$
BEGIN
  IF to_regclass('public.event_attendees') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_attendees' AND policyname = 'Public can read event attendees'
  ) THEN
    CREATE POLICY "Public can read event attendees" ON public.event_attendees FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- After running, review anything still permissive with:
--   SELECT tablename, policyname, roles, cmd, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
-- Drop any pre-existing "allow all" style policies on users, payments, tickets,
-- matches, user_profiles, preferences, notifications, push_subscriptions, ads.
