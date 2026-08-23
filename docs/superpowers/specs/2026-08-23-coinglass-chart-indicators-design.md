# K 线图接入 CoinGlass 指标：聚合持仓量 OI + 聚合 CVD

日期：2026-08-23
状态：已实施

## 目标

把 CoinGlass 在 TradingView 上的两个指标——「Aggregated Open Interest (Candles)」与
「Aggregated CVD (Candles)」——以独立副图蜡烛的形式加进项目自己的 K 线图
（`lightweight-charts` v5）。数据走项目已接入的 CoinGlass v4 API（STARTUP 套餐）。

## 与 TradingView 版本的差异（刻意的）

| | TradingView 上的 CoinGlass 指标 | 本项目 |
|---|---|---|
| CVD 口径 | Spot（现货） | 默认现货，可切合约（设置项，见下） |
| OI 口径 | COIN-margined | 默认币本位，可切 U 本位 / 全部 |
| CVD 蜡烛影线 | 有（盘中累计高低） | **无**——只有逐根买卖量，合成不出盘中高低 |
| 最细周期 | 1m | **30m**（套餐白名单，升 Standard 才解锁） |
| 历史深度 | 无限 | 固定 1000 根，更早留空 |

第一轮（commit 8a1f279）默认用的是选币器已实测的合约 CVD 与全保证金 OI；第二轮按
CoinGlass API 文档把端点补齐并做成设置项，默认值对齐用户截图里的原版（现货 CVD、币本位 OI）。
这两个端点在 STARTUP 套餐上的可用性本机没法验证（没有 key，见下「未验证项」）。

## 三个硬约束决定的设计

1. **配额 75 次/分钟，与选币器共用。** 选币器每轮 72 次、15 分钟一轮。图表这边：
   - 每个 `(kind, coin, interval)` 组合在 TTL 内全站只打一次上游，TTL =
     `clamp(周期/6, 5min, 4h)`（30m→5 分钟，1h→10 分钟，1d→4 小时）
   - 缓存两层：进程内存 + Supabase `coinglass_series_cache`（迁移 052）。Vercel 各
     lambda 内存互不可见，只靠内存挡不住冷启动实例各打一次
   - 客户端 react-query 的 `staleTime`/`refetchInterval` 用同一个 TTL 常量，不会比
     服务端缓存更勤
   - 没有任何指标声明 `requires` 时零请求；非 Pro 用户零请求
   - 上游失败时有旧数据就标 `stale` 返回，不把接口打成 5xx
2. **粒度最小 30m。** 1m/3m/5m/15m/3d 周期下不发请求，副图留空、图例写
   「需 30m 及以上周期」。不做 30m→1m 的前向填充（1m 图上是一条横线）。
3. **数据按币聚合，不按交易对。** `BTC-USDT` → `BTC`（复用 `coinFromBingXSymbol`，
   会抹掉 `1000PEPE` 的乘数前缀）。UI 上标「CoinGlass」让用户知道这不是 BingX 单家的数。

## 设置项（2026-08-23 第二轮：对齐 CoinGlass 在 TradingView 上的指标设置）

CoinGlass 的 TradingView 指标是 invite-only 脚本，输入项没有公开文档；下面这套是按
用户截图图例里的输入值（CVD：`Main chart symbol · Dollars · open · No Filter`，
OI：`open · No Filter`）加 CoinGlass API 实际支持的参数定出来的，原版若有出入再调。

设置分「输入」「样式」两页（与 TradingView 的指标设置对话框同构），存在
`AppliedIndicator.settings`（非数值，与 `params` 分开）与 `styleOverrides`。

### 输入

| 键 | 控件 | 选项 / 默认 | 作用 |
|---|---|---|---|
| `symbolMode` | 下拉 | 跟随主图品种 **/** 自定义 | Main chart symbol |
| `symbol` | 文本（仅自定义时显示） | 任何写法，`coinFromChartSymbol` 归一化 | 自定义币 |
| `market`（CVD） | 下拉 | **现货** / 合约 | 选 spot / futures 端点 |
| `margin`（OI） | 下拉 | **币本位** / U 本位 / 全部 | 选三个 OI 端点之一；「全部」端点无交易所参数 |
| `unit` | 下拉 | **美元** / 币 | CoinGlass `unit=usd|coin` |
| `exchangeMode` | 下拉 | **No Filter** / 自选 | No Filter = 服务端按端点套默认组合 |
| `exchanges` | 多选 + 手填（仅自选时显示） | 清单按现货/合约切换；手填兜住清单之外的任何名字 | `exchange_list` |
| `display` | 下拉 | **蜡烛** / 折线 | 决定 series 类型（结构的一部分，切换会重建） |
| `lineSource` | 下拉（仅折线时显示） | **open** / high / low / close | 折线取蜡烛的哪个值 |

文本类控件失焦/回车才提交——每敲一个字母就提交会让 "E"→"ET"→"ETH" 各发一次请求。
依赖项的显隐会级联：`margin=all` 隐藏 `exchangeMode`，连带隐藏 `exchanges`。

每个实例的设置经 `buildExternalRequest` 变成一个 `ExternalSeriesRequest`，
`externalRequestKey`（kind/币/周期/市场/保证金/单位/交易所集合）是缓存键与去重键：
设置相同的两个实例只发一次请求；**每一种不同组合都是一个独立的配额消耗者**，
面板底部有一行提示说明这一点。

### 样式

蜡烛：上涨/下跌各自的实体、边框、影线颜色（边框/影线默认跟随实体）；
折线：颜色、粗细、线型。两种都有：价格轴标签、价格线、精度（0–4，默认 2）。
存在 `styleOverrides[plotKey]` 的新增字段里（`upColor`…`precision`），
`resolveCandleStyle` 负责套默认值。

### 端点映射（`coinglass/chart-series.ts`）

| request | 端点 | exchange_list |
|---|---|---|
| oi · all | `/futures/open-interest/aggregated-history` | 无此参数 |
| oi · stablecoin | `…/aggregated-stablecoin-margin-history` | 必填，默认 Binance/OKX/Bybit/Bitget/Gate/HTX |
| oi · coin | `…/aggregated-coin-margin-history` | 必填，默认上表 + Bitmex |
| cvd · futures | `/futures/aggregated-taker-buy-sell-volume/history` | 必填，默认 Binance/Bybit/OKX/Hyperliquid（= 选币器） |
| cvd · spot | `/spot/aggregated-taker-buy-sell-volume/history` | 必填，默认 Binance/OKX/Bybit/Coinbase/Bitget |

全部支持 `unit`、`limit≤1000`、`start_time/end_time`（docs.coinglass.com 2026-08-23 核对）；
STARTUP 套餐 ≥30m。默认交易所名与勾选清单里的拼写**未经真实 key 验证**，
拼错的名字会让上游 400，图例显示「CoinGlass 数据暂不可用」，服务端日志带 `COINGLASS_400`。

## 分层

```
src/lib/chart/external-series.ts        叶子模块（前后端共用）：类型、周期白名单、TTL、
                                        对齐器 alignOhlcToTimes、CVD 蜡烛合成 cvdCandlesFromFlow
src/lib/coinglass/chart-series.ts       服务端：按 kind 选端点、毫秒→秒、坏根过滤、去重排序
src/lib/coinglass/chart-series-cache.ts 服务端：内存 + DB 双层、并发去重、stale 降级
src/app/api/coinglass/series/route.ts   GET ?kind=oi|cvd&coin=&interval=  登录 + Pro 门控
src/hooks/useExternalSeries.ts          前端：按已应用指标声明的 kinds 拉、payload 引用稳定
src/lib/chart/indicator-registry.ts     IndicatorInput.ext / PlotDef.kind="candles" /
                                        IndicatorDef.requires+source / 两条新记录 cg_oi、cg_cvd
src/components/trade/KlineChart.tsx     拉取 → 对齐 → 注入 input.ext；蜡烛系列的创建与增量更新
src/components/trade/chart/ChartLegend  「CoinGlass」标签 + 周期不支持/加载中/不可用提示
```

注册表的 `compute` 返回类型从 `(number|null)[]` 放宽为 `PlotSeries = (number|null)[] | CandleSeries`；
两条新记录的 `compute` 只是把 `input.ext.oi` / `input.ext.cvd` 原样透传，没有 ext 时给全 null。

### 增量路径的处理

KlineChart 的 tick/append 增量路径只 `update()` 尾部一两根。CoinGlass 序列的一次刷新会改写
整条序列（CVD 的累计起点随窗口滑动整体平移），所以 `extPayload` 的引用一变就强制走全量
`setData` 路径——与 `applied` 变化的处理一致。刚开的新根在下次刷新前 ext 值是 null，增量路径
跳过即可。

## 未验证项（本机没有 COINGLASS_API_KEY）

- `limit=1000` 在 STARTUP 套餐上是否放行（1000 是文档默认值，最不可能被拒的那个）
- 1h/4h/1d 等白名单周期的 `aggregated-history` / `aggregated-taker-buy-sell-volume/history`
  实际返回（30m 已由选币器实测）
- 周线的开盘时间戳 BingX 与 CoinGlass 是否都落在周一 00:00 UTC（不一致则 1w 周期对不上，
  表现为副图空白，不会报错）
- 现货 CVD 端点 `/api/spot/aggregated-taker-buy-sell-volume/history` 与 coin-margin OI
  端点是否在套餐内

上线后打开任一 Pro 账号、加上两个指标、切到 30m/1h/4h/1d 各看一次即可覆盖前三项；
服务端日志里 `[coinglass/series]` 前缀会带上 CoinGlass 的 code（如 `COINGLASS_401` 表示套餐不够）。

## 测试

- `external-series.test.ts`：白名单、TTL 曲线、CVD 合成、对齐（精确匹配、不插值、坏根）
- `chart-series.test.ts`：归一化（毫秒→秒、字符串字段、去重排序）；缓存（TTL、按 key 独立、
  DB 命中不打上游、并发去重、上游失败降级 stale、无缓存才抛）
- `indicator-registry.test.ts`：新记录的类别/requires/蜡烛 plot；有 ext 原样透传、无 ext 全 null；
  原有「全指标契约」测试对 `requires` 指标跳过「至少一个非 null」一项

## 不在本次范围内

- 爆仓额、资金费率、多空比等其它 CoinGlass 序列——基础设施已通，各加一条注册表记录 +
  `chart-series.ts` 里一个端点分支即可
- 向左翻页时跟着拉更早的 CoinGlass 历史
