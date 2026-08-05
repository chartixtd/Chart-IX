-- ============================================================
-- Chart-IX 数据库迁移 #032: 社区帖子支持封面图
-- ============================================================
-- 帖子要能像管理员发的文章一样带图、能点开看全文，这里补一个可选的
-- 封面图字段。上传本身走应用层新的 /api/community/upload（Pro 用户
-- 专用的 Storage bucket，跟 articles 那个管理员专用 bucket 分开，
-- 避免普通 Pro 用户的上传权限跟管理员的 articles 素材库混在一起）。

ALTER TABLE public.community_posts
  ADD COLUMN cover_image TEXT;
