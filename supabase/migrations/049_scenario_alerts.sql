-- ============================================================
-- Chart-IX 数据库迁移 #049: 警报表加场景判定列
-- ============================================================
-- 背景：screener 警报从「总分越过 70/65 两条线」改成「场景驱动」
-- （src/lib/screener/alerts.ts）——触发条件变成「检测到六场景之一」，
-- 不再看 trigger_score/total。这条迁移只做一件事：给
-- screener_alerts 加一列存完整的场景判定结果。
--
-- 用 jsonb 而不是拆成 kind/direction/trap/... 好几列：场景的字段集
-- 还在演化（后续 MSS 任务可能会加字段），拆列每改一次都要迁移；
-- jsonb 让应用层（factors/scenario.ts 的 Scenario 类型）自己定义字段，
-- 数据库这边不用跟着每次改动。
--
-- 老警报（这条迁移之前开的）这一列是 null——应用层（alerts-store.ts
-- 的 parseScenario）把 null 和「解析失败」同等对待，统一按「无场景」
-- 处理，前端沿用旧样式卡片渲染，不会因为这一列缺失而报错。
--
-- ── 评审 F2 修复 ─────────────────────────────────────────
-- 这条迁移最初的版本没有碰 direction 列的 check 约束，让 direction
-- 继续只存分数兜底方向（long/short）、manage 只活在 scenario jsonb 里。
-- 评审指出这是双轨来源的 bug：AlertCard 的徽章读 direction 列渲染
-- LONG/SHORT，currentPct 的符号却读 scenario.direction（可能是
-- manage）——分数兜底恰好是 short 时，徽章显示 SHORT，涨跌却按
-- manage 不翻号，价格涨了显示绿色正数，跟"做空"的语义直接打架。
--
-- 这条迁移在任何环境都还没跑过，直接在这里改，不再另开一条迁移：
-- direction 列从此存"有效方向"（有场景时是 scenario.direction，
-- 含 manage；无场景时是分数兜底方向），跟 currentPct/peakPct 的符号
-- 同一个来源，不会再分裂成两套。

alter table public.screener_alerts
  add column if not exists scenario jsonb;

alter table public.screener_alerts drop constraint if exists screener_alerts_direction_check;
alter table public.screener_alerts
  add constraint screener_alerts_direction_check
  check (direction in ('long','short','manage'));

-- 验证：
--   SELECT symbol, direction, trigger_score, scenario, triggered_at
--     FROM public.screener_alerts ORDER BY triggered_at DESC LIMIT 20;
--   -- 老警报 scenario 应为 NULL；T22 上线之后新开的警报 scenario 应
--   -- 是形如 {"kind":"healthy_trend","direction":"long","trap":false,...} 的对象，
--   -- 且 direction 列在 scenario.direction 是 manage 时也应该是 'manage'。
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conrelid = 'public.screener_alerts'::regclass;
--   -- screener_alerts_direction_check 应该显示 CHECK (direction = ANY (ARRAY['long','short','manage']))。
