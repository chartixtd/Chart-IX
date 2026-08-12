-- 视频排序：后台拖拽调整顺序，前台跟随
--
-- videos.sort_order 从 002 建表起就存在，/videos 前台页与后台列表也一直
-- `.order("sort_order")`——但站内从来没有写入这一列的入口，所有行都停在
-- 默认值 0。同值排序在 Postgres 里没有稳定保证，所以"当前顺序"实际上是
-- 任意的，刷新甚至可能变。这条迁移补上写入侧，并给存量数据落一次稳定初值。

-- ── 1. 整批重排函数 ──────────────────────────────────────────
-- 用一条 UPDATE ... FROM unnest(...) WITH ORDINALITY，而不是循环逐行 update：
-- 排序是"整批一起才成立"的操作，中途失败留下半套顺序比不改更糟；而且逐行
-- 更新在 300 条上限下是 300 次往返。
CREATE OR REPLACE FUNCTION public.reorder_videos(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.videos AS v
  SET sort_order = t.ord,
      updated_at = NOW()
  FROM unnest(p_ids) WITH ORDINALITY AS t(id, ord)
  WHERE v.id = t.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.reorder_videos(uuid[]) IS
  '按传入 id 的顺序把 videos.sort_order 重写为 1..N，整批原子生效。';

-- 只经 service_role 调用（src/app/api/admin/videos/reorder/route.ts，
-- 路由前面有 requireAdmin() 把关）。任何前端角色都不该能直接重排视频。
-- 与 040 收紧其它 RPC 的做法一致。
REVOKE EXECUTE ON FUNCTION public.reorder_videos(uuid[]) FROM anon, authenticated;

-- ── 2. 存量数据落稳定初值 ────────────────────────────────────
-- 只动仍是 0 的行：如果这条迁移被重复执行，已经排好的顺序不会被冲掉。
--
-- 初值按 created_at **升序**（先上传的在前）。第一版写的是倒序，跑完发现
-- 得到的正好是后台列表原本顺序的倒序——存量视频是按"风控 → 仓位 → 趋势 →
-- 流动性 → 订单块 → FVG"这条教学递进依次上传的，倒过来等于把课程顺序打乱。
-- 排序功能的初值不该改变管理员已经看惯的顺序。
WITH seeded AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.videos
  WHERE sort_order = 0
)
UPDATE public.videos v
SET sort_order = seeded.rn
FROM seeded
WHERE v.id = seeded.id;

-- ── 3. 排序查询的覆盖索引 ────────────────────────────────────
-- 前台按 (is_deleted, language, sort_order) 取列表，这是唯一的热路径。
CREATE INDEX IF NOT EXISTS idx_videos_language_sort
  ON public.videos (language, sort_order)
  WHERE is_deleted = false;
