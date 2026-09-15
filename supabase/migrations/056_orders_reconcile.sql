-- ============================================================
-- Chart-IX 数据库迁移 #056: 订单对账
-- ============================================================
-- 背景：orders 表只在下单那一刻写入一次，之后没有任何代码回写过它
-- （src/lib/trading/persist.ts 的 recordOrder 是全库唯一的写入点，
-- 落的 status 恒为 'pending'）。后果是 /orders 页面与 dashboard 统计里：
--   * 已成交、已撤销的单永远显示为「等待成交」；
--   * executed_qty / executed_price / fee / fee_asset 这四列建了但全空；
--   * 「已成交」页签恒空，成交额恒为 0。
--
-- 本迁移只做承载对账所需的库侧改动，实际回写逻辑在
-- src/lib/trading/reconcile.ts，由 /api/orders/sync 驱动。
--
-- 写入方是 service-role（见 reconcile.ts 的注释），因此这里刻意不加
-- UPDATE 策略：成交历史是审计流水，前端会话不应有改写它的能力。

-- 1) 记录每行最后一次与交易所对过账的时间。
--    对账时用它跳过刚刚同步过的行，避免一次刷新把几十个订单
--    的查询全打到 BingX。
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.last_synced_at IS
  '最后一次向 BingX 查证该单状态的时间；NULL 表示从未对过账';

-- 2) 对账的取数条件是「这个用户还没终结的单」。既有的
--    idx_orders_status 是全表单列索引，扫出来的大多是别人的行；
--    这里给一条按用户过滤的偏索引，未终结的单本来就是少数。
CREATE INDEX IF NOT EXISTS idx_orders_unsettled
  ON public.orders (user_id, created_at DESC)
  WHERE status IN ('pending', 'partially_filled');

-- 验证：
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='orders' AND column_name='last_synced_at';
--   -- 期望 1 行
--   SELECT indexname FROM pg_indexes
--    WHERE tablename='orders' AND indexname='idx_orders_unsettled';
--   -- 期望 1 行
