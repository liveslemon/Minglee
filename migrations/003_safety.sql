-- User safety: reports and blocks.
--
-- user_reports: a user reports another member for admin review. At most one
-- open report per (reporter, reported) pair; the API returns the existing open
-- report instead of inserting a duplicate.
--
-- user_blocks: a user blocks another member. Blocking also sets any live match
-- between the two to status 'cancelled' (done by the API), which hides it from
-- GET /matches/current.
--
-- RLS is enabled with NO policies: the backend uses the service-role key, which
-- bypasses RLS, and the browser anon key must not read or write these tables.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_reports_not_self CHECK (reporter_id <> reported_user_id),
  CONSTRAINT chk_user_reports_status CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned'))
);

-- At most one open report per reporter/reported pair (also serves the
-- "return the existing open report" lookup).
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reports_open_pair
  ON public.user_reports (reporter_id, reported_user_id) WHERE status = 'open';
-- Admin view: open reports per reported user.
CREATE INDEX IF NOT EXISTS idx_user_reports_reported_status
  ON public.user_reports (reported_user_id, status);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_blocks_pair UNIQUE (blocker_id, blocked_id),
  CONSTRAINT chk_user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

-- Reverse lookup ("who blocked this user"); the unique constraint already
-- covers lookups by blocker_id.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
