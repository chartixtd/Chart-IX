-- ============================================================
-- Chart-IX 数据库迁移 #001: 用户表 + 自动创建触发器 + RLS
-- ============================================================

-- 1. 用户业务数据表
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  avatar_url    TEXT,

  -- 角色与等级
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('user', 'admin')),
  tier          TEXT NOT NULL DEFAULT 'free'
                CHECK (tier IN ('free', 'pro')),

  -- 偏好设置
  language      TEXT NOT NULL DEFAULT 'en-US'
                CHECK (language IN ('zh-CN', 'en-US', 'ms-MY')),

  -- 状态
  is_disabled   BOOLEAN NOT NULL DEFAULT false,
  disabled_at   TIMESTAMPTZ,
  disabled_reason TEXT,

  -- Pro到期时间 (Admin手动设置)
  pro_expires_at TIMESTAMPTZ,

  -- 时间戳
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS '用户业务数据，关联 auth.users';
COMMENT ON COLUMN public.users.role IS '用户角色: user=普通用户, admin=管理员';
COMMENT ON COLUMN public.users.tier IS '用户等级: free=免费, pro=专业';
COMMENT ON COLUMN public.users.language IS '语言偏好: zh-CN, en-US, ms-MY';
COMMENT ON COLUMN public.users.is_disabled IS '是否被禁用';
COMMENT ON COLUMN public.users.pro_expires_at IS 'Pro到期时间，过期后自动降为free';

-- 2. 自动创建用户资料触发器
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. 更新时间戳函数
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_modtime ON public.users;
CREATE TRIGGER update_users_modtime
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

-- 4. RLS 策略
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 用户可读自己的资料
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- 用户可更新自己的非敏感字段
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = 'user'           -- 不能自己改role
    AND tier = 'free'           -- 不能自己改tier
    AND is_disabled = false     -- 不能自己改禁用状态
  );

-- 管理员可读所有用户
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 管理员可更新所有用户
CREATE POLICY "Admins can update all users"
  ON public.users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
    )
  );
