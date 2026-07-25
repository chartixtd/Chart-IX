-- ============================================================
-- Chart-IX 数据库迁移 #017: 用户偏好设置
-- ============================================================
-- 用 JSONB 存任意偏好键值（交易页 symbol/interval/market/tab、自选、
-- 价格提醒、界面偏好等），登录用户跨设备同步。未登录用户仍走 localStorage。

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_preferences IS '用户偏好设置，JSONB 存任意键值，登录用户跨设备同步';
COMMENT ON COLUMN public.user_preferences.preferences IS '偏好键值集合: trade(symbol/interval/market/rightTab)、favorites、priceAlerts、ui 等';

-- updated_at 自动更新（复用 001 中的 update_modified_column 函数）
DROP TRIGGER IF EXISTS update_user_preferences_modtime ON public.user_preferences;
CREATE TRIGGER update_user_preferences_modtime
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

-- RLS：登录用户只能读写自己的行
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
