-- In-app chat for matched pairs (GET/POST /matches/:id/messages), so a Friday
-- match isn't forced through WhatsApp to say hello. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.match_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Added as explicit ALTERs (not inline in the CREATE TABLE above) so this
-- still lands correctly if a `match_messages` table already exists from a
-- prior partial run, same as schema.sql does for `notifications`.
ALTER TABLE public.match_messages ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE;
ALTER TABLE public.match_messages ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.match_messages ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.match_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.match_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- A `match_messages` table from an earlier, abandoned attempt at this same
-- feature already existed with a `message`/`sent_at` shape instead of
-- `body`/`created_at`. It was empty and nothing in the codebase referenced
-- those columns, so drop them rather than carry two parallel body columns.
ALTER TABLE public.match_messages DROP COLUMN IF EXISTS message;
ALTER TABLE public.match_messages DROP COLUMN IF EXISTS sent_at;

ALTER TABLE public.match_messages ALTER COLUMN match_id SET NOT NULL;
ALTER TABLE public.match_messages ALTER COLUMN sender_id SET NOT NULL;
ALTER TABLE public.match_messages ALTER COLUMN body SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_match_messages_match_id ON public.match_messages(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_match_messages_sender ON public.match_messages(sender_id);

ALTER TABLE public.match_messages ENABLE ROW LEVEL SECURITY;

COMMIT;
