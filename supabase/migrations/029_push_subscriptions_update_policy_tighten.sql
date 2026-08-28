-- 027 的 UPDATE 策略用 USING (true) 是为了让换账号登录同一设备时的
-- upsert 能重新赋予归属。这条策略让任何登录用户只要拿到别人的 endpoint
-- 字符串，就能用普通 session client 直接改写那一行。
-- 收紧之后，走 anon/session client 的普通用户只能改自己的行。
--
-- 注意：这**不等于**跨账号抢占被堵死了。跨账号重新赋予归属改由 subscribe
-- 路由用 service-role client 完成，而 service-role 绕过 RLS——也就是说这个
-- 能力只是从 RLS 移到了那一个路由里，判断权全在应用层。那里现在是有意允许
-- 转移的（同一设备换人登录是真实场景），代价是登录用户仍可用别人的 endpoint
-- 把订阅行抢过来，只是攻击面从「任意 SQL 写入」缩到了「这一条受控路径 +
-- 一条 console.warn 审计日志」。详见 src/app/api/push/subscribe/route.ts 的注释。
DROP POLICY IF EXISTS "own subscriptions updatable" ON public.push_subscriptions;

CREATE POLICY "own subscriptions updatable"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
