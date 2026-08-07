-- ============================================================
-- Chart-IX 数据库迁移 #039: 把 display_name 也同步进 auth.users.app_metadata
-- ============================================================
-- 009 已把 tier/role 同步进 app_metadata，但 getServerAuth()/AuthProvider
-- 仍要为 display_name 单独多查一次 public.users。本迁移把 display_name
-- 加入同一个同步函数与触发器，使 auth.getUser() 一次往返带回全部信息，
-- 应用层可彻底删除第二次查询。
--
-- 与 009 相同的安全性：触发器与 public.users 写入同事务，无滞后窗口；
-- settings 页 / admin 后台改昵称都会即时同步，应用层无需双写。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_user_claims()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'tier', NEW.tier,
         'role', NEW.role,
         'display_name', NEW.display_name
       )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP TRIGGER IF EXISTS on_user_tier_role_change ON public.users;
CREATE TRIGGER on_user_tier_role_change
  AFTER INSERT OR UPDATE OF tier, role, display_name ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_claims();

-- 回填所有现存用户（UPDATE OF 列出的列出现在 SET 里即触发，不要求值变化）
UPDATE public.users SET display_name = display_name;
