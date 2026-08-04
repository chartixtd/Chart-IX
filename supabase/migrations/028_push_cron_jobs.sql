-- 定时任务从 Vercel Cron 搬到 Supabase。
-- Vercel Hobby 的 cron 最小间隔是每天一次，超过就部署失败——
-- 每分钟巡检的价格提醒在那边根本跑不起来。
--
-- 前置：在 Supabase 控制台 Database → Extensions 启用 pg_cron 与 pg_net。
--
-- 执行前把下面两个占位符替换成真实值：
--   <SITE_URL>     例如 https://chart-ix.vercel.app
--   <CRON_SECRET>  与 Vercel 环境变量 CRON_SECRET 同值

SELECT cron.schedule(
  'price-alerts-sweep',
  '* * * * *',
  $$
  SELECT net.http_get(
    url     := '<SITE_URL>/api/cron/price-alerts',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'telegram-screener-push',
  '0 */4 * * *',
  $$
  SELECT net.http_get(
    url     := '<SITE_URL>/api/cron/telegram-push',
    headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb
  );
  $$
);

-- 查看已注册的任务： SELECT * FROM cron.job;
-- 查看最近执行结果： SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
