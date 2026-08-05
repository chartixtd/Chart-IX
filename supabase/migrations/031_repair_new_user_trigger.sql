-- ============================================================
-- Chart-IX 数据库迁移 #031: 修复失效的自动建档触发器 + 补录孤儿账号
-- ============================================================
-- 诊断发现至少一个用户（2026-07-22 注册）在 auth.users 里已确认邮箱，
-- 但 public.users 里完全没有对应记录——001_create_users.sql 里建的
-- on_auth_user_created 触发器要么已经不存在，要么执行时失败了。
--
-- 这里用 CREATE OR REPLACE + DROP TRIGGER IF EXISTS 幂等重建，跑几次
-- 都安全；然后把所有"auth.users 里有、public.users 里没有"的孤儿账号
-- 一次性补录进去，新账号用邮箱前缀当默认显示名，跟触发器函数里的
-- 默认逻辑保持一致。

-- 1. 重建触发器函数（跟 001_create_users.sql 内容一致，防止是函数体本身跑丢了）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 重建触发器本身（防止是触发器绑定丢了，函数还在但没人调用它）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. 补录所有现存的孤儿账号（已经在 auth.users 但从没进过 public.users 的）
INSERT INTO public.users (id, email, display_name, avatar_url, created_at)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'display_name', split_part(au.email, '@', 1)),
  au.raw_user_meta_data->>'avatar_url',
  au.created_at
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;
