-- ============================================================
-- Chart-IX 数据库迁移 #036: 修复推送定时任务（可选，但建议执行）
-- ============================================================
-- 现状核查（2026-08-07）：线上库里 telegram_push_log 只有 manual 触发记录，
-- cron_heartbeats 表不存在——说明 026 的心跳表和 028 的 pg_cron 注册
-- 从未在线上执行过。「Telegram 一直不会自动推送」的根因就在这里：
-- 根本没有调度器在打 /api/cron/telegram-push。
--
-- 应用层现在已经由 GitHub Actions 每 10 分钟匿名 tick 一次兜底
-- （.github/workflows/cron-tick.yml + src/lib/cron-auth.ts 的限流放行），
-- 所以这份 SQL 不执行推送也能工作。执行它有两个额外好处：
--   1. pg_cron 每分钟扫价格提醒（GitHub Actions 只能做到 ~10 分钟一次）；
--   2. cron_heartbeats 表落地后，心跳写入不再静默失败。
--
-- 使用方法：Supabase 控制台 → SQL Editor，把 <CRON_SECRET> 替换为
-- Vercel 环境变量 CRON_SECRET 的值（Vercel 控制台可见）后整段执行。
-- 前置：Database → Extensions 里启用 pg_cron 与 pg_net。

-- ── 1. 心跳表（026 里定义过，但线上从未执行） ─────────────
CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job_name    TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status TEXT NOT NULL DEFAULT 'ok'
);

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "heartbeats readable by authenticated" ON public.cron_heartbeats;
CREATE POLICY "heartbeats readable by authenticated"
  ON public.cron_heartbeats FOR SELECT
  TO authenticated
  USING (true);

-- ── 2. 重新注册 pg_cron 任务 ─────────────────────────────
-- 与 028 的差异：
--   a. URL 已替换为真实站点，不再是占位符；
--   b. telegram tick 从每 4 小时改为每 10 分钟——实际推送间隔由应用层
--      isPushDue 按后台配置门控，高频 tick 只是让漏掉的一轮能尽快补上；
--   c. http_get 显式给 55s 超时（pg_net 默认 5s，冷缓存时筛选器一轮
--      要几十秒，5s 会把请求掐断并在 job_run_details 里记为失败）。

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('price-alerts-sweep', 'telegram-screener-push');

SELECT cron.schedule(
  'price-alerts-sweep',
  '* * * * *',
  $$
  SELECT net.http_get(
    url     := 'https://chart-ix.vercel.app/api/cron/price-alerts',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

SELECT cron.schedule(
  'telegram-screener-push',
  '*/10 * * * *',
  $$
  SELECT net.http_get(
    url     := 'https://chart-ix.vercel.app/api/cron/telegram-push',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- 验证：
--   SELECT jobname, schedule FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
