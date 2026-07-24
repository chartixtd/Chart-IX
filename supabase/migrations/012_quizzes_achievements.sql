-- ============================================================
-- Chart-IX 数据库迁移 #012: 随堂小测 + 成就徽章
-- ============================================================
-- 小测: 挂在某个视频课程下的单选题小测验，纯前端算分，记录一次尝试。
-- 成就: 预置一批里程碑徽章 (纯荣誉，不发放实际权益)，命中里程碑时
-- 由对应的业务代码 (下单成功/完成学习路径等) 调用 grant_achievement() 授予。

-- 1. 小测
CREATE TABLE public.quizzes (
  id          SERIAL PRIMARY KEY,
  video_id    UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  title       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id)
);
COMMENT ON TABLE public.quizzes IS '挂在视频课程下的随堂小测，一个视频最多一个小测';

CREATE TABLE public.quiz_questions (
  id             SERIAL PRIMARY KEY,
  quiz_id        INTEGER NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question       JSONB NOT NULL,   -- Record<Locale, string>
  options        JSONB NOT NULL,   -- Record<Locale, string[]>
  correct_index  INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_quiz_questions_quiz ON public.quiz_questions(quiz_id, sort_order);

CREATE TABLE public.quiz_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  quiz_id     INTEGER NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  passed      BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quiz_attempts_user ON public.quiz_attempts(user_id, quiz_id);

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

-- correct_index 也会随 SELECT 一起返回给客户端 (在这个体量下用客户端算分足够，
-- 不值得为了防"看源码猜答案"这种低风险场景多建一个批改用的 Edge Function)
CREATE POLICY "Anyone can view quizzes" ON public.quizzes FOR SELECT USING (true);
CREATE POLICY "Anyone can view quiz questions" ON public.quiz_questions FOR SELECT USING (true);
CREATE POLICY "Admins can manage quizzes" ON public.quizzes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can manage quiz questions" ON public.quiz_questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view own quiz attempts" ON public.quiz_attempts FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can record own quiz attempts" ON public.quiz_attempts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- 2. 成就徽章 (预置里程碑，纯荣誉)
CREATE TABLE public.achievements (
  key          TEXT PRIMARY KEY,
  title        JSONB NOT NULL,
  description  JSONB,
  icon         TEXT NOT NULL DEFAULT '🏆',
  sort_order   INTEGER NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.achievements IS '成就定义 (预置，管理员暂不可编辑，纯荣誉不发放权益)';

CREATE TABLE public.user_achievements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  achievement_key  TEXT NOT NULL REFERENCES public.achievements(key) ON DELETE CASCADE,
  earned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_key)
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view achievement definitions" ON public.achievements FOR SELECT USING (true);
CREATE POLICY "Users can view own earned achievements" ON public.user_achievements FOR SELECT
  USING (auth.uid() = user_id);

-- 授予成就 (幂等: 已获得则直接返回，不重复插入/报错)
CREATE OR REPLACE FUNCTION public.grant_achievement(p_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  already_has BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_achievements
    WHERE user_id = auth.uid() AND achievement_key = p_key
  ) INTO already_has;

  IF already_has THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_achievements (user_id, achievement_key)
  VALUES (auth.uid(), p_key);
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. 自动授予成就的挂钩
-- ------------------------------------------------------------

-- 视频首次看完 -> first_video_completed (挂在 video_progress 的完成触发器上，
-- 不管是哪个代码路径把 completed 改成 true 都会触发，比在各处客户端调用更可靠)
CREATE OR REPLACE FUNCTION public.grant_first_video_achievement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.completed = true AND (OLD IS NULL OR OLD.completed = false) THEN
    INSERT INTO public.user_achievements (user_id, achievement_key)
    VALUES (NEW.user_id, 'first_video_completed')
    ON CONFLICT (user_id, achievement_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_video_progress_completed ON public.video_progress;
CREATE TRIGGER on_video_progress_completed
  AFTER INSERT OR UPDATE OF completed ON public.video_progress
  FOR EACH ROW EXECUTE FUNCTION public.grant_first_video_achievement();

-- 模拟盘首次下单 -> first_paper_trade (直接在下单函数里补一句授予,
-- 与 supabase/migrations/010_paper_trading.sql 定义的 place_paper_order 保持行为一致,
-- 这里用 CREATE OR REPLACE 追加逻辑而不回头改已"发布"的 010 迁移文件)
CREATE OR REPLACE FUNCTION public.place_paper_order(
  p_symbol TEXT,
  p_side TEXT,
  p_quantity NUMERIC,
  p_price NUMERIC
)
RETURNS public.paper_orders AS $$
DECLARE
  acc public.paper_accounts;
  holding public.paper_holdings;
  v_total_value NUMERIC(20, 8);
  v_realized_pnl NUMERIC(20, 8) := NULL;
  v_new_qty NUMERIC(20, 8);
  v_new_avg_price NUMERIC(20, 8);
  v_order public.paper_orders;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'invalid side';
  END IF;
  IF p_quantity <= 0 OR p_price <= 0 THEN
    RAISE EXCEPTION 'quantity and price must be positive';
  END IF;

  v_total_value := p_quantity * p_price;

  SELECT * INTO acc FROM public.paper_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.paper_accounts (user_id) VALUES (auth.uid())
    RETURNING * INTO acc;
  END IF;

  SELECT * INTO holding FROM public.paper_holdings
    WHERE account_id = acc.id AND symbol = p_symbol FOR UPDATE;

  IF p_side = 'buy' THEN
    IF acc.balance_usdt < v_total_value THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;

    IF NOT FOUND THEN
      v_new_qty := p_quantity;
      v_new_avg_price := p_price;
      INSERT INTO public.paper_holdings (account_id, symbol, quantity, avg_entry_price)
        VALUES (acc.id, p_symbol, v_new_qty, v_new_avg_price);
    ELSE
      v_new_qty := holding.quantity + p_quantity;
      v_new_avg_price := (holding.quantity * holding.avg_entry_price + v_total_value) / v_new_qty;
      UPDATE public.paper_holdings
        SET quantity = v_new_qty, avg_entry_price = v_new_avg_price, updated_at = NOW()
        WHERE id = holding.id;
    END IF;

    UPDATE public.paper_accounts
      SET balance_usdt = balance_usdt - v_total_value, updated_at = NOW()
      WHERE id = acc.id
      RETURNING * INTO acc;

  ELSE -- sell
    IF NOT FOUND OR holding.quantity < p_quantity THEN
      RAISE EXCEPTION 'insufficient_holding';
    END IF;

    v_realized_pnl := (p_price - holding.avg_entry_price) * p_quantity;
    v_new_qty := holding.quantity - p_quantity;

    IF v_new_qty = 0 THEN
      DELETE FROM public.paper_holdings WHERE id = holding.id;
    ELSE
      UPDATE public.paper_holdings
        SET quantity = v_new_qty, updated_at = NOW()
        WHERE id = holding.id;
    END IF;

    UPDATE public.paper_accounts
      SET balance_usdt = balance_usdt + v_total_value, updated_at = NOW()
      WHERE id = acc.id
      RETURNING * INTO acc;
  END IF;

  INSERT INTO public.paper_orders (account_id, symbol, side, quantity, price, total_value, realized_pnl, balance_after)
    VALUES (acc.id, p_symbol, p_side, p_quantity, p_price, v_total_value, v_realized_pnl, acc.balance_usdt)
    RETURNING * INTO v_order;

  INSERT INTO public.user_achievements (user_id, achievement_key)
    VALUES (auth.uid(), 'first_paper_trade')
    ON CONFLICT (user_id, achievement_key) DO NOTHING;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 预置成就
INSERT INTO public.achievements (key, title, description, icon, sort_order) VALUES
  ('first_login', '{"zh-CN":"新的开始","en-US":"New Beginning","ms-MY":"Permulaan Baharu"}',
   '{"zh-CN":"完成注册，开启交易学习之旅","en-US":"Signed up and started your trading journey","ms-MY":"Mendaftar dan memulakan perjalanan dagangan anda"}',
   '🌱', 1),
  ('first_video_completed', '{"zh-CN":"第一课","en-US":"First Lesson","ms-MY":"Pelajaran Pertama"}',
   '{"zh-CN":"完成第一个视频课程","en-US":"Completed your first video lesson","ms-MY":"Melengkapkan pelajaran video pertama anda"}',
   '📚', 2),
  ('first_path_completed', '{"zh-CN":"学有所成","en-US":"Path Completed","ms-MY":"Laluan Selesai"}',
   '{"zh-CN":"完成一整条学习路径","en-US":"Completed an entire learning path","ms-MY":"Melengkapkan keseluruhan laluan pembelajaran"}',
   '🎓', 3),
  ('first_paper_trade', '{"zh-CN":"初次交易","en-US":"First Trade","ms-MY":"Dagangan Pertama"}',
   '{"zh-CN":"在模拟盘完成第一笔交易","en-US":"Placed your first paper trade","ms-MY":"Membuat dagangan simulasi pertama anda"}',
   '📈', 4),
  ('first_quiz_passed', '{"zh-CN":"学以致用","en-US":"Quiz Passed","ms-MY":"Kuiz Lulus"}',
   '{"zh-CN":"通过第一次随堂小测","en-US":"Passed your first quiz","ms-MY":"Lulus kuiz pertama anda"}',
   '✅', 5)
ON CONFLICT (key) DO NOTHING;
