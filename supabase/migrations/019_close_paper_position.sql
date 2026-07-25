-- ============================================================
-- Chart-IX 数据库迁移 #019: 精确全平仓位 RPC
-- ============================================================
-- 问题：原平仓走 place_paper_order，前端用面板价算出 USDT 名义值，
-- 后端又用 BingX 实时价反算数量，两个价格不一致导致平仓数量 != 实际
-- 持仓量，残留一点仓位，需要点两次才平干净。
--
-- 修复：新增 close_paper_position，直接按 pos.quantity 精确全平，
-- 返还全部占用保证金并结算已实现盈亏，避免任何名义值换算误差。

CREATE OR REPLACE FUNCTION public.close_paper_position(
  p_symbol TEXT,
  p_price  NUMERIC
)
RETURNS public.paper_orders AS $$
DECLARE
  acc            public.paper_accounts;
  pos            public.paper_positions;
  v_realized_pnl NUMERIC(20, 8) := 0;
  v_close_side   TEXT;   -- 平仓单的 buy/sell（与持仓方向相反）
  v_total_value  NUMERIC(20, 8);
  v_order        public.paper_orders;
BEGIN
  IF p_price <= 0 THEN
    RAISE EXCEPTION 'price must be positive';
  END IF;

  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;

  SELECT * INTO pos FROM public.paper_positions
    WHERE account_id = acc.id AND symbol = p_symbol FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'position_not_found';
  END IF;

  -- 已实现盈亏（按仓位方向），用整个持仓量精确计算
  IF pos.side = 'long' THEN
    v_realized_pnl := (p_price - pos.entry_price) * pos.quantity;
    v_close_side := 'sell';
  ELSE
    v_realized_pnl := (pos.entry_price - p_price) * pos.quantity;
    v_close_side := 'buy';
  END IF;

  v_total_value := pos.quantity * p_price;

  -- 删除仓位（全平）
  DELETE FROM public.paper_positions WHERE id = pos.id;

  -- 返还全部占用保证金 + 已实现盈亏
  UPDATE public.paper_accounts
    SET balance_usdt = balance_usdt + pos.margin + v_realized_pnl, updated_at = NOW()
    WHERE id = acc.id
    RETURNING * INTO acc;

  IF acc.balance_usdt < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  -- 记录平仓流水（reduce_only，占用保证金为 0）
  INSERT INTO public.paper_orders
    (account_id, symbol, side, quantity, price, total_value, realized_pnl, balance_after, leverage, margin, reduce_only)
    VALUES (acc.id, p_symbol, v_close_side, pos.quantity, p_price, v_total_value,
            NULLIF(v_realized_pnl, 0), acc.balance_usdt, pos.leverage, 0, TRUE)
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
