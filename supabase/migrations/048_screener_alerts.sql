-- ============================================================
-- Chart-IX 数据库迁移 #048: 扫描器警报表 + 15 分钟扫描 tick
-- ============================================================
-- 背景：screener 从「每小时算一次、只出两组 Top 10」改成「每 15 分钟扫一次
-- 整池、总分首次突破 80 分时触发警报并锁价追踪」。警报必须持久化——
-- 「首次突破」这个语义要求服务端记得上一轮的状态，浏览器内的会话状态
-- 一刷新就没了，等于每个用户看到的触发时刻都不一样。
--
-- 迟滞设计写在应用层（src/lib/screener/alerts.ts）而不是这里：触发线 80、
-- 关闭线 75、连续 3 次低于关闭线才关。below_count 这一列就是为它准备的。
-- 没有迟滞的话，一个在 80 分线上抖动的币会在几十分钟内反复开关警报、
-- 反复推送 Telegram。

-- ── 1. 警报表 ────────────────────────────────────────────
create table if not exists public.screener_alerts (
  id             uuid primary key default gen_random_uuid(),
  -- BingX 永续 symbol，如 TIA-USDT。下单链接直接用它。
  symbol         text not null,
  direction      text not null check (direction in ('long','short')),
  triggered_at   timestamptz not null default now(),
  -- 触发瞬间锁定的价格，之后永不修改。累计涨跌幅全部以它为基准。
  trigger_price  numeric not null,
  trigger_score  int not null,
  -- 触发当时的四因子分 {zone,sweep,oi,cvd}，用于事后复盘「当时凭什么触发」
  factors        jsonb not null,
  last_price     numeric,
  last_price_at  timestamptz,
  -- 触发以来顺方向的最大涨跌幅（做空下跌算正）
  peak_pct       numeric,
  -- 连续低于关闭线的扫描次数。回到关闭线之上就归零。
  below_count    int not null default 0,
  closed_at      timestamptz,
  pushed_at      timestamptz
);

-- 每轮扫描都要查「这个币有没有未平警报」，这是最热的查询路径。
-- 部分索引只覆盖未平的那些行——已关闭的警报会一直累积，
-- 让它们进索引纯属浪费。
create index if not exists screener_alerts_open_idx
  on public.screener_alerts (symbol)
  where closed_at is null;

-- 警报栏按触发时间倒序列出未平警报
create index if not exists screener_alerts_open_recent_idx
  on public.screener_alerts (triggered_at desc)
  where closed_at is null;

-- ── 2. RLS ───────────────────────────────────────────────
-- 警报是全站信息（不是 per-user 数据），所有人可读；写入只走 service role。
alter table public.screener_alerts enable row level security;

drop policy if exists screener_alerts_read on public.screener_alerts;
create policy screener_alerts_read
  on public.screener_alerts
  for select
  using (true);

-- 刻意不建任何 insert/update/delete 策略：service role 绕过 RLS，
-- 其余角色一律写不进来。多写一条「仅 service role」的策略是没有意义的
-- 冗余，反而会让人以为普通角色在某些条件下可以写。

-- ── 3. 扫描 tick ─────────────────────────────────────────
-- 5 分钟一打，应用层按 15 分钟门控（src/lib/screener/types.ts 的
-- SCAN_INTERVAL_MS）。频率高于间隔是刻意的：漏掉的一轮由下一轮补上，
-- 与 036/047 给推送和早报用的是同一条原则。
DO $$
BEGIN
  PERFORM cron.unschedule('screener-scan-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- 任务本来就不存在，正是首次执行时的正常情况
END $$;

SELECT cron.schedule(
  'screener-scan-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://chart-ix.com/api/cron/screener-scan',
    -- 与 036/047 一致显式给 55 秒：pg_net 默认 5 秒，而一轮完整扫描
    -- 的墙钟预算就有约 22 秒。5 秒会把请求掐断并记成失败，
    -- 而 Vercel 那边其实已经开始跑了。
    timeout_milliseconds := 55000
  );
  $$
);

-- 验证：
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT symbol, direction, trigger_score, triggered_at, closed_at
--     FROM public.screener_alerts ORDER BY triggered_at DESC LIMIT 20;
