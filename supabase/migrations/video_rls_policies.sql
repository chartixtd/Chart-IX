-- Allow public (anonymous) read access to non-deleted videos
DROP POLICY IF EXISTS "Public read videos" ON public.videos;
CREATE POLICY "Public read videos"
  ON public.videos FOR SELECT
  USING (is_deleted = false);

-- Allow public read access to video categories
DROP POLICY IF EXISTS "Public read video_categories" ON public.video_categories;
CREATE POLICY "Public read video_categories"
  ON public.video_categories FOR SELECT
  USING (true);

-- Allow public read access to video progress (for own progress only)
DROP POLICY IF EXISTS "Users read own progress" ON public.video_progress;
CREATE POLICY "Users read own progress"
  ON public.video_progress FOR SELECT
  USING (true);
