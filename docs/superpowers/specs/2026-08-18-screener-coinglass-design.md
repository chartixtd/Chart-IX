# Screener 重构：CoinGlass 四因子扫描器

日期：2026-08-18
状态：已定稿，待实施

## 背景与目标

现有 screener（`src/lib/screener-scoring.ts` 428 行 + `src/lib/screener-server.ts` 226 行）用
BingX 合约/现货 ticker + CoinGecko 市值算一套 6 维加权分（市值 25%、振幅 20%、资金费率 20%、
OI 量比 15%、动量 10%、位置 10%），按「方向分差 edge」排出 long/short 各 10 个，每小时算一次。

`scanner_demo.html` 定义了新标准：**四因子扫描器** —— Zone 30 / Sweep 20 / OI 30 / CVD 20 = 100 分，
总分从 <80 首次突破 ≥80 时触发警报、锁定当时价格并持续追踪累计涨跌幅。

本次改造：

1. 数据源从 BingX + CoinGecko 换成 **CoinGlass v4**（BingX 仅保留为可交易白名单，CoinGecko 仅保留市值）
2. 打分模型整体换成四因子，6 维模型退役
3. 扫描周期从 1 小时缩短到 15 分钟
4. 新增警报持久化子系统与 Telegram 推送
5. 界面按 demo 重做：单表 + 方向 pill + 因子构成柱 + 右侧警报栏 + 三个客户端滑块

## 上游能力实测结论

CoinGlass API key 的套餐经服务端确认为 **STARTUP**（403 响应体里直接返回 `"current_plan":"STARTUP"`）。

### 可用

| 数据 | 端点 | 批量 |
|---|---|---|
| 币种全集 | `/api/futures/supported-coins` | 是 |
| 单币全交易所行情/OI/资金费率/多空成交额/24h 爆仓 | `/api/futures/pairs-markets?symbol=` | 否 |
| OHLCV | `/api/futures/price/history` | 否 |
| 主动买卖量 | `/api/futures/taker-buy-sell-volume/history` | 否 |
| 持仓量快照（5m/15m/30m/1h/4h/24h 变化率） | `/api/futures/open-interest/exchange-list?symbol=` | 否 |
| 持仓量序列 | `/api/futures/open-interest/history` | 否 |
| 全币爆仓 1h/4h/12h/24h | `/api/futures/liquidation/coin-list` | 是 |
| 爆仓时序 | `/api/futures/liquidation/history` | 否 |
| 全币资金费率 | `/api/futures/funding-rate/exchange-list` | 是 |
| 订单簿买卖盘 | `/api/futures/orderbook/ask-bids-history` | 否 |
| 大户持仓比 / 全局多空账户比 / 鲸鱼指数 / 基差 | 对应 history 端点 | 否 |

### 不可用（Standard+ 才开放）

- `/api/futures/coins-markets`（全币批量行情）→ 没有全币批量行情端点，扫描池必须逐币调用
- `/api/futures/rsi/list`
- 爆仓热力图 `liquidation/aggregated-heatmap/*`
- **K 线最小粒度 30 分钟**：白名单为 `["30m","1h","2h","4h","6h","8h","12h","1d","1w"]`，`15m` 及以下一律 403

### 限流

实测 120 并发全部 200、耗时 2.48 秒。上游不是瓶颈。

### 部署侧约束

- 项目运行在 **Vercel Hobby**：函数 `maxDuration` 上限 60 秒
- Vercel Hobby 的 Cron 最小粒度是每天一次，项目已用 **GitHub Actions 外部调度**
  （`.github/workflows/cron-tick.yml`，`*/10`，匿名 tick 由 `src/lib/cron-auth.ts` 限流放行）
- GitHub Actions 的 schedule 有几分钟到十几分钟的漂移。本设计把 workflow 调整为 `*/5`、
  服务端按「距上次扫描 ≥15 分钟才真算」门控，**实际节奏是 15~25 分钟，不是准点 15 分**。
  这是已知且接受的精度损失

## 模块划分

现有 `screener-scoring.ts`、`screener-server.ts`、`screener-scoring.test.ts` 整体退役。

```
src/lib/coinglass/
  client.ts        CG-API-KEY 注入、code!=="0" 归一成异常、超时、并发池
  types.ts         各端点响应类型
  market.ts        supported-coins / pairs-markets / funding-rate·exchange-list
  open-interest.ts open-interest/exchange-list
  liquidation.ts   liquidation/coin-list + liquidation/history
  price-history.ts price/history
  taker-volume.ts  taker-buy-sell-volume/history

src/lib/screener/
  universe.ts      候选池构建与门槛常量
  factors/zone.ts  Volume Profile        → 0–30
  factors/sweep.ts 爆仓峰值 + 价格收回   → 0–20
  factors/oi.ts    OI × 价格四象限       → 0–30
  factors/cvd.ts   CVD 斜率 + 背离       → 0–20
  score.ts         四因子组装、定方向、总分
  pipeline.ts      三段式编排
  alerts.ts        <80 → ≥80 跨越检测与状态机
  cache.ts         TTL + Supabase 双层缓存
  types.ts         ScannerRow / FactorBreakdown

src/components/screener/
  ScreenerFilters.tsx   三个滑块 + 方向切换 + 候选数
  ScannerTable.tsx      主扫描表（替换 ScreenerTable.tsx）
  FactorStack.tsx       四因子堆叠柱
  AlertRail.tsx         右侧警报栏容器
  AlertCard.tsx         单条警报卡

src/app/api/cron/screener-scan/route.ts   新增，由 GitHub Actions tick 驱动
scripts/screener-dryrun.mjs                新增，手动跑一轮真实 API 用于校验与调参
```

`factors/` 下四个文件都是纯函数 `(原始数据, direction) → { score, 明细 }`，不碰网络、不碰 DB。
这是整套设计里最重要的边界：打分逻辑是唯一会反复调参的部分，必须能脱离上游独立验证。

## 数据流

```
GitHub Actions cron-tick (*/5)
  └→ GET /api/cron/screener-scan   (沿用 authorizeCronTick)
       ├ 距上次扫描 <15min → 返回 skipped（单行 DB 读）
       └ pipeline.run()
           │
           ├ ① 批量层｜4 次调用并行，约 2 秒
           │    BingX getFuturesTickers()      → 可交易白名单 + 24h 高低（振幅）
           │    CoinGecko fetchMarketCapRows() → 市值 + 排名
           │    CG liquidation/coin-list       → 全币 1h/4h/12h/24h 爆仓
           │    CG funding-rate/exchange-list  → 全币资金费率
           │  粗筛：BingX 可交易 ∩ 非合成品 ∩ CoinGecko 排名 >50
           │        ∩ 市值 20M–800M ∩ BingX 24h 振幅 ≥0.5%
           │  → 约 200 个
           │
           ├ ② 行情层｜pairs-markets × 200，约 4 秒
           │  用 CoinGlass 真实 volume_usd 筛成交额 ≥5M
           │  → 约 150 个
           │
           ├ ③ 明细层｜4 端点 × 150 = 600 次，120 并发，约 13 秒
           │    oi/exchange-list · price/history 30m×336
           │    taker-volume 30m×48 · liquidation/history 30m×48
           │
           ├ factors → score → 按总分排序
           ├ alerts.detect(上次快照, 本次) → 写 screener_alerts + Telegram 推送
           └ 写 screener_cache

浏览器 → GET /api/screener → 读 screener_cache → 返回全部约 150 行（约 60KB）
       → 滑块在客户端纯过滤 + 排序，零延迟
```

合计约 800 次上游调用、约 22 秒，稳在 Vercel Hobby 的 60 秒上限内。

### 为什么明细层拆成两段

现有代码里最长的那段注释记录了一个真实的数据质量问题：**BingX 长尾的 `quoteVolume` 是被拍平的假数据**
（516 个永续里有 144 个全挤在 619–691 万这个 0.73M 宽的带里）。现有的 `MIN_QUOTE_VOLUME = 7_000_000`
就是为了跨过这条假带才定的。

改用 CoinGlass `pairs-markets` 的 `volume_usd` 后这个包袱可以扔掉，但前提是**先拿到 CoinGlass 的成交额
再做成交额筛选** —— 所以必须有独立的行情层。代价是多一段代码，收益是那 144 个假成交额的币再也进不来，
且成交额门槛可以降回一个有真实含义的数（5M）。

不把全部约 500 个 BingX 永续都拉完整 5 端点的原因：500 × 5 = 2500 次调用，120 并发下约 52 秒，
过于贴近 60 秒上限。粗筛（尤其市值门槛）先砍到约 200 个才安全。

### 两个关键性质

1. **打分与滑块完全解耦。** 服务端对整个候选池算一次分，滑块只决定哪些行显示。
   拉动滑块不改变任何币的分数，也不改变警报触发 —— 警报永远基于完整池子。
2. **cron 没跑过也不开天窗。** `/api/screener` 读不到新鲜缓存时就地算一次
   （沿用现有 `ttl-cache` + Supabase 双层缓存），cron 只是把计算提前到没人访问的时候完成。

## 交易所口径

CoinGlass 数据是多交易所的，必须逐项定死，否则不同因子会在描述不同的市场。

| 用途 | 口径 | 理由 |
|---|---|---|
| 持仓量及变化率 | `open-interest/exchange-list` 的 `All` 行 | 小市值币在单交易所的 OI 噪音极大，聚合才是真实杠杆水位 |
| 爆仓额 | `liquidation/coin-list`（本身聚合） | 同上 |
| K 线 / 成交量 / CVD | 固定 **Binance**；该币 Binance 无对应合约时回落到 `pairs-markets` 里成交额最大的交易所（`exchange=BingX` 亦经实测可用） | history 端点必须指定交易所；Binance 深度最好、数据最干净。回落交易所写进行数据，前端可显示 |
| 资金费率 | 取 **BingX** 那一行；缺失时回落到全交易所中位数 | 这是用户实际支付的费率，不是市场平均值 |
| 展示价格 | `pairs-markets` 里 BingX 的 `current_price` | 用户在哪儿下单就显示哪儿的价 |

## 打分模型

四个因子都实现为 `(数据, direction) → 分数`，对每个币把 long 与 short 各算一遍。
**方向 = 总分高的那一边，总分 = 那一边的分。** 方向 pill 与 0–100 总分由同一次计算产出，
不会出现「方向说 LONG 但因子构成看着像 SHORT」的矛盾。

### Zone（0–30）— 成交量分布价值区

输入：`price/history 30m × 336`（7 天）。

1. 价格全域 `[min(low), max(high)]` 切 50 个等宽桶；每根 K 线把 `volume_usd` 均摊到它 `low..high` 覆盖的桶
2. POC = 成交额最大的桶；从 POC 向两侧扩张至累计成交额 ≥ 总额 70%，得到价值区 VAL / VAH
3. `pos = (现价 − VAL) / (VAH − VAL)`，允许 <0 或 >1

做多打分曲线：

| pos | 分数 | 含义 |
|---|---|---|
| `[0, 0.35]` | 30（满分） | 贴价值区下沿，密集筹码在脚下当支撑 |
| `(0.35, 0.7]` | 30 → 12 线性 | 区间中部，无位置优势 |
| `(0.7, 1.0]` | 12 → 4 线性 | 贴上沿，头顶是套牢盘 |
| `> 1` | 4 固定 | 已冲出筹码区，做多即追高 |
| `< 0` | 30 → 0，`pos = −0.5` 时归零 | 刚跌破可能是假破所以仍给分；破太深说明结构已坏 |

做空把 `pos` 换成 `1 − pos` 走同一条曲线。

`pos < 0` 这段是全套设计里唯一的「接飞刀」风险敞口，归零点 `−0.5` 抽成独立常量便于调整。

### Sweep（0–20）— 爆仓峰值 + 价格收回

输入：`liquidation/history 30m × 48` + 同一份 30m K 线。

1. baseline = 近 24h 爆仓序列的**中位数**（不用均值 —— 峰值会把均值自己抬上去）
2. 最近 4 根（近 2 小时）取最大值，`spike = 峰值 / max(baseline, floor)`

   小市值币的 48 根 30m 爆仓序列里超过一半是 0 是常态，中位数因此经常正好为 0，
   直接相除会得到 `Infinity`，让任何一笔几百美元的爆仓都拿满分。
   `baseline` 取中位数；中位数为 0 时（稀疏序列）才回落到「近 24h 总爆仓额 / 48」，
   最后再与绝对下限 1000 USD 取较大者。**中位数非 0 时绝不能再与均值取 max** ——
   只要序列里有峰值，均值必然大于中位数，max 会让中位数永远不生效，
   整条曲线退化成它本来要避免的「用均值当基线」（90 倍的插针会被算成 7 倍）。
   绝对下限兜住整条序列全 0 的币 —— 那种情况下 `spike` 恒为很小的数，
   Sweep 自然接近 0 分，语义正确。
3. 方向：做多要**多头爆仓**放量（下方止损被扫干净），做空要空头爆仓
4. 收回确认：定位峰值那根 30m K 线 —— 做多要求其下影线 ≥ 全长 40%，且之后价格已回到该根实体之上；做空镜像
5. 得分 = 峰值强度（0–12，`spike` 从 3 倍起给分、10 倍满分，对数刻度）+ 收回确认（0–8，按影线比例与收回程度）

**Sweep 上「没数据」与「真的是 0」语义相同，都给 0 分。** 它是「发生了某件事」的事件因子，
没发生就是没发生。这与 OI/CVD 那种「拿不到数据走中性分」的处理**正好相反**，
实现时必须写进代码注释，否则会被后来的人「顺手统一」掉。

### OI（0–30）— 持仓量 × 价格四象限

输入：`open-interest/exchange-list` 的 `All` 行（30m / 1h / 4h 变化率）；同窗口价格变化从 30m K 线算。

丢弃 5m / 15m 窗口 —— 没有对应粒度的价格数据可以配对（Startup 最小 30m），
单看 OI 变化无法判断象限。

| ΔOI | Δ价 | 含义 | 做多 | 做空 |
|---|---|---|---|---|
| ↑ | ↑ | 新多头进场，涨势有新钱 | 100 | 0 |
| ↑ | ↓ | 新空头进场 | 0 | 100 |
| ↓ | ↑ | 空头回补，涨得没新钱 | 40 | 30 |
| ↓ | ↓ | 多头平仓离场 | 30 | 40 |

- 死区：`|ΔOI| < 0.5%` 或 `|Δ价| < 0.3%` 时该窗口给中性 50 —— 微小变化的正负号是噪音，不是象限
- 强度调制：结果按 `min(|ΔOI| / 2%, 1)` 向 50 收缩，变化越小越接近中性
- 窗口加权：30m × 0.4，1h × 0.35，4h × 0.25，再 × 0.3 映射到 0–30

### CVD（0–20）— 累积主动买卖差 + 背离

输入：`taker-buy-sell-volume/history 30m × 48`。`CVD_i = Σ(主动买 − 主动卖)`。

- **方向分（0–10）**：对最近 12 根（6 小时）的 CVD 序列做线性回归取斜率 `k`（单位：USD / 根）。
  归一化 `norm = clamp(k × 12 / 同期总成交额(买+卖), −1, 1)` —— 分子是这 6 小时里 CVD 的
  拟合净位移，分母是同期换手总量，相除得到无量纲的「净买入占总成交的比例」，
  天然落在 [−1, 1] 且不受币的绝对体量影响。做多分 `= (norm + 1) / 2 × 10`
- **背离分（0–10）**：同窗口价格涨跌 `pctPrice` 与 `norm` 对比
  - 做多：`pctPrice < 0` 且 `norm > 0` → 跌中承接，按 `min(|pctPrice| / 3%, 1) × min(norm, 1)` 给到满 10
  - 做空：`pctPrice > 0` 且 `norm < 0` → 拉高出货，镜像
  - **同向时给 0，不给负分** —— 同向的价值已由方向分表达，背离分再算一次即重复计分
- 数据缺失：方向分中性 5、背离分 0

总分 = Zone + Sweep + OI + CVD ∈ [0, 100]，≥80 触发警报。

## 候选池与筛选：服务端宽、客户端窄

服务端只用宽松门槛产出约 150 行的池子，demo 的滑块在客户端收窄。

服务端门槛（不可调）：

- BingX 永续可交易（`-USDT` 白名单）
- 非合成品（复用现有 `isSyntheticProduct`，`/^NC(SK|CO|SI|FX)/`）
- CoinGecko 能查到市值，且排名 > 50
- 市值 20M – 800M
- BingX 24h 振幅 ≥ 0.5%
- CoinGlass `volume_usd` ≥ 5M

客户端滑块：

| 滑块 | 范围 | 默认 | 过滤依据 |
|---|---|---|---|
| 24h 成交量 ≥ | 5–25M | 15M | CoinGlass `volume_usd` |
| 24h 振幅 ≥ | 1–5% | 3% | 30m K 线算的真振幅 |
| 市值下限 | 30–500M | 30M | CoinGecko；上限固定 500M |
| 方向 | 全部 / Long / Short | 全部 | 打分定出的方向 |

滑块状态存 `localStorage`，刷新保留。

**服务端宽门槛必须始终比滑块能拉到的最紧值更宽**，否则滑块会滑进空池子。
两边共用同一组常量，并由一个断言测试钉死这个包含关系。

成交额两边同源（都用 CoinGlass `volume_usd`），门槛取等值 5M 即可精确对齐。
振幅两边**不同源** —— 服务端粗筛发生在拉 K 线之前，只能用 BingX ticker 的 24h 高低；
客户端用 30m K 线算的真振幅。所以服务端门槛必须留出余量（0.5% vs 滑块最小 1%），
否则一个真振幅 1.2%、但 BingX 高低算出来 0.95% 的币会在粗筛阶段被误杀。

## 警报子系统

### 表结构

```sql
create table screener_alerts (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,                     -- BingX 符号，如 TIA-USDT
  direction      text not null check (direction in ('long','short')),
  triggered_at   timestamptz not null default now(),
  trigger_price  numeric not null,                  -- 锁定价：BingX current_price
  trigger_score  int not null,
  factors        jsonb not null,                    -- {zone,sweep,oi,cvd} 触发当时的四因子分
  last_price     numeric,
  last_price_at  timestamptz,
  peak_pct       numeric,                           -- 触发以来顺方向最大涨跌幅
  below_count    int not null default 0,            -- 连续低于关闭线的扫描次数（迟滞用）
  closed_at      timestamptz,
  pushed_at      timestamptz
);
create index on screener_alerts (closed_at, symbol) where closed_at is null;
```

RLS：只读对所有人开放（警报是全站信息，不是 per-user 数据），写入仅 service role。

### 状态机

每次扫描对每个币：

- **无未平警报 + 总分 ≥ 80** → 新建，锁价，推送。这就是 demo 说的「首次突破」
- **有未平警报 + 同方向** → 更新 `last_price` / `peak_pct`，`below_count` 归零，不重复推送
- **有未平警报 + 总分 < 75** → `below_count += 1`；累计到 3 次（约 45 分钟）才 `closed_at = now()`
- **有未平警报 + 75 ≤ 总分 < 80** → 保持未平，`below_count` 归零
- **方向翻转** → 关闭旧警报，新建

触发线 80 与关闭线 75 之间的迟滞区间是必需的，不是可选优化：80 分线上的抖动会让一个币
在几十分钟内反复开关警报、反复推送。

### 推送

只接 **Telegram 频道广播**，复用现有 `src/lib/telegram-send.ts`。
管理后台加两项配置：推送开关、最低推送分数（默认 80，可调高到 85 只推最强信号）。

**本次不接 web-push。** 现有 web-push 的语义是「用户自己设的某个币的价格提醒」，是用户主动订阅的；
把全站扫描器警报塞进同一通道等于给所有订阅过价格提醒的人推他们从未要求的东西。
要接的话应该是一个独立的订阅开关，属于另一个功能。

## 前端

demo 的视觉语言即项目现有设计语言，**不引入任何新 token 或新字体**：

- 色板：demo `--brass #c9a96e` ↔ 项目 `gold #C9A24B`，同族
- 字体：demo 加载的 Space Grotesk / Inter / JetBrains Mono 正是项目的 `font-display` / `sans` / `mono`

表格列（demo 八列 + 一列）：

`Symbol` · `方向 pill` · `总分` · `因子构成` · `24h量` · `24h振幅` · `市值` · `更新` · `操作`

最后一列 demo 没有但必须加 —— 操作按钮跳 `/trade?symbol=…&side=…&market=futures`，
那是这个页面唯一的出口，去掉就只剩一个能看不能用的榜单。

其余行为对齐 demo：点表头排序（默认总分降序）、总分 ≥80 的行高亮、点行在右栏展开该币的
警报卡与因子明细。移动端复用已有的 `RecordList`（它已经在做 demo 的 `data-label` 塌陷方案
做的同一件事，且已支持 `onRowClick` 与键盘可达）。

右侧警报栏展示未平警报列表（按触发时间倒序），每条显示锁定价、实时价、累计涨跌幅、
触发时的四因子构成。累计涨跌幅按方向取符号：做空下跌算正收益。

所有文案进 next-intl 的 zh / en messages，不硬编码。

## 错误处理与降级

| 失败点 | 处理 | 理由 |
|---|---|---|
| BingX tickers | 中止整轮 | 没有可交易白名单，榜单可能全是下不了单的币 |
| CoinGecko 市值 | 中止整轮（与现有行为相反） | 新模型里市值是硬门槛而非 25% 权重的打分项。拿不到 = 门槛失效 = BTC/ETH 与查不到的合成品涌进小市值筛选器。宁可沿用上一轮结果 |
| CG `liquidation/coin-list` | 降级：Sweep 全给 0 | 语义正确 —— 没有爆仓证据就是没有扫单 |
| CG `funding-rate/exchange-list` | 降级：字段留空 | 新模型里资金费率只是展示字段，不是四因子之一 |
| 单个币的单个明细端点 | 该因子走各自的缺失分支（Zone/OI/CVD 中性、Sweep 给 0） | 不牵连其他币 |
| 明细层整体 0 成功 | 抛错 → 沿用旧结果 | 复用现有 stale-while-error 语义 |
| 缓存中无任何结果 | `/api/screener` 就地算一次；再失败返 502 | 复用现有兜底 |

## 测试

- **四个 factor 各一个测试文件**：喂人造 K 线 / 爆仓序列，断言曲线拐点 ——
  Zone 的 `pos = 0.35 / 0.7 / 1.0 / −0.5`；Sweep 的 3 倍起分、10 倍满分、以及「缺数据给 0 而非中性」；
  OI 的 0.5% / 0.3% 死区与四个象限；CVD 的背离满分与同向给 0
- **`universe.ts`**：断言测试钉死「服务端宽门槛 ⊃ 客户端滑块最紧值」
- **`alerts.ts` 状态机**：首次触发、同方向不重复推、80 线抖动不反复开关、
  迟滞需连续 3 次 <75 才关、方向翻转开新
- **`score.ts`**：方向选取、总分恒在 [0, 100]
- **`coinglass/client.ts`**：`code !== "0"` 归一成异常、超时、并发池不超限
- **不写** `pipeline.ts` 的网络编排测试（打真实 API 的集成测试太脆）。
  改为手动脚本 `scripts/screener-dryrun.mjs`，跑一轮真实 API 打印完整榜单与四因子明细，
  用于上线前人工校验与以后调参
- 现有 `screener-scoring.test.ts` 随模型一起删除

## 配置

新增环境变量 `COINGLASS_API_KEY`。**不写进仓库**，在 Vercel 控制台与本地 `.env.local` 配置。
`src/lib/coinglass/client.ts` 在缺失时抛出明确错误，而不是让 CoinGlass 返回一个含义不明的 401。

`.github/workflows/cron-tick.yml`（目前尚未提交到仓库）schedule 从 `*/10` 调整为 `*/5`，
并新增一步调用 `/api/cron/screener-scan`。

## 不在本次范围内

- web-push 推送警报（需要独立订阅开关，属另一个功能）
- 警报的历史回测与胜率统计
- Standard 套餐才有的爆仓热力图、`coins-markets` 批量行情、15m 及以下粒度
- 两段式「粗筛 → 精算 Top N」的成本优化 —— 已评估并否决（省下的成本买不到东西，
  却引入「用单因子预分决定谁有资格参加四因子评分」的逻辑漏洞）。
  若 Vercel 预算日后报警，可作为有依据的降级开关再加
