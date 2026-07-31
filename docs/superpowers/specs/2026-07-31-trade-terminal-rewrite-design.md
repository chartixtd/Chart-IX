# 交易页完整重构 — 设计文档

日期：2026-07-31
状态：待批准

## 背景

用户要求把 `/trade` 页面重构成"完全体的交易终端"：完整历史K线、完整下单种类覆盖、止盈止损、可修改的挂单、专业布局。经过对现有代码的审查，结论是：

**现有实现已经不弱**——现货/合约/模拟盘三条市场路径、8种订单类型、TP/SL 拖拽线、订单改价、平仓，都已经存在且能跑。但用户明确要求的是**彻底重写**（视觉、组件结构、交互流程、数据层四个层面都要重做），不是缝缝补补。

更关键的发现：`src/lib/bingx/futures.ts` 和 `src/lib/bingx/trade.ts` 里已经实现了大量**从未被任何路由或 UI 调用**的 BingX 接口封装——历史订单（`getFuturesAllOrders`/`getHistoryOrders`）、强平记录（`getFuturesForceOrders`）、成交历史（`getFuturesFillHistory`/`getMyTrades`）、持仓历史（`getPositionHistory`）、批量下单/撤单、Dead Man's Switch（`cancelAllAfter`）、双向持仓模式、保证金资产等。这意味着这次重写**后端信号层大部分已就绪**，主要工作量在前端架构重写 + 路由补齐 + 一块全新的用户数据流（listenKey WebSocket）。

## 范围决策（已与用户逐项确认）

| 决策点 | 结论 |
|---|---|
| 重写深度 | 视觉、组件结构、交互流程、数据层，四个层面**全部**重写，非增量打补丁 |
| 市场路径拆分 | 保留现货/合约/模拟盘三条独立路径与三个面板组件（这个边界是合理的，不合并） |
| K线历史 | 无限滚动向左续拉历史（而非固定加大 limit 或维持现状） |
| 下单种类 | Post-Only/IOC/FOK 时效选择 + 合约 Reduce-Only 开关 + 现货 OCO 单，全部补齐 |
| 挂单/持仓面板范围 | 保持三个独立面板，但都补齐：历史订单 tab、成交记录 tab、完整改价能力 |
| 数据层 | 接入 BingX listenKey 用户数据流做实时推送，轮询降级为断线兜底 |
| 布局 | 经典四栏专业版（行情列表 / 图表+底部标签页 / 独立盘口+成交流 / 独立下单面板），全部栏目可拖拽调宽/调高，布局持久化 |
| 视觉风格 | 延续品牌暗色+香槟金（`#C9A24B`）基调，不换成中性行情终端配色 |
| 价格联动 | 点盘口价位 / 图表拖拽 → 直接填入下单面板的限价 |
| 仓位交互 | 新增一键反向（平仓+反向开仓）、部分平仓滑块（百分比） |
| 下单交互 | 新增金额快捷比例按钮（25/50/75/100%），已有的全平/手动金额输入保留 |
| 代码组织 | `src/components/trade` 按功能模块重分：`chart/`、`order-entry/`、`positions/`、`market-data/`、`layout/` |

## 架构总览

```
src/components/trade/
  layout/
    TradeTerminalLayout.tsx     四栏可拖拽外壳（resizable panel groups + 持久化）
    ResizablePanel.tsx          通用可拖拽分隔条组件
    MobileTradeLayout.tsx       移动端 tab 切换布局（沿用现有模式，接入新数据源）
  chart/                        （沿用现有 chart/ 内部结构，新增历史分页逻辑）
    KlineChart.tsx
    useKlineHistory.ts          新增：无限滚动向后翻页 hook
    ...(DrawingLayer/OrderLineOverlay/IndicatorModal 保持)
  market-data/
    OrderBook.tsx                盘口（点价格填单）
    TradeTape.tsx                新增：公开成交流（复用 /api/bingx/market/trades）
    MarketOverview.tsx           （原样迁移）
  order-entry/
    OrderTicket.tsx               替代 OrderForm.tsx，内部按 market 组合子表单
    fields/                       （沿用 AmountField/LeverageField/PriceFields，新增 TifField/ReduceOnlyField/QuickPctButtons)
    OcoTicket.tsx                 新增：现货 OCO 下单子表单
    OrderPreview.tsx / OrderConfirmModal.tsx （沿用）
  positions/
    SpotOrdersPanel.tsx           替代 OrdersPanel.tsx
    FuturesPositionsPanel.tsx     替代 FuturesInfoPanel.tsx
    PaperOrdersPanel.tsx          （原地增强，非替换）
    shared/
      OrderHistoryTab.tsx         新增：历史订单（现货/合约/模拟盘共用 UI，数据源不同）
      FillHistoryTab.tsx          新增：成交记录
      PositionRow.tsx             新增：含部分平仓滑块 + 一键反向
      OrderRow.tsx                新增：统一挂单行（含改价/撤单）

src/hooks/trade/
  useUserDataStream.ts           新增：listenKey 生命周期 + WS 消息分发
  usePositions.ts / useOpenOrders.ts / useOrderHistory.ts / useFillHistory.ts / useBalances.ts
                                  React Query hooks，WS 消息到达时 setQueryData 而非等下次轮询
  useKlineHistory.ts

src/lib/bingx/
  user-stream.ts                  新增：listenKey 创建/续期/关闭（spot + swap 各一套）
  market.ts                       getSpotKlines/getFuturesKlines 已支持 startTime/endTime，路由需透传
  trade.ts / futures.ts           已有的历史订单/成交/强平记录函数直接复用，只需加路由

src/app/api/bingx/
  user-stream/route.ts             新增：POST 创建 listenKey，PUT 续期，DELETE 关闭
  trade/history-orders/route.ts    新增：包 getHistoryOrders
  trade/oco-order/route.ts         已存在，需前端接入
  futures/history-orders/route.ts  新增：包 getFuturesAllOrders
  futures/fill-history/route.ts    新增：包 getFuturesFillHistory
  futures/force-orders/route.ts    新增：包 getFuturesForceOrders（强平记录，展示在历史 tab 里作为特殊行）
  market/klines/route.ts           改造：透传 startTime/endTime
```

## 数据流：从轮询到推送

### 现状问题
`FuturesInfoPanel`、`OrdersPanel`、`PaperOrdersPanel` 各自 `useEffect` + `setInterval(fetchData, 5_000)`，三个面板互不知情，同一数据在不同面板重复请求，且 5 秒延迟对"专业终端"体验来说太粗糙。

### 新方案
1. **listenKey 生命周期**（`useUserDataStream`）：
   - 挂载时 `POST /api/bingx/user-stream`（区分 spot/futures，两条独立 listenKey）拿到 key，打开 WS 连接（现货 `wss://open-api-ws.bingx.com/market?listenKey=` 或官方文档给出的用户数据流地址）
   - 每 30 分钟 `PUT` 续期（BingX listenKey 60 分钟过期）
   - 卸载/登出时 `DELETE` 关闭
   - 断线自动重连（复用 `useBingXWebSocket.ts` 里已经写好的重连/去抖模式）
2. **消息分发**：WS 收到 `ORDER_TRADE_UPDATE`（合约）/ `executionReport`（现货）/ 余额变更事件时，直接 `queryClient.setQueryData` 更新对应 React Query 缓存（positions/openOrders/balances），不等下一次 fetch。
3. **轮询兜底**：React Query 的 `refetchInterval` 保留但拉长到 30-60 秒，只用于 WS 断线时的数据兜底和首次加载，不再是主更新机制。
4. **风险边界**：下单/撤单/改价接口本身不变（仍是现在这套已重建过的 preflight 链路，见 `2026-07-29-bingx-order-flow-design.md`），这次改造只影响"读"路径的时效性，不碰"写"路径的校验逻辑。

## K线历史：无限滚动

- `useKlineHistory(symbol, interval, market)`：初始加载最近一批（沿用现有 limit），返回 `{ candles, loadMore, hasMore, loading }`
- `KlineChart` 监听 `chart.timeScale().subscribeVisibleLogicalRangeChange()`，当可见范围左边界接近已加载数据起点且 `hasMore` 时触发 `loadMore()`
- `loadMore` 用最早一根K线的时间 -1ms 作为新的 `endTime` 请求上一批，返回结果 prepend 到现有数据，用 `series.setData()` 整体刷新（lightweight-charts 无增量 prepend API），加载期间锁定 timeScale 避免跳动
- 请求耗尽（BingX 返回空数组或数量小于 limit）时标记 `hasMore = false`，前端不再继续请求——这是"能拿多少拿多少"的自然终止条件，不需要预先知道交易对上市时间
- `/api/bingx/market/klines` 路由新增透传 `startTime`/`endTime` 查询参数（`getSpotKlines`/`getFuturesKlines` 已经接受这两个参数，路由层此前没有转发）

## 下单种类补全

以 `order-entry/config.ts`（现 `order-form/config.ts` 迁移）为单一事实来源：

- **TimeInForce**：限价类订单新增 GTC/PostOnly/IOC/FOK 选择（`trade.ts` 的 `TimeInForce` 类型已经包含全部四种，现在前端固定传 `GTC`）。仅在"专业模式"显示，简单模式默认 GTC 隐藏此项。
- **Reduce-Only**：合约下单新增开关，映射到 BingX `reduceOnly` 参数；开启时前端校验下单方向必须与现有持仓相反（否则 BingX 会拒单，提前拦截给出可读提示）。
- **现货 OCO**：新增 `OcoTicket` 子表单（触发价+限价，一取消另一），调用已存在的 `POST /api/bingx/trade/oco-order`；挂单面板新增 OCO 分组展示（`queryOcoOpenOrderList`/`queryOcoHistoryOrderList` 已在 `trade.ts` 实现，只需加路由）。
- **模拟盘类型对齐**：模拟盘当前只有 MARKET/LIMIT，本轮补齐止盈止损市价/限价（本地撮合逻辑已有杠杆和持仓概念，止盈止损可以用本地价格监控实现，不需要 BingX 撮合）。追踪止损/OCO 因需要真实盘口深度模拟复杂度过高，本轮不做，标注为已知限制写进代码注释。

## 挂单/持仓面板增强

三个面板（`SpotOrdersPanel`/`FuturesPositionsPanel`/`PaperOrdersPanel`）共享 `positions/shared/` 下的展示组件，但各自的数据源和调用的下单/撤单接口保持独立（不引入跨市场抽象层，避免重蹈"合约现货揉在一起"的复杂度）。

新增能力：
- **历史订单 tab**：合约走新增的 `futures/history-orders` 路由（`getFuturesAllOrders`），现货走新增的 `trade/history-orders` 路由（`getHistoryOrders`），模拟盘走本地账本（已有数据，只是没有专门 tab 展示）
- **成交记录 tab**：合约 `futures/fill-history`，现货复用已有 `trade/my-trades`
- **强平记录**：合并展示进合约历史 tab，标红标注（`getFuturesForceOrders`）
- **一键反向**：`PositionRow` 新增按钮，点击后弹出确认框（明确告知"这是两步操作：先市价平仓，再市价反向开仓相同数量，两步之间可能存在价格滑点或部分失败"），确认后顺序调用 `closePosition` → `placeFuturesOrder`（相反方向，`reduceOnly: false`），第二步失败时明确提示"已平仓但反向开仓失败"而不是静默
- **部分平仓滑块**：25/50/75/100% 或自定义百分比。`closePosition()`（`/openApi/swap/v1/trade/closePosition`）按 `positionId` 只支持全平，不接受数量参数，因此部分平仓改为下一张相反方向、`reduceOnly: true`、数量为 `positionAmt * pct` 的市价单，不复用 `closePosition` 接口
- **挂单改价改量**：`amendFuturesOrder`（`/openApi/swap/v1/trade/amend`）已支持同时改 `quantity`/`price`/`stopPrice`，现货 `cancelReplace` 走撤单重下模拟改量；`OrderRow` 统一补上数量输入框，不再只能改价

## 布局与视觉

- `TradeTerminalLayout` 用可拖拽分隔条实现四栏：`[symbol-list] | [chart + bottom-tabs] | [orderbook + trade-tape] | [order-ticket]`
- 拖拽后的列宽/底部面板高度存进 `tradePrefs` store（zustand + localStorage，已有 `PreferencesSync` 机制同步到 Supabase，沿用）
- 底部标签页大面板承载 Positions/Open Orders/Order History/Fills（横向 tab，取代现在挂在右侧栏的窄小面板）
- 移动端保留现有 tab 切换式布局（图表/下单/订单簿三 tab），不做可拖拽（触屏体验不适合拖拽面板），但接入同一套新数据源和新交互（价格联动、快捷比例、部分平仓）
- 视觉延续 `tailwind.config.ts` 现有 token（`bg-primary/secondary/tertiary`、`gold` 系列、`success`/`danger`），本轮是布局与信息密度的重做，不引入新配色系统

## 价格联动

- `OrderBook` 每一行价格增加点击处理，通过 `TradeTerminalLayout` 提供的 context/回调把价格写入 `OrderTicket` 的受控 `price` 状态（仅在当前是限价类订单类型时生效，否则忽略并可给出轻提示）
- `KlineChart` 已有 `DrawingLayer`/`OrderLineOverlay` 的拖拽基础设施，复用同一套坐标转换逻辑新增"拖拽创建限价单价格线"，松开后同样写入 `OrderTicket` 的 `price`

## 错误处理

沿用 `2026-07-29-bingx-order-flow-design.md` 建立的 `translateError`/i18nKey 机制。新增的路由（history-orders/fill-history/force-orders/user-stream）遵循同一套 `{ success, error: { code, message, i18nKey? } }` 响应形状。listenKey 创建失败时用户数据面板整体降级为纯轮询模式并在面板顶部提示"实时推送不可用，已切换为轮询"，不阻塞整个页面。

## 测试策略

- `lib/bingx/user-stream.ts`：listenKey 创建/续期/关闭的签名请求单测（参照现有 `market.test.ts` 风格）
- `useKlineHistory`：分页拼接、去重、`hasMore` 终止条件的单测
- `PositionRow` 一键反向：两步操作中第二步失败时的错误展示（组件测试）
- 部分平仓百分比计算的边界（极小仓位、精度截断）
- OCO 下单参数映射（触发价/限价方向校验：买入 OCO 触发价应低于限价，卖出相反——需核对 BingX 文档具体方向要求，写进代码注释）
- 端到端：现有 `position-tpsl.test.ts` 模式扩展覆盖 reduce-only、TIF 参数是否正确进入请求体

## 实施阶段划分（供 writing-plans 参考，非本文档需要决定的内容）

体量上不适合一个 PR 完成，建议顺序：
1. 数据层：React Query hooks 统一 + listenKey 用户数据流（风险最高，最先做，其余阶段都依赖它）
2. K线无限滚动历史
3. 下单种类补全（TIF/Reduce-Only/OCO/快捷比例）
4. 挂单/持仓面板增强（历史/成交 tab、部分平仓、一键反向）
5. 布局重做（可拖拽四栏）+ 价格联动交互
6. 视觉打磨收尾

每个阶段独立可发布、可回滚，不要求一次性合并。
