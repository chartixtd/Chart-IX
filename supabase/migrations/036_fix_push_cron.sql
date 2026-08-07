-- ============================================================
-- Chart-IX 数据库迁移 #036: 补上从未存在的推送调度器
-- ============================================================
-- 线上核查（2026-08-07）：
--   telegram_push_log 里只有 manual/test 记录，没有一条 cron；
--   cron_heartbeats 表不存在（026 从未执行）；
--   cron.job 里没有任何任务（028 是带 <SITE_URL> 占位符的模板，从未执行）。
--
-- 结论：Telegram「自动推送」从未运行过。推送链路本身是好的——手动
-- 「立即推送」一直能成——缺的只是有人按时来敲 /api/cron/telegram-push。
--
-- 应用层已不再要求 cron 带密钥：匿名 tick 走共享限流桶放行
-- （src/lib/cron-auth.ts），是否真的发送仍由 isPushDue 按后台配置的
-- 间隔门控。所以下面的 SQL 不含任何密钥占位符，可直接整段执行。
--
-- ── 0. 扩展 ──────────────────────────────────────────────
-- 不先启用的话，下面引用 cron.job 会直接报
--   ERROR: 42P01: relation "cron.job" does not exist
-- 因为 cron schema 是 pg_cron 装上时才创建的。
-- 建议单独先跑这两句确认成功，再跑后面的部分；报权限错就改用
-- 控制台 Database → Extensions 里的开关。
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 确认：SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');

-- ── 1. 心跳表（026 里定义过，但线上从未建出来） ───────────
-- cron 路由每次运行都会 upsert 这张表；表不存在时写入静默失败，
-- 于是「任务没在跑」和「任务跑了但没到间隔」在后台看起来一模一样。
-- src/app/api/user/notification-prefs/route.ts 也读它给用户看。
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

-- ── 2. 注册 Telegram 推送的定时 tick ─────────────────────
-- 与 028 的差异：URL 是真实站点（不再是占位符）；间隔从 4 小时改为
-- 10 分钟——真正的推送间隔由应用层 isPushDue 按后台配置门控，高频
-- tick 只是让漏掉的一轮能在 10 分钟内补上，而不是等满一个完整间隔；
-- 显式 55s 超时——pg_net 默认 5s，冷缓存时筛选器一轮要几十秒，
-- 5s 会把请求掐断并在 job_run_details 里记成失败。
--
-- 注意：price-alerts 任务刻意不注册。它依赖的 price_alerts /
-- push_subscriptions 表来自 026，线上同样不存在，现在挂上去只会每分钟
-- 报一次错、白烧 Vercel 配额。先跑下面第 3 段建表，再回来注册它。

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('telegram-screener-push', 'price-alerts-sweep');

SELECT cron.schedule(
  'telegram-screener-push',
  '*/10 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://chart-ix.vercel.app/api/cron/telegram-push',
    timeout_milliseconds := 55000
  );
  $$
);

-- 验证：
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   SELECT * FROM public.telegram_push_log ORDER BY created_at DESC LIMIT 10;
--   SELECT * FROM public.cron_heartbeats;
