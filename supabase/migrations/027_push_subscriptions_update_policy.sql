-- push_subscriptions 的 upsert（onConflict: "endpoint"）在冲突时会走 UPDATE 分支，
-- 026 迁移只给了 SELECT/INSERT/DELETE 策略，导致重新订阅（换设备/换账号登录同一设备）
-- 时 UPDATE 被 RLS 默认拒绝，报错而不是按预期重新赋予归属。
CREATE POLICY "own subscriptions updatable"
  ON public.push_subscriptions FOR UPDATE
  USING (true)
  WITH CHECK (auth.uid() = user_id);
