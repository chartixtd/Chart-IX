-- ============================================================
-- Chart-IX 数据库迁移 #030: 社区帖子（发帖 / 评论 / 表情反应）
-- ============================================================
-- Pro 用户可以发帖、编辑自己的帖子；其他 Pro 用户可以评论（限速）、
-- 用固定的几个表情 react。所有内容对所有人（含未登录）公开可读，
-- 写操作在 RLS 层校验身份+等级。
--
-- 等级校验用子查询查 public.users.tier，而不是 auth.jwt() 里的
-- app_metadata.tier —— 009_sync_tier_role_to_jwt_claims.sql 的注释里
-- 明确写了那是"可选的性能优化"，不保证每个环境都跑过；直接查
-- public.users 才是任何环境下都成立的真源，跟 001_create_users.sql
-- 里 admin 判断用的写法（EXISTS 子查询）保持一致。

CREATE TABLE public.community_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.community_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.community_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL CHECK (emoji IN ('👍','❤️','🚀','🔥','😂')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id, emoji)
);

CREATE INDEX idx_community_comments_post ON public.community_comments(post_id);
CREATE INDEX idx_community_reactions_post ON public.community_reactions(post_id);

-- updated_at 自动更新（同 007_articles.sql 的写法）
CREATE OR REPLACE FUNCTION update_community_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION update_community_posts_updated_at();

-- RLS
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;

-- 所有人可读（含未登录）
CREATE POLICY "Public read community posts"
  ON public.community_posts FOR SELECT
  USING (true);

CREATE POLICY "Public read community comments"
  ON public.community_comments FOR SELECT
  USING (true);

CREATE POLICY "Public read community reactions"
  ON public.community_reactions FOR SELECT
  USING (true);

-- 发帖：本人 + Pro
CREATE POLICY "Pro users can create posts"
  ON public.community_posts FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND tier = 'pro')
  );

-- 改自己的帖子：不再重新校验等级，保留编辑权即使订阅之后到期
CREATE POLICY "Authors can update own posts"
  ON public.community_posts FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- 评论：本人 + Pro（限速在应用层用 checkRateLimit 做，RLS 管不了频率）
CREATE POLICY "Pro users can create comments"
  ON public.community_comments FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND tier = 'pro')
  );

-- react：本人 + Pro
CREATE POLICY "Pro users can react"
  ON public.community_reactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND tier = 'pro')
  );

-- 取消 react：只要是自己的就能删，不用再校验等级
CREATE POLICY "Users can remove own reaction"
  ON public.community_reactions FOR DELETE
  USING (auth.uid() = user_id);

-- 没有作者自己删帖子/评论的策略——按需求删帖删评论都走管理员的
-- service-role 接口（/api/admin/community/...），不下放给 RLS。

-- Feature flag（读取侧其实不需要，但跟其他内容模块的登记方式保持一致）
INSERT INTO public.feature_flags (feature_key, feature_group, display_name, description, free_enabled, pro_enabled) VALUES
  ('community', 'content', '{"zh-CN":"社区","en-US":"Community","ms-MY":"Komuniti"}', '{"zh-CN":"发帖、评论、表情互动","en-US":"Post, comment and react","ms-MY":"Hantar, komen dan bertindak balas"}', true, true)
ON CONFLICT (feature_key) DO NOTHING;
