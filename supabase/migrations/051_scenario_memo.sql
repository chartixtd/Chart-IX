-- 场景备忘表：替换掉 screener_alerts 那套状态机
--
-- 旧模型把警报当成一个有生命周期的实体：触发 → 更新 → 连续 3 轮没场景 →
-- 关闭，中间还有「币掉出候选池时原样保留」这条规则。三个毛病：
--
--   1. 关闭计数器只在币被扫描时推进，而「缺席保留」的币不会被扫描，
--      所以那些警报**永远关不掉**。线上实测攒到 23 条，其中 14 条（61%）
--      的币根本不在当前主表里。警报栏只显示 20 条，另外 3 条你完全看不见
--      却一直挂在库里。
--   2. 卡片显示的是库里的状态，而不是「这一轮算出来的结论」，于是卡片
--      可以停在几小时前的判断上，看起来却和新鲜的卡一模一样。
--   3. 一堆机制（close streak / 缺席保留 / 新鲜度标记）全都是为了让一个
--      本该是「当轮视图」的东西假装成「持续跟踪」。
--
-- 新模型：**卡片就是当轮扫描结果的视图**，有场景就显示，场景没了/变了/
-- 被价格打穿失效线就没了。不存在「关闭」这个动作，因此不需要状态机。
--
-- 这张表只剩一个职责：记住「这个结构事件我们最早是什么时候、什么价位
-- 看到的」，好让卡片显示「首次警报价」和「累计变化」。它是**注解**，
-- 不参与决定卡片的去留。
--
-- 钥匙为什么带 swing_now：场景锚在摆动点上，锚点没变就是同一个结构事件
-- （币暂时掉出前 20 又回来，首次价与累计变化能接上，不会重置成 0）；
-- 锚点变了就是新事件，重新计时。这比用时间窗口猜「算不算同一件事」准确。

create table if not exists public.screener_scenario_memo (
  -- symbol|kind|direction|side|swingNow，见 cards.ts 的 memoKey()
  key text primary key,
  -- 冗余存一份，供按 symbol 反查「哪些币有卡片」（选币要给它们留名额）
  symbol text not null,
  -- 首次看到这个结构事件的时刻与当时的价格
  first_seen_at timestamptz not null default now(),
  first_price numeric not null
);

-- 选币阶段要按 symbol 反查，扫描的每一轮都会用到
create index if not exists screener_scenario_memo_symbol_idx
  on public.screener_scenario_memo (symbol);

-- 清理旧备忘用（场景锚点必落在 7 天序列内，更早的备忘不可能再被匹配上）
create index if not exists screener_scenario_memo_age_idx
  on public.screener_scenario_memo (first_seen_at asc);

alter table public.screener_scenario_memo enable row level security;
-- 与 screener_volume_cache 同理：只有 service role 读写，前端从不直接查。
-- RLS 开着 + 无 policy = 除 service role 外一律拒绝，正是想要的。

-- 退役旧的警报状态机。备忘表不需要它的任何数据：卡片改成当轮重算之后，
-- 历史警报既不会被显示，也无法参与新模型（旧行没有 swing_now 这个钥匙）。
drop table if exists public.screener_alerts;

-- 验证：
--   SELECT count(*) FROM public.screener_scenario_memo;
--   SELECT key, symbol, first_price, first_seen_at
--     FROM public.screener_scenario_memo ORDER BY first_seen_at DESC LIMIT 20;
