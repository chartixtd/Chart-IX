-- ============================================================
-- Chart-IX 数据库迁移 #003: 交易表 (API密钥、订单、风控计数)
-- ============================================================

-- 1. API 密钥 (加密存储)
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

-- 2. 交易订单
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

-- 3. 每日交易计数 (风控)
CREATE TABLE public.user_daily_trade_count (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trade_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  count         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, trade_date)
);
COMMENT ON TABLE public.user_daily_trade_count IS '用户每日交易次数，风控用';

-- 4. 自动递增交易计数
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
