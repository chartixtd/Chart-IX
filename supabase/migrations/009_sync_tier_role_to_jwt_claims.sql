-- ============================================================
-- Chart-IX 数据库迁移 #009: 把 tier/role 同步进 auth.users.app_metadata
-- ============================================================
-- 目的: getServerAuth() / AuthProvider 目前每次请求都要:
--   1) auth.getUser()          (校验 JWT，必须保留)
--   2) 再查一次 public.users   (拿 tier/role)
-- 这个触发器把 tier/role 实时同步进 auth.users 的 app_metadata，
-- 这样 getUser() 返回的结果里就直接带有最新 tier/role，
-- 应用层可以跳过第 2 次查询。
--
-- 安全性: 触发器与 public.users 的写入在同一事务内同步更新，
-- 不会出现"改了等级但 app_metadata 没跟上"的滞后窗口；
-- 应用层调用的仍是 auth.getUser()（实时校验），不是本地解码 JWT，
-- 所以不存在"改完等级要等 token 刷新才生效"的问题。
--
-- 本迁移是可选的性能优化、不影响功能: 如果不执行，应用代码会
-- 自动回退到原来的两次查询逻辑，行为完全不变。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_user_claims()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tier', NEW.tier, 'role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP TRIGGER IF EXISTS on_user_tier_role_change ON public.users;
CREATE TRIGGER on_user_tier_role_change
  AFTER INSERT OR UPDATE OF tier, role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_claims();

-- 回填所有现存用户 (UPDATE OF tier/role 触发器只要列出现在 SET 里就会触发，
-- 不要求值真的变化，所以下面这句会让所有行都跑一遍同步函数)
UPDATE public.users SET tier = tier, role = role;
