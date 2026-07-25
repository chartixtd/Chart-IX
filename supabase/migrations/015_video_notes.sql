-- ============================================================
-- Chart-IX 数据库迁移 #015: 视频时间戳笔记
-- ============================================================
CREATE TABLE IF NOT EXISTS video_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_video_notes_user_video ON video_notes(user_id, video_id);

-- RLS
ALTER TABLE video_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own notes" ON video_notes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
