# Chart-IX 全局感知性能优化 · 设计文档

日期：2026-08-07
状态：已获用户批准（方案 A：全面系统化优化）

## 背景与目标

用户反馈四类"慢"的症状：①点击导航后停顿才跳转；②跳转快但内容区转圈久；③首次打开网站特别慢；④操作后反馈慢。全项目扫描（23 个问题点）确认瓶颈为复合型：服务端认证瀑布拖慢 TTFB、客户端缺 loading 边界与缓存利用、图表周期性全量重算、鉴权 API 三跳串行。

**目标**：全站（含 admin）感知性能优化到极致——点击任何功能 100ms 内有视觉响应，已看过的内容即时显示。

**已确认的约束与取舍**（用户逐项批准）：

- 数据策略：内容/列表/仪表盘允许"旧数据先上、后台静默刷新"；**持仓、余额、挂单、订单等交易关键数据必须实时准确**，不适用此策略。
- 用户环境：东南亚（马来西亚为主），手机与桌面并重。
- 范围：用户面 + admin 后台全部包含。
- 沿用现有技术栈（Next.js 15 / React 19 / Supabase / React Query / Zustand / lightweight-charts），不引入重型新依赖。
- 所有功能与交互逻辑保持不变，只优化性能与反馈。

## 现状扫描结论（摘要）

已做得好的部分（不动）：ffmpeg/tiptap/lightweight-charts 均已动态加载；WS 单例 + 引用计数；行情代理有 CDN 缓存头（`market-guard.ts`）；`ttl-cache` + DB 跨实例缓存；MarketOverview 细粒度订阅 + 虚拟滚动；K 线实时价已有 rAF 增量路径；`site-settings` 已用 React `cache()`。

核心问题（按严重度）：

1. `getServerAuth()`（`src/lib/supabase/get-auth.ts:33`）串行两次 Supabase 往返且未用 `cache()`，layout+page 重复调用；登录用户首页→dashboard 路径 6 次串行往返才出首字节。
2. articles/videos/learn 列表页声明了 `revalidate = 300`（ISR），但父布局 `[locale]/layout.tsx:65` 读 cookie 使全部路由降级为动态渲染，ISR 失效。
3. 全项目 0 处使用 `placeholderData`/`keepPreviousData`：切交易对/周期、页面往返全部塌陷重来。
4. K 线图每 10 秒全量 `setData` + 全部指标全序列重算（`KlineChart.tsx:396-505`）；价格线每 5 秒全部摘除重画（`:605-612`）。
5. 鉴权 BingX 路由（positions/balance/orders 等）每次请求三跳串行：Supabase Auth（网络）→ api_keys（DB）→ BingX，被 5~15 秒轮询反复支付。
6. 最慢的客户端页面（/trade、/dashboard、/orders、/settings、/videos/[id]、/learn/[slug]、全部 admin）均无 `loading.tsx`。
7. 手写 useEffect 取数页面：/orders（无 limit、无缓存、串行）、/settings（加载中闪"请先登录"）、/upgrade（价格区无占位）、/learn/[slug]（4 段串行瀑布）、/videos/[id]。
8. `useDashboardOrders` 无 `.limit()`；screener 缓存过期后由用户请求承担 400~800 次上游重算；公开行情代理 fetch 无超时；桌面端交易页首帧渲染手机布局后整树重挂；全局 5 个 headless 组件在所有页面发额外查询。

## 实施顺序

按第 1→4 节顺序分四个阶段实施，每个阶段独立可验证、可单独发布；第 5 节的测试与验证在对应阶段内同步完成，不留到最后。

## 第 1 节：服务端 TTFB——砍掉认证瀑布

1. **`getServerAuth()` 用 React `cache()` 包裹**：同一请求内 layout+page 只执行一次，与 `site-settings.ts:85` 做法对齐。
2. **消灭 display_name 第二次往返**：昵称写入 Supabase Auth `user_metadata`（settings 修改昵称时同步更新 auth metadata），`getUser()` 一次往返带回昵称；metadata 缺失时回退邮箱前缀。不再单独查 `users` 表。
3. **恢复 ISR 静态直出**：articles / videos / learn 列表页迁入路由组 `[locale]/(static)/`，该组 layout 不做服务端认证（不读 cookie）。页头登录态改由客户端组件水合后经 `/api/auth/me` 获取（React Query 缓存 5 分钟），未就绪时显示中性占位（非"登录"按钮，避免闪变）。URL 不变。
4. 其余需认证页面保持现有结构。

**效果**：登录用户首页→dashboard 从 6 次串行往返降到 2 次；三个内容页变 CDN 静态命中。

## 第 2 节：导航即时反馈——点击 100ms 内必有响应

1. **补齐 `loading.tsx`**：/trade、/dashboard、/screener、/orders、/community/[id]、/videos/[id]、/learn/[slug]、/settings、/settings/api-keys、/more、/more/alerts、/more/notifications、/upgrade，及全部 11 个 admin 页面。骨架屏与真实页面布局同形，复用现有 `ui/` 骨架风格。
2. **React Query 全局 `placeholderData: keepPreviousData`**；内容类查询（dashboard 卡片、社区、视频、成就等）`staleTime` 提至 5 分钟、`gcTime` 30 分钟。**交易关键数据（持仓/余额/挂单/订单）保持现有短 staleTime**。
3. **useEffect → useQuery 迁移**：/orders（加 `.limit(200)`）、/settings（区分 loading 与未登录，修"请先登录"闪现）、/upgrade（价格卡骨架占位）、/videos/[id]、/learn/[slug]。
4. **/learn/[slug] 压平瀑布**：path+steps 一条 join 查询；progress 并行；公开内容不等认证态就绪即发起。4 段串行 → 约 1.5 往返。
5. **`useDashboardOrders` 加 `.limit(50)`**（dashboard 账本区只渲染有限条，50 条足够覆盖其客户端 filter 展示需求），与同文件其他查询对齐。

已知取舍：staleTime 5 分钟意味着他人新内容最多延迟 5 分钟自动出现（主动刷新/切页仍即时）。

## 第 3 节：交易页顺滑——切换不塌陷、图表不卡顿

1. **切换保留旧数据**：盘口、成交、K 线、合约 overlay、交易规格等以 symbol/interval 为 key 的查询启用 `keepPreviousData`；刷新中对旧数据轻微降透明度示意；骨架仅真正首载出现。
2. **K 线增量更新**：全量 `setData` 仅在 symbol/interval 切换或翻页加载历史时执行；常规 10 秒轮询只 diff 最后 1~2 根变动蜡烛走 `update()`（复用现有 rAF 增量路径）；指标对新收线蜡烛做增量追加计算。不适合增量的指标退化为"仅收线时重算"。
3. **价格线/标记 diff**：按内容签名对比，无变化不动，有变化只增删改差异项。消除 5 秒周期闪烁。
4. **桌面首帧修复**：`useMediaQuery` 客户端 lazy initializer 同步读 `matchMedia`，水合首帧即正确布局，消除"手机布局闪现→整树重挂→图表建两次"。SSR 输出由 loading.tsx 骨架覆盖。
5. **交易页面板按需加载**：OrderForm、OrdersPanel、PaperOrdersPanel、FuturesInfoPanel 等改 `next/dynamic`，按市场类型与断点加载。
6. **PaperOrdersPanel 手写轮询迁入 React Query**，与 `usePaperAccount` 共享缓存与去重。

## 第 4 节：API 提速——砍三跳、加超时、后台刷新

1. **鉴权 BingX 路由砍两跳**：
   - 只读路由第一跳改本地 JWT 校验（`getClaims()` + JWKS 验签），不再每次网络到 Auth 服务；
   - 解密后的 API 密钥加每用户 60 秒进程内 TTL 缓存（复用 `ttl-cache` 模式），换密钥最多 60 秒生效；
   - **下单/撤单等写操作路由保留完整网络校验**，安全边界不变。
2. **公开行情代理加超时**：`bingx/client.ts` fetch 加 `AbortSignal.timeout(8000)`，与签名请求（10s）、模拟盘下单（8s）对齐。
3. **`ttl-cache` 升级 stale-while-revalidate**：过期先返回旧值、后台异步重算；screener 响应补 `Cache-Control: s-maxage`。消灭"每小时一个用户等 400~800 次上游重算"。
4. **全局 headless 组件降载**：onboarding 完成状态写 localStorage 永久记忆；`PaperTpSlWatcher` 仅交易相关页面激活；其余 watcher `requestIdleCallback` 空闲挂载。
5. **admin 中间件收敛**：角色查询结果加短 TTL 缓存，减少每请求两次 Supabase 查询。
6. **`next.config.mjs` 加 `experimental.optimizePackageImports`**（next-intl、@tanstack/react-query 等）。

已知取舍：本地 JWT 校验下，被封禁用户的已签发 token 在剩余有效期（默认 ≤1 小时）内仍可通过只读轮询校验；写操作不受影响。

## 第 5 节：错误处理、测试与验收

**错误处理**："旧数据先上"场景后台刷新失败不清空旧数据，仅角落轻量提示（复用 WS 断线提示风格）；行情请求超时/失败交给 React Query retry，不弹打断性错误。

**测试**（vitest，沿用现有设施）：

- `ttl-cache` stale-while-revalidate 行为；
- 指标增量计算与全量计算结果一致性；
- 价格线 diff 逻辑。

（此三处为"算错会展示错误数据"的地方，必须有测试兜底。）

**行为验证**：本地 dev + Slow 4G 节流走关键路径：登录→dashboard→trade→切币→切周期→回 dashboard→文章页，确认无白屏、无塌陷、无闪烁。回归重点：静态内容页登录态显示；本地 JWT 下登出用户 token 过期后只读轮询正确 401。

**验收标准**：

1. 点击任何导航 100ms 内出现视觉响应（骨架或旧内容）；
2. 已访问页面二次进入即时显示内容；
3. 切交易对/周期时盘口、图表不塌陷成骨架；
4. K 线常规使用（含加载 5 页历史后）无周期性卡顿，价格线不闪烁；
5. 文章/视频/学习列表页 CDN 静态命中（响应头验证）；
6. 持仓/余额轮询 API 服务端耗时降至只剩 BingX 上游耗时（日志验证）。

## 明确不做（二期待办）

- 盘口/成交 WebSocket 化（当前仅 ticker 频道；升级后盘口从 2 秒跳变变平滑滚动）——方案 C 内容，A 完成后二期评估。
- Supabase / Vercel 区域迁移。
- Service Worker 离线缓存扩展。
