-- ============================================================
-- Chart-IX 数据库迁移 #002: 视频表 (分类、视频、进度)
-- ============================================================

-- 1. 视频分类
CREATE TABLE public.video_categories (
  id          SERIAL PRIMARY KEY,
  name        JSONB NOT NULL,  -- {"zh-CN":"标题", "en-US":"Title", "ms-MY":"Tajuk"}
  slug        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.video_categories IS '视频分类，支持多语言名称';

-- 2. 视频
CREATE TABLE public.videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             JSONB NOT NULL,
  description       JSONB,
  category_id       INTEGER REFERENCES public.video_categories(id) ON DELETE SET NULL,
  storage_url       TEXT NOT NULL,
  thumbnail_url     TEXT,
  duration_seconds  INTEGER NOT NULL DEFAULT 0,
  file_size_bytes   BIGINT,
  tier_required     TEXT NOT NULL DEFAULT 'free'
                    CHECK (tier_required IN ('free', 'pro')),
  view_count        INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,
  uploaded_by       UUID REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.videos IS '教学视频';
COMMENT ON COLUMN public.videos.title IS '多语言标题 (JSONB)';
COMMENT ON COLUMN public.videos.is_deleted IS '软删除标记';

-- 3. 观看进度
CREATE TABLE public.video_progress (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  video_id          UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  progress_seconds  REAL NOT NULL DEFAULT 0,
  completed         BOOLEAN NOT NULL DEFAULT false,
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, video_id)
);
COMMENT ON TABLE public.video_progress IS '用户视频观看进度';

-- 4. 自动完成触发器 (进度 >= 90% 时长)
CREATE OR REPLACE FUNCTION public.check_video_completion()
RETURNS TRIGGER AS $$
DECLARE
  video_duration INTEGER;
BEGIN
  SELECT duration_seconds INTO video_duration FROM public.videos WHERE id = NEW.video_id;
  IF video_duration > 0 AND NEW.progress_seconds >= video_duration * 0.9 THEN
    NEW.completed := true;
    NEW.completed_at := COALESCE(NEW.completed_at, NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_video_completion
  BEFORE INSERT OR UPDATE ON public.video_progress
  FOR EACH ROW EXECUTE FUNCTION public.check_video_completion();
