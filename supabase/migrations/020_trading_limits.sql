-- 020: 交易风控限额 + 订单类型放宽 + API Key 元数据 + 每日计数触发器修正
-- 依赖：006_trading_rls.sql（orders / api_keys / user_daily_trade_count /
--       trg_increment_trade_count 触发器，本迁移第 5 节对其函数体做 CREATE OR REPLACE）
--
-- 锁行为提示（手动在 SQL Editor 里整段粘贴执行前请知悉）：
--   - 两条 `ALTER TABLE public.orders ADD CONSTRAINT ... CHECK (...)`
--     （orders_order_type_check、orders_side_check）不会重写表，但 Postgres 默认会
--     校验表内现有全部行，执行期间会对 orders 持有 ACCESS EXCLUSIVE 锁——
--     期间对 orders 的读、写都会被阻塞，直到该条语句校验完成。这一步发生两次。
--   - `CREATE UNIQUE INDEX api_keys_one_primary_per_user` 和
--     `CREATE INDEX user_daily_trade_count_lookup` 都没有加 CONCURRENTLY，
--     建索引期间会阻塞对应表的写入（不阻塞读）。
--   - 以上都是当前上线前这几张表数据量还很小时的短暂阻塞，预期是"很快"而不是"零"，
--     不要在这几条语句执行期间同时压测下单接口。
--   - 整份文件在 SQL Editor 里作为一段粘贴执行时，Postgres 会把它当成隐式单一事务：
--     任何一条语句失败，前面已执行的语句都会一并回滚，不会留下只执行一半的 schema。

-- 1) 风控限额配置。user_id 为 NULL 的那一行是全局默认。
--    任一字段为 NULL 表示该项不限制；本迁移刻意不预置任何数值，
--    以免在无人配置时意外锁死所有用户下单。
CREATE TABLE IF NOT EXISTS public.trading_limits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES public.users(id) ON DELETE CASCADE,
  max_notional_per_order  NUMERIC(20, 8),
  max_orders_per_day      INTEGER,
  max_leverage            INTEGER,
  allowed_symbols         TEXT[],
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.trading_limits IS '交易风控限额；user_id 为 NULL 的行为全局默认，字段为 NULL 表示不限制';

-- 全局默认行唯一；每个用户至多一行覆盖配置
CREATE UNIQUE INDEX IF NOT EXISTS trading_limits_global_uniq
  ON public.trading_limits ((user_id IS NULL)) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trading_limits_user_uniq
  ON public.trading_limits (user_id) WHERE user_id IS NOT NULL;

-- RLS：用户只能读自己的和全局默认，写入仅限服务端（service role 绕过 RLS）
ALTER TABLE public.trading_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trading_limits_select_own ON public.trading_limits;
CREATE POLICY trading_limits_select_own ON public.trading_limits
  FOR SELECT TO authenticated USING (user_id IS NULL OR user_id = auth.uid());

-- 2) 放宽 orders.order_type：现有 CHECK 只允许 5 种值（006_trading_rls.sql 里的小写枚举
--    'market' / 'limit' / 'stop_loss' / 'take_profit' / 'stop_market'），
--    实际需要落库 14 种 BingX 原始类型名（现货 6 + 合约 8），新写入统一用大写。
--    这里用 upper(order_type) 包裹比较：一是让本迁移生效后，哪怕 orders 表里还留着
--    006 的历史小写行，ADD CONSTRAINT 校验存量数据时也不会失败，不需要事先手工排查、
--    清洗数据；二是让 order_type 和下面 side 的大小写策略保持一致（side 同样用 upper()
--    包裹），避免同一张表里两种不同的大小写约定。因此列表里同时补上了 006 遗留值里
--    唯一不在新 14 种 BingX 类型名单里的 'STOP_LOSS'（大写形式），其余遗留值
--    MARKET/LIMIT/TAKE_PROFIT/STOP_MARKET 本就在新名单内，无需重复列出。
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check
  CHECK (upper(order_type) IN (
    -- 现货
    'MARKET', 'LIMIT',
    'TAKE_STOP_LIMIT', 'TAKE_STOP_MARKET',
    'TRIGGER_LIMIT', 'TRIGGER_MARKET',
    -- 合约
    'STOP_MARKET', 'STOP',
    'TAKE_PROFIT_MARKET', 'TAKE_PROFIT',
    'TRAILING_STOP_MARKET', 'TRAILING_TP_SL',
    -- OCO（现货组合单）
    'OCO',
    -- 平仓
    'CLOSE_POSITION',
    -- 兼容 006_trading_rls.sql 遗留的小写枚举值（此处已大写），
    -- 新 BingX 类型名单里没有等价项，故单独保留
    'STOP_LOSS'
  ));

-- 落库时统一用大写 BingX 原始类型名，与 side 的小写约定不同，
-- 这里同时把 side 的 CHECK 放宽为大小写皆可，避免调用方来回转换出错
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_side_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_side_check
  CHECK (upper(side) IN ('BUY', 'SELL'));

-- 3) API Key 元数据
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS api_key_masked TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS spot_ok BOOLEAN;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS futures_ok BOOLEAN;

COMMENT ON COLUMN public.api_keys.api_key_masked IS '写入时算好的前4后4掩码，避免列表页每次解密';
COMMENT ON COLUMN public.api_keys.is_primary IS '交易路由选用的主密钥；每用户至多一个';
COMMENT ON COLUMN public.api_keys.spot_ok IS '现货权限验证结果，NULL 表示尚未验证';
COMMENT ON COLUMN public.api_keys.futures_ok IS '合约权限验证结果，NULL 表示尚未验证';

-- 每用户至多一个主密钥
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_primary_per_user
  ON public.api_keys (user_id) WHERE is_primary;

-- 把每个用户现有最早创建的有效 Key 标为主密钥，避免升级后无 primary 可选
UPDATE public.api_keys k SET is_primary = true
WHERE k.id = (
  SELECT id FROM public.api_keys
  WHERE user_id = k.user_id AND is_valid
  ORDER BY created_at ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM public.api_keys p WHERE p.user_id = k.user_id AND p.is_primary
);

-- 4) 按用户+日期查每日计数的索引（风控校验每次下单都要查）
CREATE INDEX IF NOT EXISTS user_daily_trade_count_lookup
  ON public.user_daily_trade_count (user_id, trade_date);

-- 5) 修正每日计数触发器：跳过被风控拦下的订单
--    006_trading_rls.sql 里的 increment_trade_count() 对每一条插入 orders 的行都计数，
--    不区分 risk_rejected。一旦订单被风控拦截就不该占用户当日额度——否则一次拦截会
--    白白消耗一次配额，越是频繁触发风控的用户越容易被连带锁死，属于反向复合的坏体验。
--    这里用 CREATE OR REPLACE FUNCTION 原地替换函数体：函数名、参数、返回类型都不变，
--    Postgres 保留其 OID，006 里创建的 trg_increment_trade_count 触发器按 OID 引用该函数，
--    因此无需 DROP/CREATE 触发器本身，下一次触发器触发时就会执行这里的新函数体。
--    （这是 Postgres 文档化的标准行为，本次未连接实际数据库验证，留待迁移执行后确认。）
--    保留原有的原子 `INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1`——
--    这就是 020 之前 persist.ts 里应用层 bumpDailyCount() 想做但做不到原子的事，
--    两边不能并存，因此 persist.ts 已经删除了那段重复计数逻辑，只保留读取。
CREATE OR REPLACE FUNCTION public.increment_trade_count()
RETURNS TRIGGER AS $$
BEGIN
  -- NEW.risk_rejected 理论上有 NOT NULL DEFAULT false，这里仍显式用
  -- `IS TRUE` 处理，不依赖该约束——即便将来该列被放宽为可空，NULL 也会
  -- 被当作"未被拒绝"计数，行为保持保守（宁可计数，不可漏计真实下单）。
  IF NEW.risk_rejected IS TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_daily_trade_count (user_id, trade_date, count)
  VALUES (NEW.user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, trade_date)
  DO UPDATE SET count = user_daily_trade_count.count + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
