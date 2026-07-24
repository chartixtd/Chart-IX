-- ============================================================
-- Chart-IX 数据库迁移 #010: 模拟盘 (Paper Trading)
-- ============================================================
-- 范围: 仅现货、仅市价单、按调用方传入的当前价格立即成交，不做滑点模拟。
-- 账户/持仓/成交记录的写入全部走 place_paper_order() 这一个函数，
-- 保证"扣余额 + 改持仓 + 记流水"在同一事务内原子完成，不会因为
-- 并发下单/重复点击出现余额与持仓对不上的情况。

-- 1. 模拟盘账户 (每个用户一个，首次使用时自动开户)
CREATE TABLE public.paper_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  balance_usdt  NUMERIC(20, 8) NOT NULL DEFAULT 10000,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.paper_accounts IS '模拟盘账户，初始 10000 USDT 虚拟余额';

-- 2. 模拟盘持仓 (按用户+交易对)
CREATE TABLE public.paper_holdings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.paper_accounts(id) ON DELETE CASCADE,
  symbol            TEXT NOT NULL,
  quantity          NUMERIC(20, 8) NOT NULL DEFAULT 0,
  avg_entry_price   NUMERIC(20, 8) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, symbol)
);
COMMENT ON TABLE public.paper_holdings IS '模拟盘持仓，quantity=0 的行会被清理';

-- 3. 模拟盘成交记录 (市价单立即成交，一笔订单=一笔成交)
CREATE TABLE public.paper_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.paper_accounts(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity        NUMERIC(20, 8) NOT NULL CHECK (quantity > 0),
  price           NUMERIC(20, 8) NOT NULL CHECK (price > 0),
  total_value     NUMERIC(20, 8) NOT NULL,
  realized_pnl    NUMERIC(20, 8),
  balance_after   NUMERIC(20, 8) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.paper_orders IS '模拟盘成交流水';
CREATE INDEX idx_paper_orders_account ON public.paper_orders(account_id, created_at DESC);

-- 4. RLS: 用户只能读自己的账户/持仓/流水；写入统一走下面的 RPC 函数
ALTER TABLE public.paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own paper account"
  ON public.paper_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own paper holdings"
  ON public.paper_holdings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.paper_accounts a
    WHERE a.id = paper_holdings.account_id AND a.user_id = auth.uid()
  ));

CREATE POLICY "Users can view own paper orders"
  ON public.paper_orders FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.paper_accounts a
    WHERE a.id = paper_orders.account_id AND a.user_id = auth.uid()
  ));

-- 5. 开户: 若已存在直接返回现有账户 (幂等)
CREATE OR REPLACE FUNCTION public.get_or_create_paper_account()
RETURNS public.paper_accounts AS $$
DECLARE
  acc public.paper_accounts;
BEGIN
  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    INSERT INTO public.paper_accounts (user_id) VALUES (auth.uid())
    RETURNING * INTO acc;
  END IF;
  RETURN acc;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. 下单: 市价单，price 由调用方 (Next.js API) 传入当前行情价
--    买入: 检查余额足够 -> 扣余额 -> 加权平均加仓
--    卖出: 检查持仓足够 -> 减持仓 -> 按均价计算已实现盈亏 -> 加余额
CREATE OR REPLACE FUNCTION public.place_paper_order(
  p_symbol TEXT,
  p_side TEXT,
  p_quantity NUMERIC,
  p_price NUMERIC
)
RETURNS public.paper_orders AS $$
DECLARE
  acc public.paper_accounts;
  holding public.paper_holdings;
  v_total_value NUMERIC(20, 8);
  v_realized_pnl NUMERIC(20, 8) := NULL;
  v_new_qty NUMERIC(20, 8);
  v_new_avg_price NUMERIC(20, 8);
  v_order public.paper_orders;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'invalid side';
  END IF;
  IF p_quantity <= 0 OR p_price <= 0 THEN
    RAISE EXCEPTION 'quantity and price must be positive';
  END IF;

  v_total_value := p_quantity * p_price;

  -- 锁定账户行，避免并发下单产生竞态
  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.paper_accounts (user_id) VALUES (auth.uid())
    RETURNING * INTO acc;
  END IF;

  SELECT * INTO holding FROM public.paper_holdings
    WHERE account_id = acc.id AND symbol = p_symbol FOR UPDATE;

  IF p_side = 'buy' THEN
    IF acc.balance_usdt < v_total_value THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;

    IF NOT FOUND THEN
      v_new_qty := p_quantity;
      v_new_avg_price := p_price;
      INSERT INTO public.paper_holdings (account_id, symbol, quantity, avg_entry_price)
        VALUES (acc.id, p_symbol, v_new_qty, v_new_avg_price);
    ELSE
      v_new_qty := holding.quantity + p_quantity;
      v_new_avg_price := (holding.quantity * holding.avg_entry_price + v_total_value) / v_new_qty;
      UPDATE public.paper_holdings
        SET quantity = v_new_qty, avg_entry_price = v_new_avg_price, updated_at = NOW()
        WHERE id = holding.id;
    END IF;

    UPDATE public.paper_accounts
      SET balance_usdt = balance_usdt - v_total_value, updated_at = NOW()
      WHERE id = acc.id
      RETURNING * INTO acc;

  ELSE -- sell
    IF NOT FOUND OR holding.quantity < p_quantity THEN
      RAISE EXCEPTION 'insufficient_holding';
    END IF;

    v_realized_pnl := (p_price - holding.avg_entry_price) * p_quantity;
    v_new_qty := holding.quantity - p_quantity;

    IF v_new_qty = 0 THEN
      DELETE FROM public.paper_holdings WHERE id = holding.id;
    ELSE
      UPDATE public.paper_holdings
        SET quantity = v_new_qty, updated_at = NOW()
        WHERE id = holding.id;
    END IF;

    UPDATE public.paper_accounts
      SET balance_usdt = balance_usdt + v_total_value, updated_at = NOW()
      WHERE id = acc.id
      RETURNING * INTO acc;
  END IF;

  INSERT INTO public.paper_orders (account_id, symbol, side, quantity, price, total_value, realized_pnl, balance_after)
    VALUES (acc.id, p_symbol, p_side, p_quantity, p_price, v_total_value, v_realized_pnl, acc.balance_usdt)
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
