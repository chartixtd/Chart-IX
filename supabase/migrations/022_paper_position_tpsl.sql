-- 022: 模拟盘持仓止盈止损
-- 背景：模拟盘此前只有进场价/强平价两条参考线，没有止盈止损概念。
-- 现在图表上的止盈止损线（实盘现货/合约/模拟盘）都要能拖动修改，模拟盘这边
-- 需要落地存储 + 一个受 auth.uid() 保护的更新入口。自动触发平仓由客户端
-- 的价格监听完成（复用已有的价格提醒机制），这里只负责存储与校验。

ALTER TABLE public.paper_positions
  ADD COLUMN IF NOT EXISTS take_profit_price NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS stop_loss_price NUMERIC(20, 8);

COMMENT ON COLUMN public.paper_positions.take_profit_price IS '止盈触发价，NULL 表示未设置';
COMMENT ON COLUMN public.paper_positions.stop_loss_price IS '止损触发价，NULL 表示未设置';

-- 更新某个持仓的止盈/止损价。p_clear_* 用于显式清除（拖到图表外或点击移除），
-- 区别于"这次调用没传该字段"——单纯把对应数值参数设为 NULL 无法区分这两种情况。
CREATE OR REPLACE FUNCTION public.set_paper_position_tp_sl(
  p_symbol TEXT,
  p_take_profit NUMERIC DEFAULT NULL,
  p_stop_loss NUMERIC DEFAULT NULL,
  p_clear_take_profit BOOLEAN DEFAULT FALSE,
  p_clear_stop_loss BOOLEAN DEFAULT FALSE
)
RETURNS public.paper_positions AS $$
DECLARE
  acc public.paper_accounts;
  pos public.paper_positions;
BEGIN
  IF p_take_profit IS NOT NULL AND p_take_profit <= 0 THEN
    RAISE EXCEPTION 'take_profit must be positive';
  END IF;
  IF p_stop_loss IS NOT NULL AND p_stop_loss <= 0 THEN
    RAISE EXCEPTION 'stop_loss must be positive';
  END IF;

  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;

  UPDATE public.paper_positions
  SET
    take_profit_price = CASE
      WHEN p_clear_take_profit THEN NULL
      WHEN p_take_profit IS NOT NULL THEN p_take_profit
      ELSE take_profit_price
    END,
    stop_loss_price = CASE
      WHEN p_clear_stop_loss THEN NULL
      WHEN p_stop_loss IS NOT NULL THEN p_stop_loss
      ELSE stop_loss_price
    END,
    updated_at = NOW()
  WHERE account_id = acc.id AND symbol = p_symbol
  RETURNING * INTO pos;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'position_not_found';
  END IF;

  RETURN pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
