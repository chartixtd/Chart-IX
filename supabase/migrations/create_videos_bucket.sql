-- Create videos storage bucket (public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('videos', 'videos', true, 2147483648, '{video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska}')
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2147483648,
  allowed_mime_types = '{video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska}';

-- Allow public read access to videos
DROP POLICY IF EXISTS "Public read videos" ON storage.objects;
CREATE POLICY "Public read videos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'videos');

-- Allow authenticated users with admin role to upload
DROP POLICY IF EXISTS "Admin upload videos" ON storage.objects;
CREATE POLICY "Admin upload videos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'videos');
