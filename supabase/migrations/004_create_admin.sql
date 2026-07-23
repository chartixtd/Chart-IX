-- ============================================================
-- Chart-IX 数据库迁移 #004: Admin管理表 (定价、功能开关、风控、设置、日志)
-- ============================================================

-- 1. 订阅记录 (预留)
CREATE TABLE public.subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_type         TEXT NOT NULL CHECK (plan_type IN ('monthly', 'yearly')),
  payment_method    TEXT,
  payment_tx_hash   TEXT,
  amount_paid       NUMERIC(10, 2),
  currency_paid     TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'canceled', 'refunded')),
  start_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date          TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.subscriptions IS '订阅记录（预留，支付接入后使用）';

-- 2. 定价配置
CREATE TABLE public.pricing_config (
  id              SERIAL PRIMARY KEY,
  plan_type       TEXT NOT NULL UNIQUE CHECK (plan_type IN ('monthly', 'yearly')),
  price           NUMERIC(10, 2) NOT NULL,
  original_price  NUMERIC(10, 2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  currency_symbol TEXT NOT NULL DEFAULT '$',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.pricing_config (plan_type, price, original_price) VALUES
  ('monthly', 29.99, NULL),
  ('yearly', 199.99, 359.88);

-- 3. 功能开关
CREATE TABLE public.feature_flags (
  id              SERIAL PRIMARY KEY,
  feature_key     TEXT NOT NULL UNIQUE,
  feature_group   TEXT NOT NULL DEFAULT 'general',
  display_name    JSONB NOT NULL,
  description     JSONB,
  free_enabled    BOOLEAN NOT NULL DEFAULT false,
  pro_enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.feature_flags (feature_key, feature_group, display_name, free_enabled, pro_enabled) VALUES
  ('spot_trading',       'trading', '{"zh-CN":"现货交易", "en-US":"Spot Trading", "ms-MY":"Dagangan Spot"}', true, true),
  ('futures_trading',    'trading', '{"zh-CN":"合约交易", "en-US":"Futures Trading", "ms-MY":"Dagangan Niaga Hadapan"}', false, true),
  ('api_key_management', 'trading', '{"zh-CN":"API密钥管理", "en-US":"API Key Management", "ms-MY":"Pengurusan Kunci API"}', true, true),
  ('advanced_chart',     'trading', '{"zh-CN":"高级K线图", "en-US":"Advanced Chart", "ms-MY":"Carta Lanjutan"}', false, true),
  ('video_download',     'content', '{"zh-CN":"视频下载", "en-US":"Video Download", "ms-MY":"Muat Turun Video"}', false, true);

-- 4. 网站设置
CREATE TABLE public.admin_settings (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.admin_settings (key, value, description) VALUES
  ('site_name',        '"Chart-IX"',                              '网站名称'),
  ('site_description', '"加密货币交易教育平台"',                    'SEO描述'),
  ('contact_email',    '"admin@chart-ix.com"',                    '联系邮箱'),
  ('telegram_group',   '"https://t.me/chartix"',                  'Telegram群组'),
  ('footer_text',      '"© 2026 Chart-IX. All rights reserved."', '页脚文本'),
  ('social_links',     '{"twitter":"","discord":"","youtube":""}','社交媒体链接');

-- 5. 管理员操作日志
CREATE TABLE public.admin_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES public.users(id),
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  old_value     JSONB,
  new_value     JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.admin_logs IS '管理员操作日志';
