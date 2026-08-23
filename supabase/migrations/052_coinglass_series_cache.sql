-- 图表用 CoinGlass 序列的跨实例缓存
--
-- 背景：K 线图新增了两个来自 CoinGlass 的指标（聚合持仓量 OI、聚合 CVD），
-- 数据按 (kind, coin, interval) 逐组合向 CoinGlass 拉 1000 根。CoinGlass 的
-- 配额是每分钟 75 次，且与选币器共用（选币器每轮 72 次、15 分钟一轮）。
-- Vercel 每个 lambda 的内存互不可见，只靠进程内缓存的话，冷启动实例会各自
-- 再打一次上游，几个用户同时看图就可能把选币器那一轮的配额挤掉。
--
-- 这张表让所有实例共享「上次拉到的数据 + 拉到的时刻」：TTL 内（30m 周期
-- 5 分钟、1h 10 分钟、日线 4 小时，见 src/lib/chart/external-series.ts 的
-- externalSeriesTtlMs）每个组合全站只打一次上游。
--
-- 代码对这张表的缺席是容忍的：读失败当 miss、写失败只记录，退化成纯内存
-- 缓存——所以迁移没跑功能也能用，只是配额保护弱一层。

create table if not exists public.coinglass_series_cache (
  -- "<kind>:<coin>:<interval>"，如 "oi:BTC:30m"
  key text primary key,
  -- 归一化后的序列（时间戳为秒），结构见 src/lib/chart/external-series.ts
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.coinglass_series_cache enable row level security;

-- 刻意不建任何 policy：只有服务端（service role）读写，前端从不直接查它。
-- RLS 开着 + 无 policy = 除 service role 外一律拒绝。

-- 验证：
--   SELECT key, jsonb_array_length(payload) AS bars, fetched_at
--     FROM public.coinglass_series_cache ORDER BY fetched_at DESC LIMIT 20;
