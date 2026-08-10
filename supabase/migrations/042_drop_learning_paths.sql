-- 删除学习路径功能。
--
-- 这个功能从未上线：写这份迁移时 learning_paths 与 learning_path_steps
-- 均为 0 行，前台的入口渲染的是「学习路径即将上线，敬请期待。」——占着
-- 学习页的首屏位置却什么都给不了。用户决定连后台一并删干净，学习页改为
-- 「视频课程 / 文章 / 行业资讯」三个入口。
--
-- 依赖关系：learning_path_steps.path_id -> learning_paths，
-- learning_path_steps.video_id -> videos。没有任何第三方表引用这两张表
-- （quizzes 与它们无关），所以按「先子表后父表」的顺序删即可，不需要 CASCADE。
-- 相关的 RLS 策略与索引随表一起消失。
--
-- 建表见 011_learning_paths.sql；040_security_and_performance_hardening.sql
-- 也曾调整过它们的 RLS 与索引。

drop table if exists public.learning_path_steps;
drop table if exists public.learning_paths;
