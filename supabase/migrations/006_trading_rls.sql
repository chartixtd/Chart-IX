-- ============================================================
-- Chart-IX 数据库迁移: 交易表 + RLS + 索引 + 触发器
-- ============================================================

-- ============================================================
-- PART 1: 交易表
-- ============================================================

-- API 密钥 (加密存储)
CREATE TABLE public.api_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label               TEXT NOT NULL DEFAULT 'Default',
  api_key_encrypted   TEXT NOT NULL,
  secret_encrypted    TEXT NOT NULL,
  encryption_version  INTEGER NOT NULL DEFAULT 1,
  is_valid            BOOLEAN NOT NULL DEFAULT true,
  last_verified_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.api_keys IS '用户BingX API密钥，加密存储';

-- 交易订单
CREATE TABLE public.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  api_key_id        UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  market_type       TEXT NOT NULL CHECK (market_type IN ('spot', 'futures')),
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type        TEXT NOT NULL CHECK (order_type IN ('market', 'limit', 'stop_loss', 'take_profit', 'stop_market')),
  quantity          NUMERIC(20, 8) NOT NULL,
  price             NUMERIC(20, 8),
  stop_price        NUMERIC(20, 8),
  leverage          INTEGER DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'filled', 'partially_filled', 'canceled', 'rejected', 'expired')),
  bingx_order_id    TEXT,
  executed_qty      NUMERIC(20, 8),
  executed_price    NUMERIC(20, 8),
  total_value       NUMERIC(20, 8),
  fee               NUMERIC(20, 8),
  fee_asset         TEXT,
  error_message     TEXT,
  risk_rejected     BOOLEAN NOT NULL DEFAULT false,
  risk_reason       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.orders IS '用户交易订单记录';

-- 每日交易计数 (风控)
CREATE TABLE public.user_daily_trade_count (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trade_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  count         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, trade_date)
);
COMMENT ON TABLE public.user_daily_trade_count IS '用户每日交易次数，风控用';

-- 自动递增交易计数
CREATE OR REPLACE FUNCTION public.increment_trade_count()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_daily_trade_count (user_id, trade_date, count)
  VALUES (NEW.user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, trade_date)
  DO UPDATE SET count = user_daily_trade_count.count + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_trade_count
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.increment_trade_count();

-- ============================================================
-- PART 2: 启用 RLS
-- ============================================================
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_daily_trade_count ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 3: RLS 策略
-- ============================================================

-- api_keys
CREATE POLICY "Users can manage own API keys"
  ON public.api_keys FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- orders
CREATE POLICY "Users can view own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own orders"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- user_daily_trade_count
CREATE POLICY "Users can view own counts"
  ON public.user_daily_trade_count FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- PART 4: updated_at 触发器
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- api_keys trigger
DROP TRIGGER IF EXISTS trg_api_keys_updated_at ON public.api_keys;
CREATE TRIGGER trg_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- orders trigger
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- PART 5: 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON public.orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_bingx_id ON public.orders(bingx_order_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_trade_user ON public.user_daily_trade_count(user_id);
