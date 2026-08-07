-- ============================================================
-- Chart-IX 数据库迁移 #037: 彻底移除交易限额
-- ============================================================
-- 背景：管理员可配的交易限额（单笔名义额 / 每日笔数 / 最大杠杆 /
-- 交易对白名单）整套机制废弃。线上 trading_limits 一直是 0 行，而
-- preflight 在读不到配置时按「不限制」放行，所以这套机制从上线起
-- 就没有真正约束过任何一笔订单——留着只是让后台多一个改了没用的页面。
--
-- 谁能下真实单改由权限层决定（src/lib/access.ts：仅 Pro 可下实盘，
-- 免费用户只能用模拟账户），剩下的护栏是交易所自身的规格与保证金规则。
--
-- 应用侧同步删除：/admin/trading-limits 页面与 API、src/lib/trading/limits.ts、
-- preflight.ts 里的限额校验、persist.ts 的 countOrdersToday。
--
-- 顺带删掉每日计数子系统：user_daily_trade_count 这张表连同维护它的触发器
-- 唯一的用途就是喂给「每日笔数限额」。/orders 页面与 dashboard 的统计都是
-- 直接查 orders 表算的，与这张表无关，删除不影响任何展示。
--
-- 历史迁移（003/005/006/020）刻意不改：它们已经在线上跑过，回头改写会让
-- 迁移历史与实际库状态对不上。这里用一条新的 DOWN 迁移收口。

-- 先摘触发器再删函数：函数被触发器引用，直接 DROP FUNCTION 会被依赖挡下
-- （不加 CASCADE 时报错，加了则连带删掉触发器——显式分两步意图更清楚）。
DROP TRIGGER IF EXISTS trg_increment_trade_count ON public.orders;
DROP FUNCTION IF EXISTS public.increment_trade_count();

-- 两张表上的 RLS 策略随表一起消失，无需单独 DROP POLICY。
DROP TABLE IF EXISTS public.user_daily_trade_count;
DROP TABLE IF EXISTS public.trading_limits;

-- 验证：
--   SELECT tablename FROM pg_tables
--    WHERE schemaname='public' AND tablename IN ('trading_limits','user_daily_trade_count');
--   -- 期望 0 行
--   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname='trg_increment_trade_count';
--   -- 期望 0 行
