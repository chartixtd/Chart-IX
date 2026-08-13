-- ============================================================
-- Chart-IX 数据库迁移 #046: Telegram 话题（Topic）投递 + 早报链接推送
-- ============================================================
-- 两件事，共用同一套目标表与投递机制：
--
-- 1) message_thread_id —— 论坛群（forum supergroup）里的话题 ID。Telegram 的
--    sendMessage 不带这个参数时，消息一律落在群的「General」话题里。想把榜单
--    发进「行情播报」这类专用话题，唯一的办法就是把话题 ID 一起传上去。
--    NULL = 不带该参数 = 发到 General，与本迁移之前的行为完全一致。
--
-- 2) push_screener / push_briefing —— 一个目标要收哪几种内容。原先「目标」
--    等价于「筛选榜单的收件人」，早报链接没有任何投递去处。与其再建一张表
--    （又要一套 token、语言、健康状态、投递日志），不如让同一个目标声明自己
--    订阅哪几种内容——于是「早报发到哪个话题」在后台就是勾一个框的事。
--    默认 push_screener=true / push_briefing=false：存量目标行为不变，早报
--    必须由管理员显式勾选才会开始推送，不会突然给现有频道多发一条。
--
-- 锁行为：全部是加列 / 换索引，不重写既有数据。ADD COLUMN 带非 volatile 默认值
-- 在 PG11+ 不重写表；telegram_push_targets 的行数是个位数。整段粘贴执行时
-- Postgres 视作隐式单一事务，任一句失败会整体回滚。

-- ── 1. 目标：话题 ID 与内容订阅 ──────────────────────────
ALTER TABLE public.telegram_push_targets
  -- 话题 ID 恒为正整数（Telegram 用创建话题那条消息的 message_id 当话题 ID）。
  -- 0 不是合法话题，下面的唯一索引把它当作「无话题」的哨兵值。
  ADD COLUMN IF NOT EXISTS message_thread_id INTEGER
    CHECK (message_thread_id IS NULL OR message_thread_id > 0),
  ADD COLUMN IF NOT EXISTS push_screener BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_briefing BOOLEAN NOT NULL DEFAULT false;

-- 唯一性从「一个 chat」放宽到「一个 chat 的一个话题」。
-- 旧索引必须换掉：同一个群的两个话题（榜单一个、早报一个）是完全正常的配置，
-- 而 035 建的 chat_id 唯一索引会把第二个话题直接拒掉。
-- 用 COALESCE(...,0) 而不是 NULLS NOT DISTINCT：后者是 PG15+ 才有的语法,
-- 而表达式索引在所有版本上语义一致——两条都不带话题的同 chat 记录仍会冲突,
-- 那正是 035 当初要防的重复投递。
DROP INDEX IF EXISTS public.telegram_push_targets_chat_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS telegram_push_targets_chat_thread_uniq
  ON public.telegram_push_targets(chat_id, COALESCE(message_thread_id, 0));

-- 早报推送每天只发一次，走的是「按内容类型筛目标」这条路径。
-- 榜单那条路径（enabled + sort_order）已有索引，这里补早报的。
CREATE INDEX IF NOT EXISTS telegram_push_targets_briefing_idx
  ON public.telegram_push_targets(enabled, sort_order)
  WHERE enabled = true AND push_briefing = true;

-- ── 2. 投递日志：记下话题与内容类型 ──────────────────────
-- 只记 chat_id 的话，同一个群的两个话题在日志里长得一模一样，
-- 「哪个话题发失败了」就只能靠猜。
ALTER TABLE public.telegram_push_log
  ADD COLUMN IF NOT EXISTS message_thread_id INTEGER;

-- trigger 列没有 CHECK 约束（见 035），新增的 'briefing' 值不需要改库结构。
COMMENT ON COLUMN public.telegram_push_log.trigger IS
  '''cron'' 定时榜单 | ''manual'' 后台立即推送 | ''test'' 测试消息 | ''briefing'' 每日早报链接';
