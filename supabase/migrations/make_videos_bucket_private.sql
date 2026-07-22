-- Make videos bucket private to prevent direct URL downloads
UPDATE storage.buckets SET public = false WHERE id = 'videos';

-- Drop public read policy from storage.objects for videos bucket
DROP POLICY IF EXISTS "Public read videos" ON storage.objects;

-- Keep upload policy for admin users
-- (The "Auth users upload videos" policy from videos_bucket_policy.sql remains)
