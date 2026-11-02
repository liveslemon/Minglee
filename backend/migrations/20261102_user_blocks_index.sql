-- Block checks now run bidirectionally on hot paths (every match load and
-- message send), so index the reverse lookup direction too.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id
  ON public.user_blocks (blocked_id);
