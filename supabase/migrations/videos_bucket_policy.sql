-- Allow authenticated users to upload to videos bucket
DROP POLICY IF EXISTS "Auth users upload videos" ON storage.objects;
CREATE POLICY "Auth users upload videos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'videos');
