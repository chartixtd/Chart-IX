-- ============================================================
-- Chart-IX 数据库迁移 #040: 安全与性能加固
-- ============================================================
-- 处理 Supabase Advisor 报出的既有问题（均与本次性能优化/成交明细工作
-- 无关，是更早期迁移遗留的配置缺口）。三类改动，均为纯加固/文档化，
-- 不改变任何现有功能行为：
--
--   1. 10 个函数补 search_path，防止 search_path 劫持攻击
--      （调用方在自己的会话里临时改 search_path，让函数体里的裸表名
--      解析到攻击者控制的同名对象）——已逐个读过函数体确认只引用
--      public.* 下的表，加这个限制不影响任何现有查询路径。
--   2. 收紧 SECURITY DEFINER 函数的直接 RPC 调用权限：模拟盘交易、
--      成就发放的 8 个函数只应由已登录用户调用（收回 anon）；
--      限流计数器与两个触发器函数（handle_new_user/sync_user_claims）
--      只应由 service_role/触发器机制内部调用，不该被任何人直接经
--      /rest/v1/rpc/* 调用（收回 anon 与 authenticated 两侧）。
--      触发器的触发不经过这个权限检查路径，收回后触发器仍正常工作。
--   3. 6 张纯后端表（admin_logs/rate_limit_buckets/screener_cache/
--      telegram_push_*）已开 RLS 但从未配过策略——效果上等于已经
--      拒绝了 anon/authenticated 的一切直接访问（service_role 不受
--      RLS 约束，后台 API 路由不受影响）。这里加一条显式的 deny-all
--      策略，把"本表只服务端读写"这个既有事实写成看得见的策略，不
--      改变任何实际权限。
--   4. 12 个外键补覆盖索引，纯新增，不影响现有查询结果。
--
-- 刻意不处理的两项（评估后判断风险/收益不划算）：
--   - pg_net 扩展的 extnamespace 显示为 public，但实际全部函数/对象
--     都已经在 net schema 下（已用 pg_depend 查证），public 下没有
--     任何真实暴露的对象——纯元数据层面的 lint，无实际安全影响。
--     ALTER EXTENSION ... SET SCHEMA 对带后台 worker 的扩展有一定
--     不可预测性，而 pg_net 正被 Telegram 推送的 cron 任务依赖
--     （036 刚把这条链路修好），不值得为了消除一条 INFO 级别的
--     元数据 lint 去冒风险。
--   - 泄露密码检测（HaveIBeenPwned 比对）是 Auth 服务的配置项，
--     不落在 Postgres 里，没有 SQL 接口能改——需要在 Supabase
--     Dashboard 的 Authentication 设置里手动打开。
-- ============================================================

-- ── 1. 函数 search_path 加固 ─────────────────────────────────
ALTER FUNCTION public.calc_liquidation_price(p_side text, p_entry numeric, p_leverage integer) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_articles_updated_at() SET search_path = public;
ALTER FUNCTION public.update_modified_column() SET search_path = public;
ALTER FUNCTION public.check_video_completion() SET search_path = public;
ALTER FUNCTION public.update_community_posts_updated_at() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.get_community_post_stats(p_post_ids uuid[]) SET search_path = public;
ALTER FUNCTION public.increment_telegram_target_failure(p_target_id uuid, p_error text) SET search_path = public;
ALTER FUNCTION public.increment_telegram_settings_failure(p_error text) SET search_path = public;

-- ── 2. 收紧 SECURITY DEFINER 函数的直接调用权限 ───────────────
-- 模拟盘交易 + 成就发放：应用代码全部经已登录用户的会话调用
-- （src/app/api/paper/**、src/components/video/VideoQuiz.tsx、
-- src/components/auth/AuthProvider.tsx），从未有未登录场景需要它们。
REVOKE EXECUTE ON FUNCTION public.get_or_create_paper_account() FROM anon;
REVOKE EXECUTE ON FUNCTION public.place_paper_order(p_symbol text, p_side text, p_quantity numeric, p_price numeric, p_leverage integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.place_paper_limit_order(p_symbol text, p_side text, p_quantity numeric, p_price numeric, p_leverage integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_paper_position(p_symbol text, p_price numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_paper_limit_order(p_order_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_paper_position_tp_sl(p_symbol text, p_take_profit numeric, p_stop_loss numeric, p_clear_take_profit boolean, p_clear_stop_loss boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_achievement(p_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_first_video_achievement() FROM anon;

-- 限流计数器：只由 src/lib/trading/rate-limit.ts 经 service_role 客户端调用
-- （021 建表时的注释就写了"仅服务端读写，不对外暴露"，这里补上权限层面
-- 的落实）。
REVOKE EXECUTE ON FUNCTION public.rpc_check_rate_limit(p_key text, p_window_ms bigint, p_max integer) FROM anon, authenticated;

-- 两个触发器函数：只应由触发器机制内部调用（on_auth_user_created /
-- on_user_tier_role_change），触发器触发不经过这条 EXECUTE 权限检查，
-- 收回后两个触发器均正常工作——收回的只是"任何人都能经 RPC 端点直接
-- 手工调用它们"这条不该存在的路径。
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_claims() FROM anon, authenticated;

-- ── 3. 纯后端表：把"只服务端访问"落成显式策略 ─────────────────
-- 以下 6 张表已开 RLS 但零策略——实际效果已经是拒绝 anon/authenticated
-- 的任何直接访问（service_role 不受 RLS 约束，不受影响）。这里加的
-- deny-all 策略不改变任何实际权限，只是把这个事实写清楚、消掉 Advisor
-- 的"开了 RLS 却没配策略"提示。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_logs', 'rate_limit_buckets', 'screener_cache',
    'telegram_push_log', 'telegram_push_settings', 'telegram_push_targets'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "backend_only_deny_all" ON public.%I', t
    );
    EXECUTE format(
      'CREATE POLICY "backend_only_deny_all" ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

-- ── 4. 外键覆盖索引 ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_articles_author_id ON public.articles (author_id);
CREATE INDEX IF NOT EXISTS idx_articles_category_id ON public.articles (category_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_author_id ON public.community_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_author_id ON public.community_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_community_reactions_user_id ON public.community_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_learning_path_steps_video_id ON public.learning_path_steps (video_id);
CREATE INDEX IF NOT EXISTS idx_orders_api_key_id ON public.orders (api_key_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON public.quiz_attempts (quiz_id);
CREATE INDEX IF NOT EXISTS idx_telegram_push_log_target_id ON public.telegram_push_log (target_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_key ON public.user_achievements (achievement_key);
CREATE INDEX IF NOT EXISTS idx_video_notes_video_id ON public.video_notes (video_id);
CREATE INDEX IF NOT EXISTS idx_videos_uploaded_by ON public.videos (uploaded_by);

-- 验证：
--   SELECT proname FROM pg_proc WHERE proconfig IS NOT NULL AND pronamespace = 'public'::regnamespace;
--   SELECT grantee, routine_name FROM information_schema.routine_privileges
--     WHERE routine_schema='public' AND routine_name IN
--     ('handle_new_user','sync_user_claims','rpc_check_rate_limit') AND grantee IN ('anon','authenticated');
--     （应返回 0 行）
--   SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
--     AND tablename IN ('admin_logs','rate_limit_buckets','screener_cache',
--     'telegram_push_log','telegram_push_settings','telegram_push_targets');
