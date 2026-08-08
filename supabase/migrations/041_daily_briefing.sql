-- Chart-IX 数据库迁移 #041: 每日 AI 市场早报
--
-- 注意：不要往 feature_flags 写任何东西——该表已在 038 迁移中删除
-- （007_articles.sql 里那句 INSERT INTO feature_flags 是历史遗留）。

-- ── 早报独立分类 ──────────────────────────────────────────
-- 每天一篇，塞进现有「市场分析」会把手写文章淹掉；
-- 独立分类同时天然成为早报归档页。sort_order 取 0 排在最前。
INSERT INTO public.article_categories (name, slug, sort_order) VALUES
  ('{"en-US":"Daily Briefing","zh-CN":"每日早报","ms-MY":"Taklimat Harian"}', 'daily-briefing', 0)
ON CONFLICT (slug) DO NOTHING;

-- ── 早报推送开关 ──────────────────────────────────────────
-- 默认关闭：每天一条推送对用户是打扰，先观察若干天内容质量再手动打开。
-- admin_settings 是通用键值表（key TEXT UNIQUE + value JSONB，见 004）。
INSERT INTO public.admin_settings (key, value, description) VALUES
  ('daily_briefing_push_enabled', 'false'::jsonb, '每日早报发布后是否推送通知')
ON CONFLICT (key) DO NOTHING;
