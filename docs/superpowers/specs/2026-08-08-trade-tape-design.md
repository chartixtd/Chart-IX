# 成交明细（Trade Tape）设计文档

日期：2026-08-08
状态：已获用户批准

## 背景

`useRecentTrades`（`src/hooks/useMarketData.ts`）与 `/api/bingx/market/trades` 是一条完整可用的成交数据管道——BingX 客户端函数 → 带限流/校验/CDN 缓存的 API 路由 → React Query 轮询钩子——但从未有 UI 消费它。git 历史确认没有任何成交列表组件被删除过：它是早期提交 `47a0a25` 里连同整个行情数据层一起搭起来的，界面那一步没跟上，此后一直是死代码（零调用方，因此从不执行、不产生请求）。

本设计把这条管道接上界面，并让它对 Chart-IX 的教育定位真正有用。

## 目标

在交易页提供「成交明细」（逐笔成交）：实时展示每一笔实际成交的时间、价格、数量与主动方向，并**高亮异常大额成交**，让用户看见"有没有大资金在动"而不是盯着一列跳动的数字。

## 已确认的决策（用户逐项批准）

| 项 | 决定 |
|---|---|
| 桌面版位置 | `MarketOverview` 左栏加第三个切换页（市场 / 盘口 / **成交**） |
| 数据来源 | BingX WebSocket `SYMBOL@trade` 频道，断线回落现有 REST 轮询 |
| 手机版 | 现有盘口抽屉叠层内加「盘口 / 成交」标签，不占额外屏幕空间 |
| 权限 | **Pro 专享**（免费用户见锁定态 + 升级入口） |
| 功能深度 | 方案 B：展示列表 + 大单高亮（不做主动买卖占比统计条——YAGNI） |

## 实测事实（生产端点验证，勿凭文档改写）

1. `SYMBOL@trade` 频道在现货端点 `wss://open-api-ws.bingx.com/market` 可用，订阅消息 `{id, reqType:"sub", dataType:"BTC-USDT@trade"}` 返回 `{"code":0,"msg":"SUCCESS"}`。
2. 推送频率实测约 **2 次/秒**（20 秒 39 条）。
3. 单笔载荷为**对象**（非数组）：`{"E":1786158018968,"T":1786158018949,"e":"trade","m":true,"p":"64923.99","q":"0.00075","s":"BTC-USDT","t":"229162568"}`。字段含义：`T`=成交时间、`p`=价格、`q`=数量、`m`=isBuyerMaker、`t`=成交 ID、`s`=交易对。
4. 与项目既有类型 `BingXTrade`（`{id, price, qty, time, isBuyerMaker}`）一一对应，无需新类型。

## 架构

### 数据层

- **`useBingXTrades(symbol, enabled)`**（新增于 `src/hooks/useBingXWebSocket.ts`）：订阅 `SYMBOL@trade`。复用阶段 5 建立的按频道引用计数机制——该机制已是通用的，接入新频道属配置性工作。`enabled` 为 false 时不订阅。
- **store 新增 `trades: Record<string, BingXTrade[]>`**（`src/stores/market.ts`），配套两个方法：
  - `pushTrade(symbol, trade)`：从头部插入，**保留最近 50 笔**后截断。上限是硬性的——避免重演 `tickers` 曾经只增不删的问题。
  - `removeTrades(symbol)`：退订时清理，与 `removeTicker`/`removeDepth` 同一模式（无变化时返回同一 state 引用）。
- **`useRecentTrades(symbol, enabled)` 改造**：签名新增 `enabled`，内部调用 `useBingXTrades(symbol, enabled)` 完成订阅，再按 WS/REST 优先级返回数据——**与阶段 5 的 `useOrderBook` 调用 `useBingXDepth` 完全同构**。WS 有数据用 WS；断线、尚无数据或 `enabled` 为 false 时回落现有 3 秒 REST 轮询（REST 查询同样受 `enabled` 门控，不可见时不轮询）。原有 REST 管道因此成为实时通道的兜底，而非被废弃。
- **调用关系明确**：`RecentTrades` 组件调用 `useRecentTrades(symbol, canView && isTabActive)`；组件自身不直接碰 `useBingXTrades` 或 store。

### 展示层

- **`src/components/trade/RecentTrades.tsx`**（新增）：`memo` 包裹，三列（时间 `HH:mm:ss` / 价格 / 数量），主动买绿、主动卖红（由 `isBuyerMaker` 判定）。写法照搬 `OrderBook.tsx`（`useTranslations`、`formatPrice`、等宽数字对齐）。
- **`MarketOverview`**：`viewMode` 由 `"list" | "orderbook"` 扩为三态，新增「成交」按钮与对应分支。除该 union 类型与一个分支外不改动。
- **手机版**：现有盘口抽屉顶部新增「盘口 / 成交」小标签组，抽屉容器本身不变。

### 权限层

- **`src/lib/access.ts` 新增 `canViewTradeTape(tier)`**，与 `canTradeLive`/`canUseAdvancedChart` 并列。该文件的既有形状即"一项能力一个函数"，新增函数比复用 `canUseAdvancedChart`（语义专指图表指标）干净。
- 免费用户：面板中央显示锁定态（说明文案 + 跳转 `/upgrade` 的 CTA），沿用 `KlineChart` 既有升级引导的文案风格。
- **`auth.loading` 期间抑制锁头显示**，避免 Pro 用户刷新时闪现锁定态（沿用 `KlineChart` 的 `accessLoading` 惯例）。
- 免费用户**不订阅** WebSocket 频道。

### 大单高亮逻辑

纯函数置于 **`src/lib/trading/trade-tape.ts`**，与其他交易纯逻辑同层，可独立测试。导出 **`markLargeTrades(trades: BingXTrade[]): Array<BingXTrade & { isLarge: boolean }>`**——输入一批成交，返回逐笔带 `isLarge` 标记的同长度数组（顺序不变），基准在函数内部按整批计算。组件只消费 `isLarge`，不重复实现判定。

- **基准取中位数，不取平均值**：平均值会被单笔巨额成交自身抬高，导致连续大单反而无法被标记；中位数对离群值免疫，正是标记离群值所需。
- **判定**：`qty >= median(有效成交量) × LARGE_TRADE_MULTIPLIER`，倍数取 **3**，定义为具名常量。
- **边界规则**：
  - 有效样本少于 **10** 笔时一律不高亮（否则首笔必然"超过中位数 3 倍"，开盘即满屏高亮）。
  - 所有成交量齐平时零高亮（中位数 ×3 高于任一笔）——无异常即无信号。
  - 数量为 0、负数或 `NaN` 的记录先过滤，不参与中位数计算。
- **视觉**：加粗 + 该方向颜色的淡背景底色。不加图标或徽章——密集列表中每多一个视觉元素都是噪音。

## 数据流

```
BingX WS (SYMBOL@trade, ~2/s)
  └─ BingXWebSocketManager（频道引用计数，阶段 5 既有）
       └─ marketStore.pushTrade(symbol, trade)  // 头插 + 截断 50
            └─ RecentTrades（仅在「成交」标签选中且 Pro 时订阅）
                 ├─ markLargeTrades()  // 纯函数，中位数基准
                 └─ 渲染：时间 / 价格 / 数量，方向着色 + 大单强调

断线 → wsConnected=false → useRecentTrades 回落 REST（3s 轮询）→ 恢复后自动切回
```

## 错误处理

- WebSocket 断线：自动回落 REST 轮询（与订单簿同一模式）。
- REST 亦失败：**保留最后已知列表不清空**，不弹打断性错误（沿用性能优化 spec §5 原则）。
- 空列表（新上市交易对尚无成交）：中性占位文案，非错误态。

## 性能

- **订阅必须是条件性的**：仅当「成交」标签选中 **且** 用户为 Pro 时订阅。切到其他标签即退订。成交推送约 2 次/秒且每次产生新数组引用，不可见面板若保持订阅会造成每秒两次无谓重渲染。此条件与 Pro 门控共用同一个开关。
- 50 条上限使中位数计算（50 元素排序）与列表渲染均为微秒级，无需额外优化。

## 国际化

`zh-CN / en-US / ms-MY` 三份 JSON 各新增一组键：标签名、列头（时间/价格/数量）、空态文案、锁定态说明与 CTA。纯新增，不修改任何现有文案。

## 测试

- **`trade-tape.ts` 纯函数走 vitest**：中位数计算、样本不足、成交量齐平、脏数据过滤、倍数刚好卡在阈值上。这是"算错会让用户误判市场"的地方，必须有覆盖。
- 组件与 WebSocket 接线**无自动化测试**（仓库无相应测试基建），依赖下列人工验收——如实记录，不假装有覆盖。

## 验收标准

1. Pro 用户在桌面版切到「成交」标签，逐笔成交流式滚动，主动买/卖着色正确；
2. 大额成交明显区别于普通成交，且普通行情下不会满屏高亮；
3. 免费用户看到锁定态与升级入口，认证加载期间不闪锁头；
4. 切到其他标签后，开发者工具中成交推送停止；
5. 断网后列表保留最后数据并回落 REST，恢复后继续推送；
6. 手机版抽屉内「盘口/成交」切换正常；
7. 三种语言下显示均成立。

## 明确不做

- **主动买/卖占比统计条**（方案 C）：需额外定义统计窗口、处理窗口未满、决定是否随周期重置，为一个侧栏面板增加的复杂度不成比例。日后需要时可在本设计之上增量添加。
- **合约成交明细**：合约行情在另一端点（`wss://open-api-swap.bingx.com/swap-market`），本设计只覆盖现货路径，与当前订单簿的覆盖范围一致。
- 多档大单分级（大 / 超大）：徒增视觉噪音，单一强调级别已足够。
