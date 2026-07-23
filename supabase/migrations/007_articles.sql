-- Articles system: categories + articles

-- Article categories (same pattern as video_categories)
CREATE TABLE public.article_categories (
  id          SERIAL PRIMARY KEY,
  name        JSONB NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Articles table
CREATE TABLE public.articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,
  title         JSONB NOT NULL,
  content       JSONB NOT NULL DEFAULT '{}',
  category_id   INTEGER REFERENCES public.article_categories(id) ON DELETE SET NULL,
  cover_image   TEXT,
  author_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_required TEXT NOT NULL DEFAULT 'free' CHECK (tier_required IN ('free', 'pro')),
  view_count    INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- Public: anyone can read published articles
CREATE POLICY "Public read articles"
  ON public.articles FOR SELECT
  USING (is_published = true);

-- Public: anyone can read categories
CREATE POLICY "Public read categories"
  ON public.article_categories FOR SELECT
  USING (true);

-- Seed categories
INSERT INTO public.article_categories (name, slug, sort_order) VALUES
  ('{"en-US":"Market Analysis","zh-CN":"市场分析","ms-MY":"Analisis Pasaran"}', 'market-analysis', 1),
  ('{"en-US":"Trading Guide","zh-CN":"交易指南","ms-MY":"Panduan Dagangan"}', 'trading-guide', 2),
  ('{"en-US":"Project Research","zh-CN":"项目研究","ms-MY":"Penyelidikan Projek"}', 'project-research', 3),
  ('{"en-US":"News","zh-CN":"行业资讯","ms-MY":"Berita"}', 'news', 4);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION update_articles_updated_at();

-- Insert feature flag
INSERT INTO public.feature_flags (feature_key, feature_group, display_name, description, free_enabled, pro_enabled) VALUES
  ('articles', 'content', '{"zh-CN":"文章","en-US":"Articles","ms-MY":"Artikel"}', '{"zh-CN":"浏览文章","en-US":"Browse articles","ms-MY":"Lihat artikel"}', true, true)
ON CONFLICT (feature_key) DO NOTHING;
