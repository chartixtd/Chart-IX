-- ============================================================
-- Chart-IX 数据库迁移 #033: 社区/文章索引补齐 + 帖子统计 RPC
-- ============================================================
-- 三处独立但都很小的优化，合并成一个迁移文件：
--
-- 1) community_posts 缺 created_at 索引，而 feed 的主查询正是
--    ORDER BY created_at DESC + range() 分页（见 src/app/api/community/posts/route.ts）——
--    帖子多起来之后这条查询会退化成全表扫描再排序。
--
-- 2) articles 的列表查询是 WHERE is_published = true ORDER BY published_at DESC
--    （见 src/app/[locale]/articles/page.tsx），复合索引让这条查询直接走索引
--    有序扫描，不用额外排序步骤。
--
-- 3) 帖子的评论数/表情统计原先整表拉回 community_comments / community_reactions
--    的行到 Node 里用 for 循环累加（当时评论数据固然已经按 postIds 限定了范围，
--    但用户越多、单帖互动越热，这个行数就越大，且不该用应用层循环做本该由
--    数据库做的聚合）。这里加一个 RPC，一次查询在 SQL 侧用 GROUP BY 算完
--    评论数与按表情分组的反应数，返回给 API 路由直接拼装。

CREATE INDEX IF NOT EXISTS idx_community_posts_created_at
  ON public.community_posts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_articles_published_listing
  ON public.articles(is_published, published_at DESC)
  WHERE is_published = true;

CREATE OR REPLACE FUNCTION public.get_community_post_stats(p_post_ids UUID[])
RETURNS TABLE (
  post_id UUID,
  comment_count BIGINT,
  reaction_counts JSONB
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ids.id AS post_id,
    COALESCE(c.cnt, 0) AS comment_count,
    COALESCE(r.counts, '{}'::jsonb) AS reaction_counts
  FROM unnest(p_post_ids) AS ids(id)
  LEFT JOIN (
    SELECT post_id, COUNT(*) AS cnt
    FROM public.community_comments
    WHERE post_id = ANY(p_post_ids)
    GROUP BY post_id
  ) c ON c.post_id = ids.id
  LEFT JOIN (
    SELECT post_id, jsonb_object_agg(emoji, emoji_count) AS counts
    FROM (
      SELECT post_id, emoji, COUNT(*) AS emoji_count
      FROM public.community_reactions
      WHERE post_id = ANY(p_post_ids)
      GROUP BY post_id, emoji
    ) grouped
    GROUP BY post_id
  ) r ON r.post_id = ids.id;
$$;

-- SECURITY INVOKER (默认)：调用方仍受 community_comments/community_reactions
-- 的 "Public read" RLS 约束（USING (true)），这里聚合的本就是公开可读数据，
-- 不需要提权。
