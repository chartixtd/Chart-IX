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
-- 没有改 direction 列的 check 约束（仍然只允许 'long'/'short'）：
-- 场景可能出现的第三种方向 manage（存量清算）不落进这一列，只存在于
-- scenario jsonb 里的 direction 字段——direction 列继续存 ScannerRow
-- 的兜底方向（manage 场景已经在 pipeline.ts 里退回分数方向），
-- peakPct/累计涨跌该不该翻号看的是 scenario.direction，不是这一列。
-- 完整推导见 T22 报告。

alter table public.screener_alerts
  add column if not exists scenario jsonb;

-- 验证：
--   SELECT symbol, direction, trigger_score, scenario, triggered_at
--     FROM public.screener_alerts ORDER BY triggered_at DESC LIMIT 20;
--   -- 老警报 scenario 应为 NULL；T22 上线之后新开的警报 scenario 应
--   -- 是形如 {"kind":"healthy_trend","direction":"long","trap":false,...} 的对象。
