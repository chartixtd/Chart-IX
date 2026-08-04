# Chart-IX 产品优化路线图

> 本文件是当前优化计划与关键决策的唯一事实来源（single source of truth）。
> 每完成一项就更新状态。最后更新：2026-07-25。

## 产品背景与北极星

- **定位**：加密货币交易教育 + 实盘交易一体化平台（品牌），面向**新手小白 + 有点经验的散户**。
- **商业模式**：靠 **BingX 合作交易商**的交易量返佣变现。合格用户（达到交易量）由我们在**后台手动**调整为 Pro。
- **北极星指标**：**让新手敢下第一单、并持续交易**（激活 → 交易量）。教育是手段，交易激活是目的。
- **上线状态**：尚未正式上线，已累计部分客户群，之后会做 KOL 推广。**注意：落地页与产品内不出现任何 KOL 宣传/信息。**

## 已锁定的决策（2026-07-24）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 合作交易商 / 引流 | BingX。合格用户由我们在后台手动调整为 Pro（无需在代码里做交易量自动判定）。 |
| 2 | Pro 获取方式 | 保留付费/定价页（让非我们招募的用户也能用）；**不接支付网关**，升级页留 **Telegram 联系方式**，由 admin 手动开通。 |
| 3 | 模拟盘门槛 | **需要注册登录**才能玩。 |
| 4 | Onboarding 终点 | 引导新用户去**玩模拟盘**（最贴北极星）。 |
| 5 | 范围 | **做完整功能**（不只做第一梯队）。 |
| 6 | 品牌 Logo | 已提供 `logo/logo.png`（1408×768）。派生导航 logo / favicon / OG 图，替换现有文字 logo。 |
| 7 | 落地页 | **整页重新设计**，不提任何 KOL 信息。 |
| 8 | 教育内容 | 平台只搭**框架**（学习路径/进度/测验系统 + admin 上传界面），内容由团队自行准备上传。 |
| 9 | KOL 内容账号/专区 | 不做，以平台为主。 |
| 10 | 合规/免责 | 先放**基本风险提示**。 |
| 11 | 每日市场简报 | **暂缓**，之后再详细讨论。 |
| 12 | 数据分析 | **HOLD（先不做）**，见暂缓清单。 |
| 13 | 通知渠道（邮件/Push/Telegram bot） | **HOLD（暂不做）**，见下方"暂缓/挂起清单"。 |
| 14 | 错误监控 | ✅ 已接入 Sentry（`@sentry/nextjs`），已用真实错误验证事件能送达 Sentry 项目。 |

### 产品细节（按默认）
- 模拟盘初始虚拟余额：**$10,000 USDT**。**已升级为杠杆永续合约模型**（做多/做空、杠杆、保证金、强平价、已实现/未实现盈亏、单向净持仓），按最新真实价成交（无滑点模拟），支持市价单 + 限价单。见 `018_paper_futures.sql` / `019_close_paper_position.sql` 与 docs/project.md 6.6。
- 简单模式订单类型：**市价 + 限价**；其余（Stop/Trigger/OCO）收进"高级"。
- 移动端交易布局：**Tab 切换（图表 / 下单 / 订单簿）**。
- 登录后落地页：**`/dashboard`**（继续学习 + 自选行情 + 模拟盘战绩 + 最新内容）。
- 徽章/成就：**先纯荣誉**，不发实际奖励。
- 推荐/邀请：先不做；只保留"晒单分享"。

---

## 构建计划（分阶段）

### 阶段 0 — 品牌与地基（KOL 上线第一印象，全部无外部依赖）
- [x] Favicon / Apple 图标 / OG 分享卡：用代码生成（`src/app/icon.tsx` / `apple-icon.tsx` / `opengraph-image.tsx`），配色对齐品牌 token，已用真实构建验证。**导航栏 logo 仍是文字版**——见下方"待用户提供"，`logo/logo.png` 是烘焙了假棋盘格背景的低保真预览图，无法直接抠图使用，需要一份干净的透明 PNG/SVG 源文件。
- [x] 全站 OG / Twitter meta + per-locale SEO title/description（`generateMetadata` + next-intl 服务端翻译，顺带修好了之前没接的 next-intl Next.js 插件）
- [x] **落地页整页重设计**（无 KOL 信息）：Hero（含风险提示 caption）+ 信任信号 4 项 + 运作三步 + 功能展示（保留）+ 实时行情（保留）+ 二次 CTA + 独立风险提示区块。三语言文案已全部完成并验证。
- [x] 基本风险提示：落地页专门区块 + 页脚（已有）。**交易页显要处的风险提示待阶段 1（下单确认弹窗）一并做**。

### 阶段 1 — 交易激活核心 ✅ 已完成（2026-07-24），待办见下方"需要你做"
- [x] **模拟盘 / Paper Trading**：登录后可用，$10k 虚拟余额。初版为现货（`010_paper_trading.sql`），**后升级为杠杆永续合约模型**（`018_paper_futures.sql`）——做多/做空、杠杆(1-125x)、保证金、强平价、已实现/未实现盈亏、单向净持仓；市价单立即成交 + 限价单（`014`/`016`）。API 在 `src/app/api/paper/`；统一下单表单 `OrderForm`（`src/components/trade/order-form/`）以 `market="paper"` 支持，`PaperOrdersPanel` 显示余额/持仓/成交记录。交易页顶部 Spot/模拟盘/Futures 三态切换，未登录时模拟盘显示🔒引导登录。**平仓改为按持仓量精确全平**（`019_close_paper_position.sql`），修复此前残留仓位需点两次的问题。
- [x] 交易表单**简单/专业模式**切换：简单模式只显示市价+限价，专业模式显示全部订单类型（[OrderForm.tsx](src/components/trade/order-form/OrderForm.tsx)，现货/合约/模拟盘统一由这一套组件驱动，不再有独立的 `TradeForm.tsx`/`FuturesTradeForm.tsx`）。
- [x] 下单确认弹窗：大白话摘要（"你将买入约 X BTC，使用 Y USDT"）+ 占余额比例（模拟盘可算，实盘因未接入余额查询暂不显示这一行）+ 风险提示（[OrderConfirmModal.tsx](src/components/trade/OrderConfirmModal.tsx)）。
- [x] **移动端交易页**：`<lg` 断点切换为 图表/下单/订单簿 三 Tab 布局，symbol 通过弹窗选择器切换（[trade/page.tsx](src/app/[locale]/trade/page.tsx)）。
- [x] 自选/收藏交易对：星标点击收藏，localStorage 持久化（zustand persist），收藏项自动置顶（[favorites.ts](src/stores/favorites.ts) + [MarketOverview.tsx](src/components/trade/MarketOverview.tsx)）。
- [x] **图表进出场标记 + 止盈止损/进场/强平价格线**（2026-07-25）：K 线图叠加成交箭头（买绿↑/卖红↓）与价格线（进场蓝实线、强平橙虚线、止盈绿虚线、止损红虚线、限价紫虚线），现货/模拟盘/合约三种市场都支持。`KlineChart` 新增 `tradeMarkers`/`priceLines` props（lightweight-charts v5 `createSeriesMarkers` + `createPriceLine`），[useChartOverlay.ts](src/hooks/useChartOverlay.ts) 按市场聚合数据。止盈止损依赖 BingX 挂单返回的 TP/SL 订单；模拟盘暂无独立 TP/SL 字段，只画进场价 + 强平价。

### 阶段 2 — 承接与留存 ✅ 已完成（2026-07-24），待办见下方"需要你做"
- [x] **登录后 Dashboard**（`/dashboard`）：继续学习 + 模拟盘战绩 + 自选行情 + 最新视频/文章 + 已获成就。登录用户点 Logo/导航栏落地于此（[dashboard/page.tsx](src/app/[locale]/dashboard/page.tsx)）。
- [x] **Onboarding 引导**：首次登录弹窗三步——选水平 → 推荐学习路径/模拟盘 → 功能导览。状态存在 `users.onboarding_completed`，换设备登录不会重复打扰（[OnboardingModal.tsx](src/components/onboarding/OnboardingModal.tsx)）。
- [x] **学习路径系统**：一条路径 = 一组有序视频课程，顺序即前置（完成上一课才解锁下一课），总进度条基于 `video_progress` 计算，不额外建进度表。用户端 `/learn` 列表 + `/learn/[slug]` 详情，admin 端 `/admin/learning-paths` 可视化编排（选视频、排序、发布）。
- [x] 随堂小测框架：挂在视频下的单选题小测，`/admin/quizzes` 里创建/编辑，用户在视频详情页作答，60% 及格。成就/徽章：预置 5 个里程碑（首次登录/完成课程/完成路径/首次模拟交易/首次通过小测），纯荣誉不发权益，命中时自动授予，Dashboard 展示。
- [x] admin 后台：学习路径、随堂小测的可视化管理界面已就位（视频管理本来就有）。
- [x] 升级页加 Telegram 联系入口（决策 #2）：读取 `admin_settings.telegram_group`，已用真实数据验证渲染正常。

🔒 **顺带修复的严重安全漏洞**：开发过程中发现 `/api/admin/*` 全部 9 个接口完全没有权限校验（`middleware.ts` 只保护了 `/admin` 页面路由，没覆盖 `/api/admin/*`）——任何未登录的人都能调用这些接口改任意用户的 role/tier（可自封 admin+Pro）、增删视频/文章/定价等。已给所有接口加上统一的 `requireAdmin()` 校验（[admin-auth.ts](src/lib/supabase/admin-auth.ts)），并用真实的越权请求验证修复生效。**这个改动不需要跑数据库迁移，代码层面已直接生效。**

### 阶段 3 — 传播与度量 ✅ 已完成（2026-07-24）
- [x] 晒单 / 成绩卡片：用 `ImageResponse` 生成品牌化的模拟盘战绩图（总资产/盈亏/已获成就数），Dashboard 里点"📤 分享"预览+下载，已用真实图片验证渲染效果（[api/share/performance](src/app/api/share/performance/route.tsx)）。
- [x] Telegram 社群入口：页脚读取 `admin_settings.telegram_group`，已用真实数据验证渲染正常。
- [x] Sentry 错误监控（决策 #14）
- [x] 价格提醒（站内版）：交易页 🔔 按钮设置目标价，全局 watcher 监听实时行情，触发时站内 toast 提醒 + 导航栏铃铛角标，本地持久化。已用真实触发场景验证全链路（设置→触发→铃铛显示）。**主动推送到邮件/手机仍需通知渠道解冻**（见挂起清单）。
- [x] 文章页 SSR + meta + sitemap：文章列表/详情页本来就是 SSR（之前没注意到），补上了 per-article `generateMetadata`（标题/描述/OG 用文章内容自动生成）+ 全站 `sitemap.xml`（含所有已发布文章/视频/学习路径 × 三语言）+ `robots.txt`。

### 阶段 4 — Pro 价值与进阶（规模起来后）
- [x] Pro 功能"锁着露一角"提前种草 + 高级图表指标（2026-07-24）：发现 `feature_flags` 表之前只在 admin 后台能改，用户端从没真正读取过（形同虚设），现在补了 [useFeatureFlags.ts](src/hooks/useFeatureFlags.ts) 真正接入判断（fail-open，flag 没配置或没加载完时不会误锁）。交易页图表加了 MA(7/25) 均线 + RSI(14)，免费用户能看到"📊 指标 🔒"入口点开是"升级 Pro 解锁"引导，Pro 用户点开是真正能用的指标开关。用的都是既有的 `advanced_chart` flag，admin 后台一直有的开关现在真正生效了。

---

## 暂缓 / 挂起清单（HOLD）

- **通知渠道** — 决策 #13 已于 2026-08-04 解冻 Web Push 部分（见 [手机 PWA 设计文档](docs/superpowers/specs/2026-08-04-mobile-pwa-design.md)）。邮件渠道仍然挂起。
  影响：价格提醒暂时只能做"站内提醒"，无法主动推送到邮件/手机；"未完成课程提醒"等主动召回功能一并挂起。等这个解冻后再补齐。
- **每日市场简报** — 决策 #11，待后续详细讨论（自动生成 vs 人工维护未定）。
- **交易量 → 自动解锁 Pro** — 决策 #1，暂由后台手动调整，不做自动判定。
- **数据分析（GA4 / PostHog）** — 决策 #12，**先不做**。等要看 KOL 漏斗数据时再接。

## 需要用户提供 / 待定

- **⚠️ 需要手动跑的 SQL 迁移**（按顺序，去 Supabase SQL Editor 贴上执行）：
  - `009_sync_tier_role_to_jwt_claims.sql`
  - `010_paper_trading.sql`（模拟盘账户/持仓/下单）
  - `011_learning_paths.sql`（学习路径 + 步骤）
  - `012_quizzes_achievements.sql`（小测 + 成就；这个文件里也用 `CREATE OR REPLACE` 顺带给 010 的下单函数加了"首次模拟交易"成就授予，所以必须在 010 之后跑）
  - `013_onboarding.sql`（users 表加两个字段）
  - `014_paper_limit_orders.sql`（模拟盘限价单）
  - `015_video_notes.sql`（视频笔记）
  - `016_paper_limit_order_rpc.sql`（限价单 RPC）
  - `017_user_preferences.sql`（交易页偏好记忆）
  - `018_paper_futures.sql`（模拟盘升级为杠杆永续合约模型；⚠️ 破坏性：重置持仓/余额）
  - `019_close_paper_position.sql`（按持仓量精确平仓 RPC）
  - `020_trading_limits.sql`（交易风控限额表 + 放宽 orders.order_type + api_keys 增列 masked/primary/权限标记 + 用 `CREATE OR REPLACE FUNCTION` 修正 006 的 `trg_increment_trade_count` 触发器使其跳过 `risk_rejected` 订单（不改触发器本身，只替换其函数体，OID 不变自动生效）；⚠️ 两条 orders 的 ADD CONSTRAINT 会短暂对 orders 表加 ACCESS EXCLUSIVE 锁、两条 CREATE INDEX 会短暂阻塞对应表写入，当前数据量小预计很快，但不是零；文件内含验证：执行后若某用户所有 API Key 都是 `is_valid = false`，该用户不会被自动补上 `is_primary = true`，这是预期行为，不代表迁移出错）
  - `026_push_and_alerts.sql`（Web Push 订阅、价格提醒、通知偏好、cron 心跳）
  - `027_push_subscriptions_update_policy.sql`（补上 push_subscriptions 缺失的 UPDATE 策略，修复重新订阅时 upsert 被 RLS 拒绝）
  - `028_push_cron_jobs.sql`（定时任务搬到 Supabase pg_cron；执行前需替换 SITE_URL 与 CRON_SECRET 占位符）
  不跑的话对应功能会报错，但前端都做了优雅降级（不会白屏崩溃），比如 `/learn` 页面会显示"即将上线"而不是报错。
- **干净的 logo 透明源文件**（PNG 透明背景或 SVG/AI）——现有 `logo/logo.png` 是烘焙了假棋盘格的低保真预览图（alpha 全不透明，棋盘格是真实灰色像素且间距不规则），像素级抠图两轮都做不干净，暂不能用。只需要图形标（"D-X"那个符号）单独一份透明图即可，导航栏/favicon 用得上。
- 落地页文案定位一句话、信任信号措辞、社群链接（Telegram）——当前落地页文案是我起草的，可以再改。
- 学习路径的实际课程内容（团队自备，走 admin 上传）。
