-- Canonical Minglee schema and upgrade path for existing Supabase databases.
-- Run this file instead of the deprecated per-feature schema snippets.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  whatsapp_number VARCHAR(50),
  password_hash VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  ready_to_be_matched BOOLEAN NOT NULL DEFAULT TRUE,
  is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(50);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ready_to_be_matched BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS flag_reason TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.weekly_active_users (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_active_users_week_start
  ON public.weekly_active_users(week_start);

ALTER TABLE public.weekly_active_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'full_name'
  ) THEN
    UPDATE public.users
    SET name = COALESCE(NULLIF(BTRIM(name), ''), full_name)
    WHERE full_name IS NOT NULL AND (name IS NULL OR BTRIM(name) = '');
  END IF;
END;
$$;

ALTER TABLE public.users DROP COLUMN IF EXISTS email;
ALTER TABLE public.users DROP COLUMN IF EXISTS full_name;

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  event_picture TEXT NOT NULL,
  event_day DATE NOT NULL,
  ticket_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS ticket_price NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_description TEXT DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS ticket_type TEXT DEFAULT 'Regular';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS location TEXT DEFAULT 'Campus';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL DEFAULT 'event_ticket',
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending',
  gateway TEXT NOT NULL DEFAULT 'paystack',
  gateway_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  flw_transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'event_ticket';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS flw_transaction_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.payments ALTER COLUMN event_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass AND conname = 'payments_payment_type_check'
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check
      CHECK (payment_type IN ('event_ticket', 'ad_promotion'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payments_reference ON public.payments(reference);
CREATE INDEX IF NOT EXISTS idx_payments_event_status ON public.payments(event_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_user_event ON public.payments(user_id, event_id);

CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'valid',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tickets ALTER COLUMN payment_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_user_event ON public.tickets(user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_code ON public.tickets(ticket_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_payment_unique
  ON public.tickets(payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_free_rsvp_unique
  ON public.tickets(event_id, user_id) WHERE payment_id IS NULL;

-- Preserve legacy attendee registrations as free tickets before replacing the table.
DROP VIEW IF EXISTS public.v_event_financial_summary;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'event_attendees' AND c.relkind IN ('r', 'p')
  ) THEN
    INSERT INTO public.tickets (user_id, event_id, ticket_code, status, issued_at)
    SELECT attendee_user.id, attendee_event.id,
           'RSVP-' || upper(replace(gen_random_uuid()::text, '-', '')),
           'valid', attendee.created_at
    FROM public.event_attendees AS attendee
    JOIN public.users AS attendee_user
      ON attendee_user.id::text = attendee.user_id::text
    JOIN public.events AS attendee_event
      ON attendee_event.id::text = attendee.event_id::text
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tickets AS ticket
      WHERE ticket.user_id = attendee_user.id
        AND ticket.event_id = attendee_event.id
        AND ticket.status = 'valid'
    );

    DROP TABLE public.event_attendees;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.v_event_attendees AS
SELECT DISTINCT event_id, user_id, issued_at AS created_at
FROM public.tickets
WHERE status = 'valid';

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Notification',
  type TEXT NOT NULL DEFAULT 'notification',
  category TEXT NOT NULL DEFAULT 'info',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type_dismissed
  ON public.notifications(user_id, type, is_dismissed, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_ad_user
  ON public.notifications ((metadata->>'ad_id'), user_id)
  WHERE category = 'advertisement' AND metadata ? 'ad_id';

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time TIMESTAMPTZ,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'push_subscriptions' AND policyname = 'Users can manage their own push subscriptions'
  ) THEN
    CREATE POLICY "Users can manage their own push subscriptions"
      ON public.push_subscriptions
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  payment_id UUID UNIQUE,
  ad_type VARCHAR(50) NOT NULL DEFAULT 'banner',
  title VARCHAR(255),
  text_content TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  target_url TEXT,
  popup_id UUID REFERENCES public.ads(id) ON DELETE SET NULL,
  scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.users(id),
  reviewed_at TIMESTAMPTZ,
  impressions INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  placement TEXT,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_ad_dates CHECK (end_time > start_time),
  CONSTRAINT chk_min_24h_duration CHECK (
    ad_type = 'banner' OR end_time >= start_time + INTERVAL '24 hours'
  ),
  CONSTRAINT chk_notification_has_popup CHECK (
    ad_type <> 'notification' OR popup_id IS NOT NULL
  ),
  CONSTRAINT chk_media_required CHECK (
    ad_type = 'notification' OR (image_url IS NOT NULL AND length(trim(image_url)) > 0)
  ),
  CONSTRAINT chk_ad_type CHECK (ad_type IN ('banner', 'notification', 'popup', 'ticket_boost')),
  CONSTRAINT chk_ad_status CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS ad_type VARCHAR(50) NOT NULL DEFAULT 'banner';
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS text_content TEXT NOT NULL DEFAULT '';
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS target_url TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS popup_id UUID REFERENCES public.ads(id) ON DELETE SET NULL;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending';
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS impressions INT NOT NULL DEFAULT 0;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS clicks INT NOT NULL DEFAULT 0;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS placement TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ads'::regclass AND conname = 'chk_ad_type'
  ) THEN
    ALTER TABLE public.ads DROP CONSTRAINT chk_ad_type;
  END IF;
  ALTER TABLE public.ads ADD CONSTRAINT chk_ad_type
    CHECK (ad_type IN ('banner', 'notification', 'popup', 'ticket_boost'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ads'::regclass AND conname = 'chk_ad_status'
  ) THEN
    ALTER TABLE public.ads ADD CONSTRAINT chk_ad_status
      CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));
  END IF;
END;
$$;

-- Move ad-payment records into the shared ledger, preserving IDs referenced by ads.
DO $$
DECLARE
  payment_constraint RECORD;
BEGIN
  IF to_regclass('public.ad_payments') IS NOT NULL THEN
    INSERT INTO public.payments (
      id, reference, user_id, payment_type, event_id, amount, currency,
      status, gateway, gateway_response, metadata, flw_transaction_id, created_at, updated_at
    )
    SELECT id, payment_reference, user_id, 'ad_promotion', NULL, amount, currency,
           CASE status WHEN 'successful' THEN 'success' ELSE status END,
           'flutterwave',
           jsonb_build_object('flw_transaction_id', flw_transaction_id),
           jsonb_build_object('ad_type', ad_type),
           flw_transaction_id, created_at, created_at
    FROM public.ad_payments
    ON CONFLICT (id) DO NOTHING;

    FOR payment_constraint IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.ads'::regclass AND contype = 'f'
        AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.ads'::regclass AND attname = 'payment_id')]
    LOOP
      EXECUTE format('ALTER TABLE public.ads DROP CONSTRAINT %I', payment_constraint.conname);
    END LOOP;

    ALTER TABLE public.ads ADD CONSTRAINT ads_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;
    DROP TABLE public.ad_payments;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ads'::regclass AND conname = 'ads_payment_id_fkey'
  ) THEN
    ALTER TABLE public.ads ADD CONSTRAINT ads_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_payment_unique ON public.ads(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ads_schedule_type_status ON public.ads(scheduled_date, ad_type, status);
CREATE INDEX IF NOT EXISTS idx_ads_user_id ON public.ads(user_id);
CREATE INDEX IF NOT EXISTS idx_ads_status ON public.ads(status);
CREATE INDEX IF NOT EXISTS idx_ads_active_placement_dates ON public.ads(is_active, placement, start_date, end_date);

CREATE OR REPLACE FUNCTION check_ad_daily_limits()
RETURNS TRIGGER AS $$
DECLARE
  approved_count INT;
  max_allowed INT;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.ad_type IN ('banner', 'ticket_boost') THEN
      max_allowed := 3;
    ELSIF NEW.ad_type IN ('notification', 'popup') THEN
      max_allowed := 1;
    ELSE
      RAISE EXCEPTION 'Invalid ad type: %', NEW.ad_type;
    END IF;

    SELECT COUNT(*) INTO approved_count
    FROM public.ads
    WHERE scheduled_date = NEW.scheduled_date
      AND ad_type = NEW.ad_type
      AND status = 'approved'
      AND id IS DISTINCT FROM NEW.id;

    IF approved_count >= max_allowed THEN
      RAISE EXCEPTION 'Daily limit reached for ad type % on date %', NEW.ad_type, NEW.scheduled_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_ad_daily_limits ON public.ads;
CREATE TRIGGER trg_check_ad_daily_limits
BEFORE INSERT OR UPDATE ON public.ads
FOR EACH ROW EXECUTE FUNCTION check_ad_daily_limits();

CREATE OR REPLACE FUNCTION publish_approved_notification_ad()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ad_type = 'notification' AND NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    INSERT INTO public.notifications (
      user_id, title, message, type, category, expires_at, metadata, action_url
    )
    SELECT users.id::text, COALESCE(NEW.title, 'Promotion'), NEW.text_content,
           'notification', 'advertisement', NEW.end_time,
           jsonb_build_object('ad_id', NEW.id, 'ad_type', NEW.ad_type), NEW.target_url
    FROM public.users AS users
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications AS notification
      WHERE notification.user_id = users.id::text
        AND notification.category = 'advertisement'
        AND notification.metadata->>'ad_id' = NEW.id::text
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_publish_approved_notification_ad ON public.ads;
CREATE TRIGGER trg_publish_approved_notification_ad
AFTER INSERT OR UPDATE ON public.ads
FOR EACH ROW EXECUTE FUNCTION publish_approved_notification_ad();

-- Publish already-approved ads too; the partial unique index makes this repeat-safe.
INSERT INTO public.notifications (
  user_id, title, message, type, category, expires_at, metadata, action_url
)
SELECT users.id::text, COALESCE(ads.title, 'Promotion'), ads.text_content,
       'notification', 'advertisement', ads.end_time,
       jsonb_build_object('ad_id', ads.id, 'ad_type', ads.ad_type), ads.target_url
FROM public.ads AS ads
CROSS JOIN public.users AS users
WHERE ads.ad_type = 'notification' AND ads.status = 'approved'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.v_event_financial_summary AS
WITH attendee_totals AS (
  SELECT event_id, COUNT(DISTINCT user_id) AS total_attendees
  FROM public.v_event_attendees
  GROUP BY event_id
), payment_totals AS (
  SELECT event_id,
         COUNT(DISTINCT user_id) AS paid_attendees_count,
         COALESCE(SUM(amount), 0) AS total_money_collected
  FROM public.payments
  WHERE payment_type = 'event_ticket' AND status = 'success'
  GROUP BY event_id
)
SELECT events.id AS event_id, events.event_name, events.event_day, events.ticket_price,
       COALESCE(attendee_totals.total_attendees, 0) AS total_attendees,
       COALESCE(payment_totals.paid_attendees_count, 0) AS paid_attendees_count,
       COALESCE(payment_totals.total_money_collected, 0) AS total_money_collected,
       COALESCE(payment_totals.total_money_collected, 0) AS host_payout_amount
FROM public.events AS events
LEFT JOIN attendee_totals ON attendee_totals.event_id = events.id
LEFT JOIN payment_totals ON payment_totals.event_id = events.id;