-- ============================================================
-- Chart-IX 数据库迁移 #038: 移除 feature_flags，权限改由 tier 直接决定
-- ============================================================
-- 背景：这张表有 7 个开关，但全项目只有一个（advanced_chart）被真正读取过
-- —— 唯一的消费点是 useFeatureAccess，而它在整个代码库里只被调用了一次。
-- 其余 6 个（spot_trading / futures_trading / api_key_management /
-- video_download / articles / community）在后台改了不会影响任何行为。
--
-- 比无用更糟的是它会误导：线上 futures_trading.free_enabled = false，
-- 看后台会以为免费用户是被这个开关挡住的，实际拦截来自下单路由里硬编码的
-- tier 判断；反过来想放开合约给免费用户时，把开关打开也不会有任何效果。
-- 030_community_posts.sql 的注释里作者自己就写了 community 这个 key
-- 「读取侧其实不需要」——摆设是有意识加的，只是后来没人清理。
--
-- 新模型写在 src/lib/access.ts，不需要任何数据库配置：
--   Pro   —— 除后台管理外的全部功能
--   免费  —— 只能访问 free 内容；交易只能用模拟账户，不能下实盘单
--   后台  —— 由 users.role='admin' 决定，与 tier 无关
--
-- 同步修掉的一个真实漏洞：现货下单与 OCO 此前完全没有等级校验（只有合约有），
-- 免费用户可以直接下实盘现货单。三条路由现在统一走 canTradeLive()。

DROP TABLE IF EXISTS public.feature_flags;

-- 验证：
--   SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='feature_flags';
--   -- 期望 0 行
