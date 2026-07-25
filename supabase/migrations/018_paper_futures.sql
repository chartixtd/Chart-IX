-- ============================================================
-- Chart-IX 数据库迁移 #018: 模拟盘改为杠杆合约交易
-- ============================================================
-- 从现货（只能持有正数量、sell 需先有币）改为 USDT 本位永续合约：
--   buy  = 开多 / 加多 / 减空 / 平空
--   sell = 开空 / 加空 / 减多 / 平多
-- 单向持仓：每个 symbol 最多一个净仓位（long 或 short）。
-- 引入杠杆、保证金占用、强平价、已实现/未实现盈亏。
-- balance_usdt 表示可用余额（钱包余额减去占用保证金）。
--
-- 破坏性变更：清空所有历史模拟盘持仓与流水，账户余额重置为 10000。

-- ------------------------------------------------------------
-- 1. 新建合约仓位表（替代 paper_holdings 的现货语义）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paper_positions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES public.paper_accounts(id) ON DELETE CASCADE,
  symbol             TEXT NOT NULL,
  side               TEXT NOT NULL CHECK (side IN ('long', 'short')),
  quantity           NUMERIC(20, 8) NOT NULL CHECK (quantity > 0),
  entry_price        NUMERIC(20, 8) NOT NULL CHECK (entry_price > 0),
  leverage           INTEGER NOT NULL DEFAULT 1 CHECK (leverage >= 1 AND leverage <= 125),
  margin             NUMERIC(20, 8) NOT NULL CHECK (margin >= 0),
  liquidation_price  NUMERIC(20, 8) NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, symbol)
);
COMMENT ON TABLE public.paper_positions IS '模拟盘合约仓位，单向持仓，每个 symbol 一个净仓（long/short）';

CREATE INDEX IF NOT EXISTS idx_paper_positions_account ON public.paper_positions(account_id);

ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own paper positions" ON public.paper_positions;
CREATE POLICY "Users can view own paper positions"
  ON public.paper_positions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.paper_accounts a
    WHERE a.id = paper_positions.account_id AND a.user_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- 2. paper_orders 增加合约字段
-- ------------------------------------------------------------
ALTER TABLE public.paper_orders
  ADD COLUMN IF NOT EXISTS leverage INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS margin NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reduce_only BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 3. 破坏性重置：清空历史现货持仓/流水，余额重置为 10000
-- ------------------------------------------------------------
DELETE FROM public.paper_orders;
DELETE FROM public.paper_holdings;
DELETE FROM public.paper_limit_orders;
UPDATE public.paper_accounts SET balance_usdt = 10000, updated_at = NOW();

-- ------------------------------------------------------------
-- 4. 强平价计算辅助函数（供 place_paper_order 调用，需先定义）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calc_liquidation_price(
  p_side     TEXT,
  p_entry    NUMERIC,
  p_leverage INTEGER
)
RETURNS NUMERIC AS $$
BEGIN
  IF p_leverage <= 0 THEN
    RETURN 0;
  END IF;
  IF p_side = 'long' THEN
    RETURN GREATEST(p_entry * (1 - 1.0 / p_leverage), 0);
  ELSE
    RETURN p_entry * (1 + 1.0 / p_leverage);
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ------------------------------------------------------------
-- 5. 重写 place_paper_order：合约下单
-- ------------------------------------------------------------
-- 语义：
--   传入 p_side = 'buy' | 'sell'，p_quantity 为合约张数（币数量），p_price 为成交价，
--   p_leverage 为杠杆倍数（开/加仓时生效，减/平仓沿用现有仓位杠杆）。
--   同向 → 加仓（加权平均入场价，追加保证金）
--   反向 → 先平掉已有仓位（结算已实现盈亏、返还保证金），剩余数量按反向开新仓
--   保证金 = 名义价值 / 杠杆；可用余额不足以支付新增保证金时报 insufficient_balance
--   强平价：long = entry*(1 - 1/lev)；short = entry*(1 + 1/lev)（不含手续费）
-- 先删除旧的现货版本（4 参数签名），避免函数重载歧义
DROP FUNCTION IF EXISTS public.place_paper_order(TEXT, TEXT, NUMERIC, NUMERIC);
CREATE OR REPLACE FUNCTION public.place_paper_order(
  p_symbol   TEXT,
  p_side     TEXT,
  p_quantity NUMERIC,
  p_price    NUMERIC,
  p_leverage INTEGER DEFAULT 1
)
RETURNS public.paper_orders AS $$
DECLARE
  acc              public.paper_accounts;
  pos              public.paper_positions;
  v_total_value    NUMERIC(20, 8);
  v_realized_pnl   NUMERIC(20, 8) := 0;
  v_order_side     TEXT;          -- 仓位方向 long/short（由 buy/sell 映射）
  v_margin_delta   NUMERIC(20, 8) := 0;  -- 本单新增占用保证金（可为负=返还）
  v_close_qty      NUMERIC(20, 8);
  v_open_qty       NUMERIC(20, 8);
  v_new_qty        NUMERIC(20, 8);
  v_new_avg        NUMERIC(20, 8);
  v_new_margin     NUMERIC(20, 8);
  v_new_liq        NUMERIC(20, 8);
  v_released_margin NUMERIC(20, 8);
  v_order          public.paper_orders;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'invalid side';
  END IF;
  IF p_quantity <= 0 OR p_price <= 0 THEN
    RAISE EXCEPTION 'quantity and price must be positive';
  END IF;
  IF p_leverage < 1 OR p_leverage > 125 THEN
    RAISE EXCEPTION 'invalid leverage';
  END IF;

  v_total_value := p_quantity * p_price;
  v_order_side := CASE WHEN p_side = 'buy' THEN 'long' ELSE 'short' END;

  -- 锁定账户
  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.paper_accounts (user_id) VALUES (auth.uid())
    RETURNING * INTO acc;
  END IF;

  SELECT * INTO pos FROM public.paper_positions
    WHERE account_id = acc.id AND symbol = p_symbol FOR UPDATE;

  IF NOT FOUND THEN
    -- 无仓位：直接开新仓
    v_new_margin := v_total_value / p_leverage;
    IF acc.balance_usdt < v_new_margin THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;
    v_new_liq := public.calc_liquidation_price(v_order_side, p_price, p_leverage);
    INSERT INTO public.paper_positions
      (account_id, symbol, side, quantity, entry_price, leverage, margin, liquidation_price)
      VALUES (acc.id, p_symbol, v_order_side, p_quantity, p_price, p_leverage, v_new_margin, v_new_liq);
    v_margin_delta := v_new_margin;

  ELSIF pos.side = v_order_side THEN
    -- 同向加仓：加权平均入场价 + 追加保证金
    v_new_qty := pos.quantity + p_quantity;
    v_new_avg := (pos.quantity * pos.entry_price + v_total_value) / v_new_qty;
    v_new_margin := pos.margin + v_total_value / p_leverage;
    IF acc.balance_usdt < v_total_value / p_leverage THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;
    v_new_liq := public.calc_liquidation_price(v_order_side, v_new_avg, p_leverage);
    UPDATE public.paper_positions
      SET quantity = v_new_qty, entry_price = v_new_avg, leverage = p_leverage,
          margin = v_new_margin, liquidation_price = v_new_liq, updated_at = NOW()
      WHERE id = pos.id;
    v_margin_delta := v_total_value / p_leverage;

  ELSE
    -- 反向：先平仓（部分或全部），可能反手开新仓
    v_close_qty := LEAST(p_quantity, pos.quantity);
    v_open_qty := p_quantity - v_close_qty;

    -- 平仓部分的已实现盈亏（按仓位方向）
    IF pos.side = 'long' THEN
      v_realized_pnl := (p_price - pos.entry_price) * v_close_qty;
    ELSE
      v_realized_pnl := (pos.entry_price - p_price) * v_close_qty;
    END IF;

    -- 按比例返还被平仓部分占用的保证金
    v_released_margin := pos.margin * (v_close_qty / pos.quantity);

    IF v_close_qty >= pos.quantity THEN
      -- 全平
      DELETE FROM public.paper_positions WHERE id = pos.id;
    ELSE
      -- 部分平仓：数量与保证金按比例减少，入场价与杠杆不变
      UPDATE public.paper_positions
        SET quantity = pos.quantity - v_close_qty,
            margin = pos.margin - v_released_margin,
            updated_at = NOW()
        WHERE id = pos.id;
    END IF;

    -- 平仓：返还保证金 + 已实现盈亏
    v_margin_delta := -v_released_margin;

    -- 反手开新仓（如果下单量超过原仓位）
    IF v_open_qty > 0 THEN
      v_new_margin := (v_open_qty * p_price) / p_leverage;
      -- 可用余额 = 当前余额 + 本次返还保证金 + 已实现盈亏
      IF (acc.balance_usdt - v_margin_delta + v_realized_pnl) < v_new_margin THEN
        RAISE EXCEPTION 'insufficient_balance';
      END IF;
      v_new_liq := public.calc_liquidation_price(v_order_side, p_price, p_leverage);
      INSERT INTO public.paper_positions
        (account_id, symbol, side, quantity, entry_price, leverage, margin, liquidation_price)
        VALUES (acc.id, p_symbol, v_order_side, v_open_qty, p_price, p_leverage, v_new_margin, v_new_liq);
      v_margin_delta := v_margin_delta + v_new_margin;
    END IF;
  END IF;

  -- 结算余额：扣除新增保证金（v_margin_delta 为正=占用，为负=返还）+ 已实现盈亏
  UPDATE public.paper_accounts
    SET balance_usdt = balance_usdt - v_margin_delta + v_realized_pnl, updated_at = NOW()
    WHERE id = acc.id
    RETURNING * INTO acc;

  IF acc.balance_usdt < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  INSERT INTO public.paper_orders
    (account_id, symbol, side, quantity, price, total_value, realized_pnl, balance_after, leverage, margin)
    VALUES (acc.id, p_symbol, p_side, p_quantity, p_price, v_total_value,
            NULLIF(v_realized_pnl, 0), acc.balance_usdt, p_leverage, GREATEST(v_margin_delta, 0))
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 6. 合约限价单：改为保证金预留（buy/sell 都按 名义/杠杆 冻结保证金）
-- ------------------------------------------------------------
ALTER TABLE public.paper_limit_orders
  ADD COLUMN IF NOT EXISTS leverage INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS margin NUMERIC(20, 8) NOT NULL DEFAULT 0;

-- 放开 side 的现货语义限制（buy=开多挂单, sell=开空挂单）
-- （side 约束本身仍为 buy/sell，无需改动）

CREATE OR REPLACE FUNCTION public.place_paper_limit_order(
  p_symbol    TEXT,
  p_side      TEXT,
  p_quantity  NUMERIC,
  p_price     NUMERIC,
  p_leverage  INTEGER DEFAULT 1
)
RETURNS public.paper_limit_orders AS $$
DECLARE
  acc       public.paper_accounts;
  v_margin  NUMERIC(20, 8);
  v_order   public.paper_limit_orders;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'invalid side';
  END IF;
  IF p_quantity <= 0 OR p_price <= 0 THEN
    RAISE EXCEPTION 'quantity and price must be positive';
  END IF;
  IF p_leverage < 1 OR p_leverage > 125 THEN
    RAISE EXCEPTION 'invalid leverage';
  END IF;

  v_margin := (p_quantity * p_price) / p_leverage;

  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.paper_accounts (user_id) VALUES (auth.uid())
    RETURNING * INTO acc;
  END IF;

  -- 冻结保证金（多空一致）
  IF acc.balance_usdt < v_margin THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;
  UPDATE public.paper_accounts
    SET balance_usdt = balance_usdt - v_margin, updated_at = NOW()
    WHERE id = acc.id;

  INSERT INTO public.paper_limit_orders (account_id, symbol, side, quantity, price, leverage, margin)
    VALUES (acc.id, p_symbol, p_side, p_quantity, p_price, p_leverage, v_margin)
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 删除旧的 4 参数限价单函数，避免重载歧义
DROP FUNCTION IF EXISTS public.place_paper_limit_order(TEXT, TEXT, NUMERIC, NUMERIC);

-- 取消限价单：归还冻结的保证金
CREATE OR REPLACE FUNCTION public.cancel_paper_limit_order(
  p_order_id UUID
)
RETURNS public.paper_limit_orders AS $$
DECLARE
  v_order   public.paper_limit_orders;
BEGIN
  SELECT lo.* INTO v_order FROM public.paper_limit_orders lo
    JOIN public.paper_accounts a ON a.id = lo.account_id
    WHERE lo.id = p_order_id AND a.user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF v_order.status != 'pending' THEN
    RAISE EXCEPTION 'order is not pending';
  END IF;

  -- 归还保证金
  UPDATE public.paper_accounts
    SET balance_usdt = balance_usdt + v_order.margin, updated_at = NOW()
    WHERE id = v_order.account_id;

  UPDATE public.paper_limit_orders SET status = 'canceled' WHERE id = p_order_id
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
