-- 023: 给 videos 表增加 language 列
-- 管理员上传时指定该视频属于哪个语言，前台只在对应语言的页面展示

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en-US'
  CHECK (language IN ('zh-CN', 'en-US', 'ms-MY'));

CREATE INDEX IF NOT EXISTS idx_videos_language ON videos(language);
