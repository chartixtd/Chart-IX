-- Completely rebuild all RLS policies to fix infinite recursion
-- Step 1: Drop ALL existing policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- Step 2: users - simple policy using auth.uid() only (NO subquery that causes recursion)
CREATE POLICY "users_read_own" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "users_insert_auth" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Step 3: videos - public read non-deleted, service_role handles admin writes
CREATE POLICY "videos_read_public" ON public.videos
  FOR SELECT USING (is_deleted = false);

-- Step 4: video_categories - public read all
CREATE POLICY "categories_read_public" ON public.video_categories
  FOR SELECT USING (true);

-- Step 5: video_progress - users manage own
CREATE POLICY "progress_select_own" ON public.video_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "progress_all_own" ON public.video_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "progress_update_own" ON public.video_progress
  FOR UPDATE USING (auth.uid() = user_id);

-- Step 6: admin_settings - public read
CREATE POLICY "settings_read_public" ON public.admin_settings
  FOR SELECT USING (true);

-- Step 7: pricing_config - public read active
CREATE POLICY "pricing_read_public" ON public.pricing_config
  FOR SELECT USING (is_active = true);

-- Step 8: feature_flags - public read
CREATE POLICY "features_read_public" ON public.feature_flags
  FOR SELECT USING (true);

-- Step 9: api_keys - user manages own
CREATE POLICY "apikeys_read_own" ON public.api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "apikeys_insert_own" ON public.api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "apikeys_delete_own" ON public.api_keys
  FOR DELETE USING (auth.uid() = user_id);

-- Step 10: orders - user reads own
CREATE POLICY "orders_read_own" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "orders_insert_own" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Step 11: subscriptions - user reads own
CREATE POLICY "subs_read_own" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Step 12: user_daily_trade_count - user reads own
CREATE POLICY "trades_read_own" ON public.user_daily_trade_count
  FOR SELECT USING (auth.uid() = user_id);
