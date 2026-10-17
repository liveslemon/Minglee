-- Atomic, once-per-week saving of match results.
--
-- Previously the backend expired all pending matches and then inserted the new
-- week's matches as two separate requests: if the insert failed, everyone lost
-- their match. Running the cycle twice in a week also created duplicate pairs.
--
-- replace_weekly_matches() does both steps in a single transaction and is a
-- no-op if the week already has matches. The matching algorithm is unchanged;
-- this only affects how its output is stored.
--
-- Safe to re-run.

-- A user can be in at most one live match per week.
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_week_user1_live
  ON public.matches (match_week, user1_id) WHERE status <> 'expired';
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_week_user2_live
  ON public.matches (match_week, user2_id) WHERE status <> 'expired';

CREATE OR REPLACE FUNCTION public.replace_weekly_matches(p_week date, p_matches jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  -- Serialize concurrent runs (cron + admin button at the same time).
  PERFORM pg_advisory_xact_lock(hashtext('replace_weekly_matches'));

  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE match_week::date = p_week AND status <> 'expired'
  ) THEN
    RETURN jsonb_build_object('status', 'already_ran', 'inserted', 0);
  END IF;

  UPDATE public.matches
  SET status = 'expired'
  WHERE status = 'pending' AND match_week::date < p_week;

  INSERT INTO public.matches (user1_id, user2_id, match_score, match_week, status)
  SELECT (m->>'user1_id')::uuid,
         (m->>'user2_id')::uuid,
         (m->>'match_score')::numeric,
         p_week,
         'pending'
  FROM jsonb_array_elements(COALESCE(p_matches, '[]'::jsonb)) AS m;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('status', 'ok', 'inserted', v_inserted);
END;
$$;

-- Only the backend (service role) may call it.
REVOKE ALL ON FUNCTION public.replace_weekly_matches(date, jsonb) FROM PUBLIC, anon, authenticated;
