-- ============================================================
-- Chart-IX 数据库迁移 #035: Telegram 推送多目标 + 可配间隔 + 投递日志
-- ============================================================
-- 背景：推送偶尔"卡断后就再也不推了"。根因在应用层（发送无超时、无重试、
-- 一次失败即丢），但也缺一套能让失败可见、可自愈的存储结构：
--
-- 1) telegram_push_targets —— 多个推送目标（频道/群/私聊）。原先只有
--    settings 表上的单个 chat_id，加一个目标就得改配置、且一个目标发不出去
--    整轮就失败。每个目标独立开关、独立语言、独立健康状态，互不牵连。
--
-- 2) settings.push_interval_minutes —— 推送间隔搬到数据库。原先间隔写死在
--    pg_cron 的 '0 */4 * * *' 里，admin 想改就得进 SQL 改 cron。改成
--    「cron 高频触发 + 应用层按间隔门控」之后，admin 在后台就能调，
--    而且漏掉的一轮会在下一次 tick 自动补上（这就是后备机制的核心）。
--
-- 3) telegram_push_log —— 每次投递的结果。原先只有 last_pushed_at 一个
--    时间戳，失败时它根本不动，admin 看到的只是「时间停在那儿」，
--    无从判断是没触发、发失败、还是没到间隔。
--
-- 锁行为：三段都是新建表 / 加列，不重写既有数据。ALTER TABLE ADD COLUMN
-- 带非 volatile 默认值在 PG11+ 不重写表，telegram_push_settings 本身也只有
-- 一行。整段粘贴执行时 Postgres 视作隐式单一事务，任一句失败会整体回滚。

-- ── 1. 推送目标 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_push_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- admin 自己看的名字，例如「主频道」「内部测试群」
  label         TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  -- 该目标专用的 bot token；NULL 表示沿用 settings 上的全局 token。
  -- 与 settings.bot_token_encrypted 同样加密存储（见 src/lib/crypto.ts）。
  bot_token_encrypted TEXT,
  -- NULL 表示继承 settings.message_lang
  message_lang  TEXT CHECK (message_lang IN ('en', 'zh')),
  enabled       BOOLEAN NOT NULL DEFAULT true,

  -- 健康状态：让「这个目标已经连续发不出去了」在后台一眼可见，
  -- 而不是整体静默。连续失败次数由应用层在每次投递后写入。
  last_ok_at            TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,

  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同一个 chat 不该被登记两次，否则一轮推送会给它发两条
CREATE UNIQUE INDEX IF NOT EXISTS telegram_push_targets_chat_uniq
  ON public.telegram_push_targets(chat_id);

CREATE INDEX IF NOT EXISTS telegram_push_targets_enabled_idx
  ON public.telegram_push_targets(enabled, sort_order)
  WHERE enabled = true;

ALTER TABLE public.telegram_push_targets ENABLE ROW LEVEL SECURITY;
-- 不建任何策略：与 telegram_push_settings 同样，只允许 service-role
-- （admin API 路由 + cron 路由）读写，因为这里存着 bot token。

-- ── 2. settings: 间隔与失败可见性 ────────────────────────
ALTER TABLE public.telegram_push_settings
  -- 240 = 维持原先的 4 小时；下限 15 分钟，防止把 Telegram 打到限流
  ADD COLUMN IF NOT EXISTS push_interval_minutes INTEGER NOT NULL DEFAULT 240
    CHECK (push_interval_minutes BETWEEN 15 AND 10080),
  -- 与 last_pushed_at 分开：last_pushed_at 只在「至少一个目标发成功」时更新，
  -- last_attempt_at 每次真正尝试都更新。两者拉开距离 = 正在持续失败。
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

-- ── 3. 投递日志 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_push_log (
  id           BIGSERIAL PRIMARY KEY,
  -- 目标被删掉后日志仍要留着，所以 SET NULL 且把名字冗余存一份
  target_id    UUID REFERENCES public.telegram_push_targets(id) ON DELETE SET NULL,
  target_label TEXT,
  chat_id      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  error        TEXT,
  -- 重试了几次才成功/最终失败——用来区分「一次就过」和「勉强撑住」
  attempts     INTEGER NOT NULL DEFAULT 1,
  duration_ms  INTEGER,
  -- 'cron' | 'manual' | 'test'，便于区分自动推送与后台手点
  trigger      TEXT NOT NULL DEFAULT 'cron',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_push_log_recent_idx
  ON public.telegram_push_log(created_at DESC);

ALTER TABLE public.telegram_push_log ENABLE ROW LEVEL SECURITY;
-- 同上，仅 service-role 可读写。

-- ── 4. 回填：把现有的单个 chat_id 变成第一个目标 ─────────
-- 不做这一步的话，迁移一跑，原本配好的推送目标就消失了。
INSERT INTO public.telegram_push_targets (label, chat_id, message_lang, enabled, sort_order)
SELECT
  'Default',
  s.chat_id,
  NULL,            -- 继承 settings.message_lang，保持行为不变
  s.enabled,
  0
FROM public.telegram_push_settings s
WHERE s.id = 1
  AND s.chat_id IS NOT NULL
  AND btrim(s.chat_id) <> ''
ON CONFLICT (chat_id) DO NOTHING;

-- settings.chat_id 刻意保留不删：回滚时还能用，且应用层已不再读它。
-- 确认新结构稳定后可以再单独发一个迁移去掉。

-- ── 5. 失败计数用的原子自增 ──────────────────────────────
-- 应用层如果用「先读再加再写」，两轮重叠执行会读到同一个值、各自写回同一个
-- +1，连续失败数就永远追不上真实次数。放进 SQL 让 Postgres 自己算。

CREATE OR REPLACE FUNCTION public.increment_telegram_target_failure(
  p_target_id UUID,
  p_error     TEXT
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.telegram_push_targets
  SET consecutive_failures = consecutive_failures + 1,
      last_error_at = NOW(),
      last_error = p_error
  WHERE id = p_target_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_telegram_settings_failure(
  p_error TEXT
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.telegram_push_settings
  SET consecutive_failures = consecutive_failures + 1,
      last_error = p_error
  WHERE id = 1;
$$;

-- 这两个函数只被 service-role 调用（cron 路由与 admin 路由），
-- 两张表本身也没有面向 anon/authenticated 的 RLS 策略。
REVOKE ALL ON FUNCTION public.increment_telegram_target_failure(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_telegram_settings_failure(TEXT) FROM PUBLIC, anon, authenticated;
