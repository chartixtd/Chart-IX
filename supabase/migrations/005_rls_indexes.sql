-- ============================================================
-- Chart-IX 数据库迁移 #005: RLS 策略 + 索引 + 触发器
-- ============================================================

-- ============================================================
-- PART 1: 启用所有表的 RLS
-- ============================================================
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_daily_trade_count ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 2: RLS 策略
-- ============================================================

-- === videos ===
CREATE POLICY "Anyone can view non-deleted videos"
  ON public.videos FOR SELECT
  USING (is_deleted = false);

CREATE POLICY "Admins can insert videos"
  ON public.videos FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update videos"
  ON public.videos FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete videos"
  ON public.videos FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === video_categories ===
CREATE POLICY "Anyone can view categories"
  ON public.video_categories FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage categories"
  ON public.video_categories FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === video_progress ===
CREATE POLICY "Users can manage own progress"
  ON public.video_progress FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- === api_keys ===
CREATE POLICY "Users can manage own API keys"
  ON public.api_keys FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- === orders ===
CREATE POLICY "Users can view own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own orders"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === user_daily_trade_count ===
CREATE POLICY "Users can view own counts"
  ON public.user_daily_trade_count FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- === subscriptions ===
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage subscriptions"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === pricing_config (公开读) ===
CREATE POLICY "Anyone can read pricing"
  ON public.pricing_config FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage pricing"
  ON public.pricing_config FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === feature_flags (公开读) ===
CREATE POLICY "Anyone can read feature flags"
  ON public.feature_flags FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage feature flags"
  ON public.feature_flags FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === risk_config (公开读) ===
CREATE POLICY "Anyone can read risk config"
  ON public.risk_config FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage risk config"
  ON public.risk_config FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === admin_settings (公开读) ===
CREATE POLICY "Anyone can read settings"
  ON public.admin_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage settings"
  ON public.admin_settings FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- === admin_logs ===
CREATE POLICY "Admins can view logs"
  ON public.admin_logs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can insert logs"
  ON public.admin_logs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- PART 3: updated_at 触发器
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['videos', 'video_progress', 'api_keys', 'orders',
                         'subscriptions', 'pricing_config', 'feature_flags',
                         'risk_config', 'admin_settings'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I;
      CREATE TRIGGER trg_%s_updated_at
        BEFORE UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    ', replace(t, '_', '_'), t, replace(t, '_', '_'), t);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 4: 索引
-- ============================================================

-- 视频
CREATE INDEX IF NOT EXISTS idx_videos_category ON public.videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_tier ON public.videos(tier_required);
CREATE INDEX IF NOT EXISTS idx_videos_not_deleted ON public.videos(created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_videos_view_count ON public.videos(view_count DESC);

-- 进度
CREATE INDEX IF NOT EXISTS idx_progress_user ON public.video_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_video ON public.video_progress(video_id);
CREATE INDEX IF NOT EXISTS idx_progress_completed ON public.video_progress(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON public.video_progress(user_id, updated_at DESC);

-- 订单
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON public.orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_bingx_id ON public.orders(bingx_order_id);

-- API Keys
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);

-- 订阅
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON public.subscriptions(end_date);

-- Admin 日志
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON public.admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON public.admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON public.admin_logs(target_type, target_id);

-- 每日交易计数
CREATE INDEX IF NOT EXISTS idx_daily_trade_user ON public.user_daily_trade_count(user_id);
