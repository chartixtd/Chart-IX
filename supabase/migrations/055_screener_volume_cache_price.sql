-- 成交量缓存加一列参考价，用来识别「代号撞车」
--
-- 背景：主扫描表加了代币化的大宗商品与美股之后，BingX 的 symbol 要映射成
-- CoinGlass 的币名才能拉 OI 与 CVD。绝大多数直接同名，但有一类会**静默拿到
-- 完全不相干的数据**——代号跟真实币种撞了：
--
--   BingX NCSKCVX2USD-USDT = 雪佛龙（股票），报价 $212.11
--   CoinGlass CVX          = Convex Finance（加密货币），报价 $2.127
--
-- 这种情况不报错、不缺字段，只是整行的持仓量与资金流是另一个标的的。
-- universe.ts 里的 NC_COIN_ALIAS 处理了三个**已知**的（QNT→QNTX、
-- STX→STXX、BB→BBX，那是 CoinGlass 自己改了号的），但黑名单管不住
-- 将来新上的标的，而 BingX 每周都在上新。
--
-- 判据用价格：同一个标的在两边的报价必然接近，不同标的通常差一个数量级。
-- 实测 338 个代币化标的里，这条判据挑出的错配正好是上面那一个。
--
-- 参考价从哪来：轮转刷新本来就在逐个调 pairs-markets 取成交额，
-- 那个响应里每一行都带 current_price。**零额外调用**，顺手存下来。
--
-- 为什么可以用半小时前的价：这条判据识别的是 99% 量级的偏离，
-- 不是 1% 量级的漂移。阈值定得很松（见 universe.ts 的 PRICE_SANITY_MAX_DEV），
-- 松到任何真实的行情波动都不会误伤。

alter table public.screener_volume_cache
  add column if not exists price numeric;

comment on column public.screener_volume_cache.price is
  'CoinGlass pairs-markets 各交易所 current_price 的中位数。'
  '用来跟 BingX 报价对照，识别代号撞车。null = 还没刷到过，此时不做这道校验。';

-- 验证：
--   SELECT coin, volume_usd/1e6 AS vol_m, price, updated_at
--     FROM public.screener_volume_cache
--    WHERE price IS NOT NULL ORDER BY updated_at DESC LIMIT 10;
