-- 删除「项目研究」文章分类。
--
-- 用户要求把文章分类栏里的「项目研究」去掉。写这份迁移时该分类下有 0 篇文章
-- （article_categories.id = 3, slug = 'project-research'），所以删掉不会让任何
-- 文章失去分类，也不会触发 articles.category_id 的外键。
--
-- 按 slug 而不是按 id 删：id 是自增主键，在别的环境里不保证是 3；slug 是
-- 007_articles.sql 里种下的稳定标识。
--
-- 种子行见 007_articles.sql:47。

delete from public.article_categories where slug = 'project-research';
