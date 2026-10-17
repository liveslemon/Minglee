-- Post-date feedback ("Minglee Moments" on the /date page).
--
-- One rating per user per match; re-rating overwrites it. 'uncomfortable'
-- ratings are a safety signal worth reviewing alongside user_reports.
--
-- RLS is enabled with NO policies: only the backend (service role) touches it.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.match_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_match_feedback_user UNIQUE (match_id, user_id),
  CONSTRAINT chk_match_feedback_rating CHECK (rating IN ('loved', 'nice', 'neutral', 'uncomfortable'))
);

CREATE INDEX IF NOT EXISTS idx_match_feedback_rating ON public.match_feedback (rating);

ALTER TABLE public.match_feedback ENABLE ROW LEVEL SECURITY;
