-- Web Push 订阅、价格提醒、通知偏好与 cron 心跳。
-- 价格提醒此前存在浏览器 localStorage 里（stores/priceAlerts.ts），
-- 页面关掉就不再触发——搬到服务端后由 cron 巡检，服务端成为唯一权威。

-- ── 推送订阅 ──────────────────────────────────────────────
-- 一台设备一行（endpoint 唯一），同一用户可以有手机 + 平板 + 桌面多行
CREATE TABLE public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  -- 通知在用户看不见页面时弹出，没法临时问客户端要语言，
  -- 所以订阅时就把语言存下来，服务端据此生成文案
  locale        TEXT NOT NULL DEFAULT 'en-US',
  user_agent    TEXT,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own subscriptions readable"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own subscriptions insertable"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own subscriptions deletable"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- ── 价格提醒 ──────────────────────────────────────────────
CREATE TABLE public.price_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  target_price  NUMERIC NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  triggered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 部分索引：巡检每分钟跑一次，只关心还没触发的提醒。
-- 绝大多数分钟里这个查询应该立刻返回空集。
CREATE INDEX price_alerts_pending_idx
  ON public.price_alerts (symbol)
  WHERE triggered_at IS NULL;

CREATE INDEX price_alerts_user_idx ON public.price_alerts (user_id);

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own alerts readable"
  ON public.price_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own alerts insertable"
  ON public.price_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own alerts deletable"
  ON public.price_alerts FOR DELETE
  USING (auth.uid() = user_id);

-- ── 通知偏好 ──────────────────────────────────────────────
CREATE TABLE public.notification_prefs (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  price_alerts  BOOLEAN NOT NULL DEFAULT true,
  -- 选币榜单默认关闭：一天 6 条不请自来的推送是权限杀手，让用户主动开
  screener      BOOLEAN NOT NULL DEFAULT false,
  new_content   BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own prefs readable"
  ON public.notification_prefs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own prefs upsertable"
  ON public.notification_prefs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own prefs updatable"
  ON public.notification_prefs FOR UPDATE
  USING (auth.uid() = user_id);

-- ── cron 心跳 ─────────────────────────────────────────────
-- Supabase Free 项目 7 天无活动会暂停。一旦停了，价格提醒不会报错，
-- 只是永远不触发——用户以为提醒开着，实际早死了。
-- 静默失效比报错糟糕得多，所以每次巡检都留个时间戳给用户看。
CREATE TABLE public.cron_heartbeats (
  job_name    TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status TEXT NOT NULL DEFAULT 'ok'
);

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

-- 心跳对所有登录用户可读——用户有权知道自己依赖的功能还活着没有
CREATE POLICY "heartbeats readable by authenticated"
  ON public.cron_heartbeats FOR SELECT
  TO authenticated
  USING (true);
