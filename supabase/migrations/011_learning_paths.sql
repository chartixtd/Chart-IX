-- ============================================================
-- Chart-IX 数据库迁移 #011: 学习路径 (Learning Paths)
-- ============================================================
-- v1 范围: 一条学习路径 = 一组有序的视频课程。"前置"就是"必须先完成
-- 上一步"（顺序即前置，不做通用的依赖图，避免过度设计）。
-- 总进度 = 已完成步骤数 / 总步骤数，直接用 video_progress.completed 算，
-- 不额外建进度表，避免两处状态不同步。

CREATE TABLE public.learning_paths (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         JSONB NOT NULL,        -- Record<Locale, string>
  description   JSONB,                 -- Record<Locale, string> | null
  cover_image   TEXT,
  level         TEXT NOT NULL DEFAULT 'beginner' CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.learning_paths IS '学习路径 (一组有序课程)';

CREATE TABLE public.learning_path_steps (
  id          SERIAL PRIMARY KEY,
  path_id     INTEGER NOT NULL REFERENCES public.learning_paths(id) ON DELETE CASCADE,
  video_id    UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (path_id, video_id)
);
COMMENT ON TABLE public.learning_path_steps IS '学习路径中的课程步骤，顺序即前置关系';
CREATE INDEX idx_learning_path_steps_path ON public.learning_path_steps(path_id, sort_order);

ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_path_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published learning paths"
  ON public.learning_paths FOR SELECT
  USING (is_published = true);
CREATE POLICY "Admins can manage learning paths"
  ON public.learning_paths FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Anyone can view steps of published paths"
  ON public.learning_path_steps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.learning_paths p
    WHERE p.id = learning_path_steps.path_id AND p.is_published = true
  ));
CREATE POLICY "Admins can manage learning path steps"
  ON public.learning_path_steps FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
