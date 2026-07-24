-- ============================================================
-- Chart-IX 数据库迁移 #013: Onboarding 状态
-- ============================================================
-- 记在 users 表而不是 localStorage，这样换设备登录也不会被重复打扰。

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS experience_level TEXT CHECK (experience_level IN ('beginner', 'experienced'));

COMMENT ON COLUMN public.users.onboarding_completed IS '是否已完成首次登录引导';
COMMENT ON COLUMN public.users.experience_level IS 'Onboarding 时用户自选的交易经验水平';
