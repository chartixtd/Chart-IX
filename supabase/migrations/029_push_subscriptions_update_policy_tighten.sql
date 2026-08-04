-- 027 的 UPDATE 策略用 USING (true) 是为了让换账号登录同一设备时的
-- upsert 能重新赋予归属，但这个宽松条件本身就是权限漏洞——任何登录用户
-- 只要拿到别人的 endpoint 字符串就能抢占或破坏那一行。
-- 跨账号重新赋予归属现在改由 subscribe 路由用 service-role client 完成
-- （在应用层 auth.getUser() 校验通过之后），RLS 这里只需要保证
-- 普通用户走 anon/session client 时只能改自己的行。
DROP POLICY IF EXISTS "own subscriptions updatable" ON public.push_subscriptions;

CREATE POLICY "own subscriptions updatable"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
