-- ============================================================
-- Chart-IX 数据库迁移 #034: 选币结果的跨实例持久缓存
-- ============================================================
-- src/lib/screener-server.ts 原先只有一层进程内 TTL 缓存：Vercel 上每个
-- serverless 实例各自维护一份，冷启动的实例完全没有历史结果，会重新跑一遍
-- 几百次上游请求的完整选币流水线（几十秒）。这张表让冷启动实例先看一眼
-- 别的实例算好的最新结果，够新鲜就直接用，只有全站都没有新鲜结果时才
-- 重新计算——具体读写逻辑在 screener-server.ts，这里只是存储。
--
-- 单行表（id 固定为 1），存储逻辑与 026 的 cron_heartbeats 心跳表同构。
-- 只通过 service-role 读写（screener-server.ts 用 createServiceRoleClient），
-- 不面向前端直接查询，所以不开放任何 anon/authenticated 的 RLS 策略。

CREATE TABLE public.screener_cache (
  id          SMALLINT PRIMARY KEY DEFAULT 1,
  payload     JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT screener_cache_single_row CHECK (id = 1)
);

ALTER TABLE public.screener_cache ENABLE ROW LEVEL SECURITY;
-- 没有任何策略：RLS 默认拒绝 anon/authenticated 的全部访问，
-- service-role 本身就绕过 RLS，不受影响。
