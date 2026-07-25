-- ============================================================
-- Chart-IX 数据库迁移 #016: 模拟盘限价单 RPC 函数
-- (paper_limit_orders 表已存在，仅补充 RPC)
-- ============================================================

-- RPC: 创建限价单（buy 时预留 USDT，sell 时检查持仓）
CREATE OR REPLACE FUNCTION public.place_paper_limit_order(
  p_symbol    TEXT,
  p_side      TEXT,
  p_quantity  NUMERIC,
  p_price     NUMERIC
)
RETURNS public.paper_limit_orders AS $$
DECLARE
  acc       public.paper_accounts;
  holding   public.paper_holdings;
  v_total   NUMERIC(20, 8);
  v_order   public.paper_limit_orders;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'invalid side';
  END IF;
  IF p_quantity <= 0 OR p_price <= 0 THEN
    RAISE EXCEPTION 'quantity and price must be positive';
  END IF;

  v_total := p_quantity * p_price;

  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.paper_accounts (user_id) VALUES (auth.uid())
    RETURNING * INTO acc;
  END IF;

  IF p_side = 'buy' THEN
    IF acc.balance_usdt < v_total THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;
    UPDATE public.paper_accounts
      SET balance_usdt = balance_usdt - v_total, updated_at = NOW()
      WHERE id = acc.id;
  ELSE
    SELECT * INTO holding FROM public.paper_holdings
      WHERE account_id = acc.id AND symbol = p_symbol FOR UPDATE;
    IF NOT FOUND OR holding.quantity < p_quantity THEN
      RAISE EXCEPTION 'insufficient_holding';
    END IF;
    UPDATE public.paper_holdings
      SET quantity = quantity - p_quantity, updated_at = NOW()
      WHERE id = holding.id;
    IF (SELECT quantity FROM public.paper_holdings WHERE id = holding.id) <= 0 THEN
      DELETE FROM public.paper_holdings WHERE id = holding.id;
    END IF;
  END IF;

  INSERT INTO public.paper_limit_orders (account_id, symbol, side, quantity, price)
    VALUES (acc.id, p_symbol, p_side, p_quantity, p_price)
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPC: 取消限价单（归还预留的余额/持仓）
CREATE OR REPLACE FUNCTION public.cancel_paper_limit_order(
  p_order_id UUID
)
RETURNS public.paper_limit_orders AS $$
DECLARE
  v_order   public.paper_limit_orders;
  v_total   NUMERIC(20, 8);
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

  v_total := v_order.quantity * v_order.price;

  IF v_order.side = 'buy' THEN
    UPDATE public.paper_accounts
      SET balance_usdt = balance_usdt + v_total, updated_at = NOW()
      WHERE id = v_order.account_id;
  ELSE
    INSERT INTO public.paper_holdings (account_id, symbol, quantity, avg_entry_price)
      VALUES (v_order.account_id, v_order.symbol, v_order.quantity, v_order.price)
    ON CONFLICT (account_id, symbol) DO UPDATE
      SET quantity = public.paper_holdings.quantity + v_order.quantity, updated_at = NOW();
  END IF;

  UPDATE public.paper_limit_orders SET status = 'canceled' WHERE id = p_order_id
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
