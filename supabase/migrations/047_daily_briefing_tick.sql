-- ============================================================
-- Chart-IX 数据库迁移 #047: 给早报流水线补上高频 tick
-- ============================================================
-- 背景：早报流水线一天只被触发一次（vercel.json 的 `0 1 * * *`）。于是那一次
-- 调用的结果就是当天的最终结果——被平台掐断、DeepSeek 全挂、只出得了兜底稿、
-- 或者链接投递失败，全都没有第二次机会。线上已经真发生过一次：生成偏慢，
-- Telegram 投递被预算门槛跳过，文章发了、链接没发，只能人工补。
--
-- 榜单推送早就没有这个毛病——036 给它注册了 10 分钟一次的 tick，"漏掉的一轮
-- 由下一轮补上"。这里把同一条原则搬给早报。
--
-- 高频 tick 安全的保证全在**应用层**，不在这个 schedule 上：
--   · 发布时间窗（UTC+8 08:00–11:59）：窗口外的 tick 全部 idle 早退，
--     一天 130+ 次，每次只算一个小时数，不查库不调模型。
--   · 幂等闸门 + articles.slug 唯一约束：窗口内打多少次都只出一篇。
--   · 升级次数上限（src/lib/briefing/publish-state.ts，当前 3 次）：
--     兜底稿最多重新生成 3 次，糟糕的一天最多额外 9 次模型调用，不会失控。
-- 这三道闸门都在流水线里而不是触发器里，所以以后换触发器也不会破。
--
-- 锁行为：只动 cron.job，不碰任何业务表。

-- ── 1. 注册早报 tick ─────────────────────────────────────
-- 先 unschedule 再 schedule，这样这段 SQL 可以重复执行（改 URL 时直接重跑）。
-- 用 DO 块是因为 cron.unschedule(name) 在任务不存在时会抛错，而不是静默返回。
DO $$
BEGIN
  PERFORM cron.unschedule('daily-briefing-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- 任务本来就不存在，正是首次执行时的正常情况
END $$;

SELECT cron.schedule(
  'daily-briefing-tick',
  '*/10 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://chart-ix.com/api/cron/daily-briefing',
    -- 与 036 同样显式给 55 秒：pg_net 默认 5 秒，而这条流水线的墙钟预算
    -- 就有 48 秒。5 秒会把请求掐断，并在 job_run_details 里记成失败——
    -- 而 Vercel 那边其实已经开始跑了，于是"看起来全失败、实际在出稿"。
    timeout_milliseconds := 55000
  );
  $$
);

-- ── 2. 把榜单推送的 tick 指向新域名 ──────────────────────
-- 036 注册时写的是 https://chart-ix.vercel.app。站点已经绑定 chart-ix.com，
-- 而 Vercel 把自定义域设为主域名之后，*.vercel.app 会 301 跳转——pg_net
-- 是否跟随重定向不在我们的控制之内。让它继续指着一个随时可能开始跳转的
-- 地址，等于给"推送某天突然全停"埋一颗雷，而这类静默失效正是 036 当初
-- 花了一整个迁移去修的东西。
DO $$
BEGIN
  PERFORM cron.unschedule('telegram-screener-push');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'telegram-screener-push',
  '*/10 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://chart-ix.com/api/cron/telegram-push',
    timeout_milliseconds := 55000
  );
  $$
);

-- 验证：
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT jobname, status, start_time FROM cron.job_run_details
--     ORDER BY start_time DESC LIMIT 20;
--   SELECT key, value FROM public.admin_settings
--     WHERE key IN ('daily_briefing_publish_state', 'daily_briefing_telegram_delivery');
