-- ============================================================
-- Chart-IX 数据库迁移: 剩余 RLS + 视频/订阅/索引 修复
-- ============================================================

-- ============================================================
-- PART 1: 剩余 RLS 策略 (videos/categories/progress 已在002, trading已在006)
-- ============================================================

-- subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage subscriptions"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- pricing_config
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read pricing"
  ON public.pricing_config FOR SELECT USING (true);
CREATE POLICY "Admins can manage pricing"
  ON public.pricing_config FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- feature_flags
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read feature flags"
  ON public.feature_flags FOR SELECT USING (true);
CREATE POLICY "Admins can manage feature flags"
  ON public.feature_flags FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- risk_config
ALTER TABLE public.risk_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read risk config"
  ON public.risk_config FOR SELECT USING (true);
CREATE POLICY "Admins can manage risk config"
  ON public.risk_config FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- admin_settings
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read settings"
  ON public.admin_settings FOR SELECT USING (true);
CREATE POLICY "Admins can manage settings"
  ON public.admin_settings FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- admin_logs
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view logs"
  ON public.admin_logs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can insert logs"
  ON public.admin_logs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- PART 2: updated_at 触发器 (已有表的)
-- ============================================================

-- videos (002 already has it, but safe)
DROP TRIGGER IF EXISTS trg_videos_updated_at ON public.videos;
CREATE TRIGGER trg_videos_updated_at
  BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- video_progress
DROP TRIGGER IF EXISTS trg_video_progress_updated_at ON public.video_progress;
CREATE TRIGGER trg_video_progress_updated_at
  BEFORE UPDATE ON public.video_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- subscriptions
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- pricing_config
DROP TRIGGER IF EXISTS trg_pricing_config_updated_at ON public.pricing_config;
CREATE TRIGGER trg_pricing_config_updated_at
  BEFORE UPDATE ON public.pricing_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- feature_flags
DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- risk_config
DROP TRIGGER IF EXISTS trg_risk_config_updated_at ON public.risk_config;
CREATE TRIGGER trg_risk_config_updated_at
  BEFORE UPDATE ON public.risk_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- admin_settings
DROP TRIGGER IF EXISTS trg_admin_settings_updated_at ON public.admin_settings;
CREATE TRIGGER trg_admin_settings_updated_at
  BEFORE UPDATE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- PART 3: 剩余索引
-- ============================================================

-- 视频索引
CREATE INDEX IF NOT EXISTS idx_videos_category ON public.videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_tier ON public.videos(tier_required);
CREATE INDEX IF NOT EXISTS idx_videos_not_deleted ON public.videos(created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_videos_view_count ON public.videos(view_count DESC);

-- 进度索引
CREATE INDEX IF NOT EXISTS idx_progress_user ON public.video_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_video ON public.video_progress(video_id);
CREATE INDEX IF NOT EXISTS idx_progress_completed ON public.video_progress(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON public.video_progress(user_id, updated_at DESC);

-- 订阅索引
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON public.subscriptions(end_date);

-- Admin 日志索引
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON public.admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON public.admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON public.admin_logs(target_type, target_id);
