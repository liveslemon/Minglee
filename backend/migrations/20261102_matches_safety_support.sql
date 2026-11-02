-- Backs the match reveal/feedback flow, user safety actions (report/block), and
-- the WhatsApp support handoff with real tables instead of endpoints the
-- frontend called that had nothing behind them. Safe to run more than once.

BEGIN;

-- The weekly Gale-Shapley matcher (src/services/matchingService.js) already
-- writes here; this just brings the tracked schema in line with reality.
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL DEFAULT 0,
  match_week DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_user1 ON public.matches(user1_id);
CREATE INDEX IF NOT EXISTS idx_matches_user2 ON public.matches(user2_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.matches(status);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- "How did your date go?" feedback from the /date page (POST /matches/:id/feedback).
CREATE TABLE IF NOT EXISTS public.match_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, user_id)
);

ALTER TABLE public.match_feedback ENABLE ROW LEVEL SECURITY;

-- "Report profile/photo" safety action (POST /reports).
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- "Block member" safety action (POST /users/:id/block). A block excludes the
-- pair from future matching cycles in both directions.
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id)
);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- Questions sent to the Minglee WhatsApp number that the auto-reply bot
-- (src/services/whatsappService.js) couldn't confidently answer, so a human
-- can follow up instead of the bot silently promising one will.
CREATE TABLE IF NOT EXISTS public.whatsapp_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_inquiries_status ON public.whatsapp_inquiries(status);

ALTER TABLE public.whatsapp_inquiries ENABLE ROW LEVEL SECURITY;

COMMIT;
