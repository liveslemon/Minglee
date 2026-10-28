-- Add storage for one weekly-active record per user and UTC week.
-- Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.weekly_active_users (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_active_users_week_start
  ON public.weekly_active_users(week_start);

ALTER TABLE public.weekly_active_users ENABLE ROW LEVEL SECURITY;

COMMIT;
