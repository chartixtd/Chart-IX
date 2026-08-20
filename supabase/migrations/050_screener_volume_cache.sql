-- 全池成交量缓存
--
-- 背景：成交量门槛（SERVER_GATE.minVolumeUsd = 2000万）问的是「这个币在
-- 全市场好不好进出」，而 CoinGlass 的真实成交量只能逐币调 pairs-markets 拿，
-- 1 次/币。全池 250 多个币，一轮扫描的配额（75 次/分钟）根本装不下，
-- 所以此前这条门槛只能在明细层执行——只对已经被选中的那十几个币生效。
-- 后果是名额被浪费：选中了，进来才发现成交量不达标，这一轮就少一行。
--
-- 这张表把「成交量」从扫描的关键路径上摘下来：cron 每 5 分钟打一次而扫描
-- 间隔是 15 分钟，三次里有两次此前直接 skipped 走人，现在那两次拿去轮转
-- 刷成交量（每次约 60 个，挑最旧的刷）。250 多个币约半小时刷一遍。
--
-- 为什么半小时的新鲜度够用：这是 **24 小时**成交量，本身就是个慢变量，
-- 半小时前的值和此刻的值不会跨过 2000 万这条线两次。真正需要新鲜的是
-- 价格与 OI/CVD，那些仍然在扫描时实时取。
--
-- 这张表出现之后，明细层就不再需要 pairs-markets 了（它此前唯一的作用
-- 就是取成交量和 BingX 合约 id），每个币从 4 次调用降到 3 次，
-- 深度扫描名额随之从 18 变成 24。

create table if not exists public.screener_volume_cache (
  -- CoinGlass 口径的币名（已抹平 -USDT 后缀与 1000x 合约乘数前缀）
  coin text primary key,
  -- 全交易所 volume_usd 之和，美元
  volume_usd numeric not null,
  updated_at timestamptz not null default now()
);

-- 轮转刷新每次挑「最旧的 N 个」，这条索引是那次查询的唯一依据
create index if not exists screener_volume_cache_stale_idx
  on public.screener_volume_cache (updated_at asc);

alter table public.screener_volume_cache enable row level security;

-- 刻意不建任何 policy：这张表只有服务端（service role）读写，
-- 前端从不直接查它。RLS 开着 + 无 policy = 除 service role 外一律拒绝，
-- 这正是想要的。加一条 "public read" 只会扩大暴露面而没有任何用处。

-- 验证：
--   SELECT count(*), min(updated_at), max(updated_at) FROM public.screener_volume_cache;
--   SELECT coin, volume_usd/1e6 AS vol_m, updated_at
--     FROM public.screener_volume_cache ORDER BY updated_at ASC LIMIT 10;
