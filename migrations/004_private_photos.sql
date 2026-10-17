-- Make user profile photos private.
--
-- Photos used to be served with public URLs, so anyone with (or guessing) a URL
-- could view them. The backend now stores the storage object path
-- ("<userId>/<file>") in user_photos.image_url and returns 1-hour signed URLs.
-- Existing rows holding legacy public URLs keep working: the backend extracts
-- the object path from them when signing.
--
-- IMPORTANT: the bucket id 'user-photos' below MUST match the backend's
-- SUPABASE_USER_PHOTOS_BUCKET (default "user-photos"). If you use a different
-- bucket name, edit every 'user-photos' literal in this file before running it.
--
-- Ads: ad images are shown to everyone and must stay public. They now go to a
-- separate public bucket, SUPABASE_ADS_BUCKET (default "ad-images"), created
-- below. Previously SUPABASE_ADS_BUCKET was often set to "user-photos", so ad
-- images uploaded before this change live under 'user-photos/ads/...' and their
-- public URLs stop working once that bucket is private. This migration refuses
-- to run while such objects exist: move them to the ads bucket first (e.g.
-- supabase-js storage.from('user-photos').move(name, name,
-- { destinationBucket: 'ad-images' }) or re-upload via the dashboard) and update
-- public.ads.image_url to the new public URLs. Also set SUPABASE_ADS_BUCKET to
-- the ads bucket in the backend environment; the backend refuses ad uploads
-- when it equals SUPABASE_USER_PHOTOS_BUCKET.
--
-- Safe to re-run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'user-photos' AND name LIKE 'ads/%'
  ) THEN
    RAISE EXCEPTION
      'Ad images still live in bucket user-photos (ads/...). Move them to the public ads bucket before making user-photos private.';
  END IF;
END $$;

-- Public bucket for ad images (id must match SUPABASE_ADS_BUCKET).
INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-images', 'ad-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Private user photos bucket (id must match SUPABASE_USER_PHOTOS_BUCKET).
UPDATE storage.buckets SET public = false
WHERE id = 'user-photos' AND public IS DISTINCT FROM false;

-- Optional check: photo rows the backend cannot sign (not a path or URL inside
-- the owner's own folder of the user-photos bucket). GET /me/profile and
-- GET /matches/current return 500 for users with such rows, so review and
-- delete/fix any results:
--
--   SELECT id, user_id, image_url FROM public.user_photos
--   WHERE NOT (
--     image_url LIKE user_id::text || '/%'
--     OR image_url LIKE '%/storage/v1/object/public/user-photos/' || user_id::text || '/%'
--   );
