# 手机 PWA 版本设计文档

**日期**: 2026-08-04
**状态**: 已确认
**范围**: 全站用户端（14 个现有页面 + 1 个新增）+ PWA 平台层 + Web Push 子系统
**不含**: `/admin/*` 后台（12 个页面，整体排除）

---

## 背景

项目当前**没有任何 PWA 基础设施**，且移动端适配远比想象中薄：

- `public/` 只有 `logo.png`。没有 manifest、没有 service worker、没有 192/512/maskable 图标。现有的 [icon.tsx](../../../src/app/icon.tsx) / [apple-icon.tsx](../../../src/app/apple-icon.tsx) 是运行时 `ImageResponse` 动态生成的，只能当 favicon，**不能作为 manifest 的图标源**。
- `app/layout.tsx` 没有 `viewport` 配置，没有 `viewport-fit=cover`，安全区（刘海 / 灵动岛 / home indicator）完全没处理。
- [Navbar.tsx:73](../../../src/components/layout/Navbar.tsx#L73) 的导航是 `hidden md:flex`——**手机上没有任何导航菜单**，只剩 logo 和右侧按钮。
- 各路由响应式工具类统计：`settings` **0**、`orders` **0**、`screener` 1、`videos`/`articles`/`news`/`learn` 各 4、`dashboard` 8。
- 下单表单字段（[order-form/fields/](../../../src/components/trade/order-form/fields)）普遍使用 `text-xs`（12px），**iOS Safari 会在每次聚焦时自动放大页面**。
- 唯一做过移动端的是交易页（[trade/page.tsx:456](../../../src/app/[locale]/trade/page.tsx#L456)），已有 图表/下单/订单簿 三 Tab 布局。

同时 [ROADMAP.md](../../../ROADMAP.md) 的挂起清单中，通知渠道（含 Web Push）是决策 #13 明确"暂不做"的。**本次设计将其解冻**——见「关键决策」。

---

## 目标与非目标

### 目标

1. 站点可被"添加到主屏"，在 iOS 与 Android 上均以独立应用形态全屏运行。
2. 手机上具备原生观感的导航壳：底部 tab bar、bottom sheet 交互、页面切换连续性。**桌面版布局与交互不变。**
3. 断网时应用不白屏；已访问过的教育内容可离线重读。
4. Web Push 打通：价格提醒、选币榜单、新内容上线三类推送。
5. 三语（zh-CN / en-US / ms-MY）在移动端全部成立，包括主屏应用名。

### 非目标

- **不做 `/admin/*` 的移动适配。** 后台是单人使用的内部工具，表格类界面适配投入产出比最低，且不应被装进主屏。
- **不做实盘订单成交 / 爆仓推送。** 需要服务端为每用户维持 BingX WebSocket 常驻连接，Vercel serverless 模型做不到，引入常驻服务违反技术栈约束。原因见「已知限制」。
- **不做主动离线下载课程。** 见「关键决策」中的离线范围。
- **不做学习召回推送**（"你有课程没看完"）。在推送权限还脆弱的第一版里，一次没营养的通知就可能换来永久关闭。
- 不引入 Playwright / e2e 框架。

---

## 关键决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 形态 | **移动优先的原生观感应用**（同一套路由与数据层，仅在布局壳层分叉） | 独立 `/m/*` 路由树会让三语文案、权限门禁、行情 hooks 全部分叉两套；纯响应式给不了"随手打开就能看行情"的心理位置 |
| 2 | Web Push | **解冻，完整实现** | iOS 上推送必须装到主屏才能用，推送就是用户愿意安装的主要理由。不做推送则安装对用户几乎没有回报 |
| 3 | 推送事件 | 价格提醒 + 选币榜单 + 新内容上线 | 见「非目标」中排除的两类 |
| 4 | 页面范围 | 用户端 13 个路由全做，后台整体排除 | 见「非目标」 |
| 5 | 离线范围 | **外壳 + 读过的内容**（stale-while-revalidate） | 匹配 SEA 移动网络场景；主动下载在 iOS 的存储驱逐策略下是信任陷阱 |
| 6 | 底部导航 | **4 个常规 tab + 1 个中央凸起键**（`更多` 为其中一个常规 tab） | 用户选定 |
| 7 | Service Worker | **手写 `public/sw.js`**，不用 Serwist / next-pwa | Workbox 的核心价值是 precache manifest，解决"安装后首次冷启动即可离线"——但用户必须先访问过网站才可能装它，届时运行时缓存已经是热的。**precache 解决的是一个不会遇到的问题** |
| 8 | 壳层共存 | **单棵内容树，双套外壳** | 见下方「核心原则」 |
| 9 | Cron 宿主 | **Supabase Cron（pg_cron + pg_net）**，删除 `vercel.json` 的 crons | Vercel Hobby 最小间隔为每天一次，每分钟巡检不可能。见「前置条件」 |
| 10 | 双指缩放 | **禁用**（用户明确要求） | 实现与限制见 L0 |
| 11 | 新依赖 | 引入 `web-push` | VAPID 的 ES256 签名 + aes128gcm payload 加密手写约三百行密码学代码，错一字节即**静默失败**无任何反馈 |
| 12 | 交易页布局 | **图表全屏 + 底部操作条 + sheet**，消除子 tab | 见 L3 |

### 核心原则：单棵内容树，双套外壳

**页面内容永远只渲染一份**，靠响应式 CSS 适配；**只有导航外壳允许桌面/手机双份共存**（它是静态的、无副作用的）。

这条规则的存在有实证依据：[useUserDataStream.ts](../../../src/hooks/useUserDataStream.ts) 的引用计数机制，本质是在给交易页"同一个组件同时挂载桌面版和手机版两份"擦屁股——两份都调 `useUserDataStream`，不加引用计数就会建两条 BingX WebSocket。把这个模式推广到全站，每个抓数据的组件都要面对同一个问题。

**本次一并修掉交易页的双挂载**，改成单棵树 + 响应式，让引用计数回归"多个不同组件共享连接"的正常用途。

---

## 架构总览

```
L0  PWA 平台层    manifest · service worker · 图标 · 安装引导 · 离线兜底
L1  移动导航壳    底部 tab · 精简 header · /more 聚合页 · 学习 hub
L2  推送子系统    订阅表 · VAPID 发送器 · Supabase Cron 巡检 · SW 事件处理
L3  页面移动化    13 个用户端路由的响应式重排
```

依赖：L1 独立；**L2 依赖 L0**（没有 SW 就没有推送）；**L3 依赖 L1**（外壳先定下内容区边界）。L0 与 L1 可并行。

**实现顺序：L0 → L1 → L3 → L2。** L2 排最后，因为它依赖 L0 的 SW 稳定落地，且是唯一需要真机装到主屏才能验证的部分——放在最后可以在一个已经能用的 PWA 上验证，而不是在半成品上调。

### 模块清单

| 层 | 新增 | 改动 |
|---|---|---|
| L0 | `public/sw.js`<br>`public/sw-strategy.js`<br>`public/icons/*`<br>`app/[locale]/manifest.webmanifest/route.ts`<br>`components/pwa/ServiceWorkerRegistrar.tsx`<br>`components/pwa/InstallPrompt.tsx`<br>`lib/pwa/platform.ts`<br>`app/[locale]/offline/page.tsx` | `app/layout.tsx`<br>`next.config.mjs`<br>`tailwind.config.ts`<br>`globals.css` |
| L1 | `components/layout/MobileTabBar.tsx`<br>`components/layout/MobileHeader.tsx`<br>`app/[locale]/more/page.tsx` | `ClientLocaleLayout.tsx`<br>`Navbar.tsx`<br>`app/[locale]/learn/page.tsx` |
| L2 | `supabase/migrations/026_push_and_alerts.sql`<br>`lib/push/send.ts`<br>`lib/push/evaluate.ts`<br>`api/push/subscribe`<br>`api/push/unsubscribe`<br>`api/cron/price-alerts`<br>`app/[locale]/more/alerts/page.tsx`<br>`app/[locale]/more/notifications/page.tsx`<br>`components/pwa/PushOptIn.tsx` | `stores/priceAlerts.ts`<br>`components/alerts/PriceAlertWatcher.tsx`<br>`api/cron/telegram-push/route.ts`<br>`vercel.json`（删 crons） |
| L3 | — | 13 个路由 + `components/ui/Modal.tsx` |

### 两处结构性改动

**`/learn` 变成学习中心。** 现在它只承载"学习路径"，需要变成 `学习` tab 的 hub：顶部三个分区入口（视频课程 / 文章 / 学习路径），学习路径本身的内容下沉为其中一节。**桌面版同步改**，否则两端信息架构分叉。

**价格提醒从 localStorage 搬进数据库。** 详见 L2。

---

## L0 · PWA 平台层

### 视口与安全区

在 `app/layout.tsx` 导出 Next 15 的 `viewport`：

```
width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no
viewport-fit=cover
themeColor: #0B0A08
```

**安全区**用 `env(safe-area-inset-*)`，在 [tailwind.config.ts](../../../tailwind.config.ts) 注册成间距令牌，避免满屏 arbitrary value。

**高度一律用 `100dvh`**（iOS 15.4+ / Chrome 108+），保留 `100vh` 作为前置声明兜底老浏览器。

### 禁用双指缩放

**技术真相**：仅靠 `user-scalable=no` 在 iOS 上无效——iOS 10 之后 Safari 出于可访问性主动忽略它。但**在已安装到主屏的 standalone 模式下，禁用缩放是生效的**。

> **结论：装了的 App 里能禁掉，浏览器标签页里 iOS 不保证。** 这是系统限制，不做过度承诺。

三层实现：

1. **viewport** — `user-scalable=no, maximum-scale=1`（Android Chrome 直接生效）
2. **CSS** — `html { touch-action: pan-x pan-y }` 杀掉捏合；交互元素加 `touch-action: manipulation` 顺带消除双击缩放的 300ms 延迟
3. **JS** — 监听 WebKit 私有的 `gesturestart` / `gesturechange` / `gestureend` 并 `preventDefault()`，这是 iOS 上真正起作用的机制

**关键例外：K 线图必须保留双指缩放。** [KlineChart](../../../src/components/trade/KlineChart.tsx) 依赖捏合缩放时间轴。两重保证：

- `touch-action` **不是继承属性**，设在 `html` 上不会传给图表容器
- document 级的 gesture 监听加一道 `e.target.closest("[data-allow-zoom]")` 判断，图表容器和绘图层挂上该属性即豁免

**连带硬性要求**：禁用缩放后用户失去了放大这个逃生口。因此 `globals.css` 中加全局规则，强制 `<1024px` 时所有 `input / select / textarea` 最小 **16px**。写成全局规则而非逐组件改，因为下单表单有十几个字段，逐个改一定会漏且新字段会退化。三语（尤其中文小字号）的最小字号在实现时逐页核一遍。

### Manifest：三语一个 App

路由 `app/[locale]/manifest.webmanifest/route.ts`，`generateStaticParams` 静态化。该路径含点号，落在 [middleware.ts](../../../src/middleware.ts) 的 matcher 排除规则（`.*\..*` 分支）之外，不会被 i18n 中间件拦截。`/sw.js` 同理。

| 字段 | 值 | 说明 |
|---|---|---|
| `id` | `"/"`（**三份完全一致**） | 这是"三个语言版本是同一个 App"的唯一保证。`id` 不同会被浏览器当成三个应用，切语言后装出第二个图标 |
| `start_url` | `/{locale}/dashboard?source=pwa` | 会装 App 的基本都是已登录用户，直达仪表盘省一次重定向；未登录会被 middleware 送去登录页，行为也正确 |
| `scope` | `/` | |
| `name` / `short_name` / `description` | 从 [i18n/messages](../../../src/i18n/messages) 取 | 用户手机桌面上的应用名是他自己的语言 |
| `display` | `standalone` | 不用 `fullscreen`（丢状态栏，盯盘的人看不到时间和电量） |
| `display_override` | `["standalone", "minimal-ui"]` | |
| `orientation` | **不设** | K 线图横屏更好，锁死是帮倒忙 |
| `background_color` / `theme_color` | `#0B0A08` | |
| `shortcuts` | 交易 / 选币 | Android 长按图标可见，iOS 不支持，成本极低 |

### 图标

需产出真实 PNG 文件（manifest 不能指向动态路由）：

- `icon-192.png`、`icon-512.png`（普通）
- `icon-maskable-192.png`、`icon-maskable-512.png`——**图形必须收进内圈 80% 安全区**，Android 会按厂商形状（圆形 / 方形 / 水滴）裁切，不留边会被切角
- `apple-touch-icon-180.png`

**顺带修一处颜色漂移**：现有 [icon.tsx](../../../src/app/icon.tsx) / [apple-icon.tsx](../../../src/app/apple-icon.tsx) 用的是 `#0a0a0a` 底 + `#d4a843` 金，而 [DESIGN.md](../../../DESIGN.md) 定义的是 `#0B0A08` 底 + `#C9A24B` 金。这两个文件写在设计系统确立之前，本次一并校准。

### iOS 专属处理

| 项 | 做法 |
|---|---|
| `apple-mobile-web-app-capable` | `yes`。iOS 16.4+ 已认 manifest 的 `display`，但该 meta 仍是最可靠路径，保留 |
| 状态栏样式 | `black-translucent`。配合 `viewport-fit=cover` 内容会顶到状态栏下方，**header 必须吃 `safe-area-inset-top` 的 padding** |
| `apple-mobile-web-app-title` | 主屏图标下的名字，同样按 locale |
| 启动图 | 无 `apple-touch-startup-image` 时冷启动会闪**白屏**，在纯黑 App 上非常刺眼。覆盖全机型需二十多个尺寸 × 横竖两向。**做法：只覆盖当前主流 iPhone 尺寸**，老机型与 iPad 接受白闪 |
| 安装引导 | iOS **不触发 `beforeinstallprompt`**，需自绘说明卡：分享按钮 → 添加到主屏幕，配图示 |
| 存储驱逐 | 未安装的站点 7 天不访问，Safari 清除本地数据**包括 Supabase 登录态**。这是"为什么该装"的最佳论据，写进安装引导文案 |
| 橡皮筋滚动 | `overscroll-behavior-y: none` |

### Android 专属处理

捕获 `beforeinstallprompt` 并 `preventDefault()` 存起来，换成自己的安装按钮，**在用户手势中**调 `prompt()`。监听 `appinstalled` 关闭入口。

WebAPK（真正的系统级应用）的前提：manifest MIME 正确、192+512 图标齐全、`start_url` 在 `scope` 内、**且 SW 注册了 `fetch` 事件处理器**。最后一条最容易漏——没有 fetch handler 只能得到书签快捷方式。

### 内置浏览器检测（重要）

Telegram 推送带来的流量会落在 Telegram 内置浏览器中，而该环境：iOS 上**没有"添加到主屏幕"选项**（仅 Safari 有）、通知权限申请会被无声拒绝、存储隔离导致登录态离开即失效。

即：**推送流量最大的渠道恰恰是最装不上 PWA 的环境。** 这是 iOS 系统限制，无法用代码绕过，只能检测 + 引导。

`lib/pwa/platform.ts` 的启发式判断：

| 环境 | 特征 |
|---|---|
| Telegram | `window.TelegramWebviewProxy`（iOS）/ `window.TelegramWebview`（Android） |
| 微信 | UA 含 `MicroMessenger` |
| Line | UA 含 `Line/` |
| Facebook | UA 含 `FBAN` 或 `FBAV` |
| 通用 iOS 内置浏览器 | iOS 设备但 UA 无 `Safari` 标识 |

**判断不确定时一律按普通浏览器处理（fail-open）。** 宁可给装不上的人显示安装引导（一次无效点击），也不要把真能装的人挡在门外（永久流失）。

检测到内置浏览器时，安装卡替换为"在 Safari / Chrome 中打开"的引导，并提供一键复制链接。

### Service Worker

**注册**：在 `ClientLocaleLayout` 挂 `ServiceWorkerRegistrar`，**仅生产环境**注册，scope `/`。

**版本方案**：注册时带构建号 —— `register('/sw.js?v=' + BUILD_ID)`，`BUILD_ID` 在 [next.config.mjs](../../../next.config.mjs) 中从 `VERCEL_GIT_COMMIT_SHA` 注入。URL 变化即被浏览器认定为新 SW；`sw.js` 内部用 `new URL(self.location).searchParams.get("v")` 取同一个值命名缓存。**零构建步骤，每次部署自动换代，不依赖人记得改版本号常量。** 同时在 `next.config.mjs` 给 `/sw.js` 加 `Cache-Control: no-cache`。

**缓存策略表**：

| 请求 | 策略 | 缓存分区 |
|---|---|---|
| `/_next/static/**` | cache-first，永不失效（内容哈希命名，天然 immutable） | `cix-static-{v}` |
| `/icons/**`、`/logo.png` | cache-first | `cix-static-{v}` |
| `fonts.googleapis.com` CSS | stale-while-revalidate | `cix-fonts`（**不带版本号**） |
| `fonts.gstatic.com` woff2 | cache-first | `cix-fonts` |
| 导航请求（`mode === "navigate"`） | network-first → 缓存 → `/{locale}/offline` | `cix-pages-{v}` |
| `/api/**` | **直接放行，绝不进缓存** | — |
| 带 `?_rsc=` 的请求 | **直接放行，绝不进缓存** | — |
| 其他跨域 | 不拦截 | — |

字体缓存故意不带版本号——字体文件几年不变，每次部署清空是对用户流量的浪费，在 SEA 移动网络下有感。

> **绝对规则**：`/api/**` 那条必须写成 `fetch` 处理器最开头的**显式 early-return**，而不是靠"没匹配到规则所以走网络"兜底。行情、持仓、下单全走 `/api`，任何一次误缓存都可能让用户基于过期价格做决策。

`?_rsc=` 那条容易被漏：App Router 的客户端跳转拿的是 RSC payload 而非 HTML，它与构建 ID 强绑定。缓存后遇上新部署会产生水合错误——且是"偶发、无法复现、只影响部分用户"的那种。

**安装期预缓存**：`install` 事件仅预缓存一小组已知固定 URL——三语的 `/offline` 页 + 图标。不做构建产物清单（理由见决策 #7）。

**策略函数必须可测，但 `public/sw.js` 不经过打包**——它由 Vercel 原样静态托管，无法 `import` `src/` 下的 TypeScript。因此把策略判定单独拆到 `public/sw-strategy.js`（纯 JS，无模块语法，向 `self` 上挂载 `shouldCache`），`sw.js` 用 `importScripts('/sw-strategy.js?v=' + version)` 载入，vitest 侧读取同一文件后取 `globalThis.shouldCache` 断言。

> 这样做的代价是这一个文件用 JS 而非 TS。**可接受**——替代方案（把 `sw.js` 改成 route handler 以获得打包能力）会让 SW 变成动态产物，增加的复杂度远大于一个文件的类型收益。

**更新流程**：**不无脑调 `skipWaiting()`**——用户可能正在填下单表单，被新版本接管会丢失未提交状态。

```
新 SW 进入 waiting
  → 页面顶部出现"有新版本"提示条
  → 用户点击 → postMessage({type:"SKIP_WAITING"})
  → controllerchange → reload
```

附加保护：**交易页存在未确认订单时不弹提示条**，等订单流程结束再说。另在 `visibilitychange` 时主动 `registration.update()`——装成 App 后会话可能挂数天不刷新，不主动检查就永远拿不到更新。

**登出必须清页面缓存**：`cix-pages` 存的是渲染好的 HTML，仪表盘、订单页含用户数据。登出后这些仍在缓存中，离线时可能被翻出。`signOut` 时向 SW 发消息删除 `cix-pages` 分区——[Navbar.tsx:57](../../../src/components/layout/Navbar.tsx#L57) 的 `handleLogout` 需一并改。这在共用手机的场景下是实际的隐私问题。

**离线兜底页** `app/[locale]/offline/page.tsx`，三语。

---

## L1 · 移动导航壳

### 底部 tab bar

4 tab + 中央凸起，`lg` 断点以下显示；桌面版 [Navbar](../../../src/components/layout/Navbar.tsx) 在 `lg` 及以上显示。二者用 CSS 切换（外壳静态无副作用，允许双挂载——见「核心原则」）。

| 位置 | Tab | 路由 |
|---|---|---|
| 1 | 仪表盘 | `/dashboard` |
| 2 | 学习 | `/learn`（hub） |
| **中央** | **交易** | `/trade` |
| 4 | 选币 | `/screener` |
| 5 | 更多 | `/more` |

**中央凸起的行为是目的地而非动作**：点击直接跳转并显示选中态，不弹菜单。这样凸起只承担视觉权重，不借用 FAB 的动作语义。

**布局注意**：凸起圆盘的上沿会侵入内容区，页面内容的底部 padding 必须按 `tab bar 高度 + 凸起溢出 + safe-area-inset-bottom` 计算，不能只按导航条本身高度算。做成一个 Tailwind 工具类统一使用。

### 精简 header

Chart-IX 标识 + 铃铛（[PriceAlertBell](../../../src/components/alerts/PriceAlertBell.tsx)）。**语言切换从 header 移入 `/more` 的设置**——低频操作不该占手机上最贵的横向空间。header 需吃 `safe-area-inset-top`。

### `/more` 是真实路由，不是抽屉

**理由**：抽屉不进浏览器历史，Android 的返回手势会直接退出 App 而非关闭抽屉——这是 PWA 中最常被投诉的一类 bug。真实路由天然支持返回、深链，以及与 `/settings` 等子页的层级关系。

内容：

- **资讯** `/news`（消费型内容，与系统化课程性质不同，混入学习 tab 会稀释后者）
- **我的订单** `/orders`
- **价格提醒** `/more/alerts`（新页面，管理已设置的提醒）
- **升级 Pro** `/upgrade`——仅 `tier !== "pro"` 时显示，沿用 [Navbar.tsx:29](../../../src/components/layout/Navbar.tsx#L29) 现有判断
- **设置** `/settings`
- **通知设置** `/more/notifications`（新页面）
- **后台** `/admin`——仅 `role === "admin"` 时显示，点进去即现有桌面版后台，不做适配
- **退出登录**

---

## L2 · 推送子系统

### 数据模型（`026_push_and_alerts.sql`）

**`push_subscriptions`**

| 列 | 说明 |
|---|---|
| `user_id` | 外键，`on delete cascade` |
| `endpoint` | **唯一**。一台设备一行，同一用户可有多行 |
| `p256dh` / `auth` | 加密密钥 |
| `locale` | **服务端按订阅时的语言生成通知文案**——通知在用户看不见页面时弹出，无法临时询问客户端语言 |
| `user_agent` / `last_seen_at` / `failed_count` | 运维用 |

**`price_alerts`** — 从 [priceAlerts.ts](../../../src/stores/priceAlerts.ts) 的 localStorage 迁移：`symbol` / `target_price` / `direction` / `triggered_at`。索引为 `(symbol) where triggered_at is null` 的**部分索引**，巡检只扫未触发的。

**`notification_prefs`** — 三个开关：

| 开关 | 默认 | 理由 |
|---|---|---|
| 价格提醒 | 开 | 用户主动设置，期待值最高 |
| 选币榜单 | **关** | 一天 6 条不请自来的推送是权限杀手，让用户主动开 |
| 新内容上线 | 开 | 留存抓手，频率低 |

**`cron_heartbeats`** — 每次巡检写一次时间戳，用于检测静默停摆（见「错误处理」）。

全部启用 RLS：用户只能读写自己的行，service role 全量读。

### 发送侧

引入依赖 **`web-push`**（决策 #11）。运行在 Node runtime（需要 `node:crypto`），**不能用 Edge runtime**。

`lib/push/send.ts` 提供 `sendToUser()` / `sendToOptedIn()`。

- **收到 404 / 410 → 删除该订阅行**。这是端点已失效的标准信号（用户卸载 App、清除数据）。不清理会导致失效端点越积越多，每次群发都白跑。
- **5xx / 429 → `failed_count++`**，**累计到 3 次即删行**（成功推送时重置为 0）。**不重试当次**——价格提醒过时后补发反而有害。

环境变量：`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY`。

> 密钥对生成一次后**不能更换**——更换会使所有存量订阅立即失效。

### 三个触发源

| 触发 | 调度 | 端点 |
|---|---|---|
| 价格提醒 | Supabase Cron **每分钟** | `POST /api/cron/price-alerts` |
| 选币榜单 | Supabase Cron **每 4 小时** | 扩展现有 `/api/cron/telegram-push`，同一次调用同时发 Telegram 和 Web Push |
| 新内容上线 | admin 发布视频/文章时同步调用 | 无需调度 |

均沿用现有的 `Authorization: Bearer $CRON_SECRET` 校验模式（见 [telegram-push/route.ts](../../../src/app/api/cron/telegram-push/route.ts)）。

**`vercel.json` 中的 `crons` 数组整块删除。**

#### 提前退出是必需，不是优化

`/api/cron/price-alerts` 必须先查是否存在未触发的提醒，**没有就立刻返回**。

理由：**Vercel Hobby 每月仅 4 CPU-小时**。每分钟一次即每月 43,200 次调用，即使每次只烧 200ms CPU 也要 2.4 小时——占掉六成预算。绝大多数分钟里没有任何活跃提醒，一次部分索引查询就该返回。

#### 幂等性

```sql
update price_alerts
   set triggered_at = now()
 where id = $1 and triggered_at is null
returning *
```

只对**真正返回行**的记录发送推送。这样即使 cron 重叠触发也不会重复打扰用户。

### 客户端：权限申请时机

> **绝不在首次访问就弹权限请求。** 浏览器权限被拒一次基本要不回来，而默认弹窗不解释任何理由。

上下文触发流程：

1. 用户**设置第一个价格提醒**
2. 先弹自绘的解释卡（"到价时通知你，即使 App 没开着"）
3. 用户点"开启" → 才调 `Notification.requestPermission()`
4. 用户点"以后再说" → 什么都不发生，提醒照常存下，下次再问

**iOS 多一道前置**：未安装到主屏时**不显示权限按钮**，改为显示"先添加到主屏幕"的引导。在 Safari 标签页里申请也不会成功，弹出来只会让人困惑。

订阅：`registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `POST /api/push/subscribe`。

### Service Worker 侧

**`push` 事件必须调 `showNotification()`。** 这是 `userVisibleOnly: true` 的契约——**收到推送却不显示，浏览器会直接撤销推送权限**。因此不做"页面开着就静默"的小聪明：照常显示系统通知，同时 `postMessage` 给已打开的页面更新铃铛角标。

**`notificationclick`**：先 `clients.matchAll()` 找已有窗口，有则 focus + 导航，无则 `openWindow`——否则每点一条通知开一个新窗口。深链带上下文，价格提醒直接跳 `/{locale}/trade?symbol=BTC-USDT`。

### 对现有代码的两处改动

**`PriceAlertWatcher` 的触发判定删除。** 现在它在页面内监听行情并判定触发。服务端接管后若两边都判，就有两套逻辑需要保持一致，迟早漂移。改为：**服务端是唯一权威**，页面只负责展示。

**存量本地提醒需迁移。** 已有用户在浏览器中存了提醒。首次登录时检测 `chart-ix-price-alerts` 这个 localStorage key，非空则推送到服务端后清空。**一次性、幂等、失败不阻塞登录。**

---

## L3 · 页面移动化

### 交易页：消除子导航

**问题**：底部有全局 tab bar，交易页顶部还有 图表/下单/订单簿 三个子 tab，在最需要垂直空间的页面上竖着堆两条导航。

**方案**：图表全屏 + 底部操作条 + 弹出式 sheet，**子 tab 完全消失**。

```
┌─────────────────┐
│ BTC-USDT  67,234│  ticker + 周期
│                 │
│     K 线图      │  占满剩余空间
│                 │
├─────────────────┤
│ 持仓 2  ⌃  盘口 │  操作条：上拉展开
├────────┬────────┤
│  买入  │  卖出  │  点击弹出下单 sheet
├─────────────────┤
│  底部 tab bar   │
└─────────────────┘
```

- 下单表单从底部滑出——[OrderForm](../../../src/components/trade/order-form/OrderForm.tsx) 本就是自包含组件，直接搬进 sheet
- 持仓 / 挂单从操作条上拉展开
- 订单簿做成图表上的可切换叠层
- **下单 sheet 打开时隐藏底部 tab bar**——用户此刻在专注做一件事，全局导航既没用又碍事

**理由**：这不是把双层导航压缩，而是**让子导航消失**——图表成为页面本身，其余都是从图表上唤起的临时表面。这也是币安 / OKX / Bybit 在手机上收敛到的形态。

同时**修掉该页的桌面/手机双挂载**（见「核心原则」）。

### 一次做完、全站受益的通用改造

- **[Modal.tsx](../../../src/components/ui/Modal.tsx) 增加 bottom sheet 形态** — 手机上从底部滑出，带拖拽把手与背景滚动锁定。全站弹窗都走这个组件，改一处全站变样。
- **表格 → 卡片列表** — `orders`、`screener`、`dashboard` 均为表格。统一模式：桌面渲染表格，手机每行渲染一张卡。**不做横向滚动条方案**，那在手机上是伪适配。
- **触摸目标下限** — iOS HIG 要求 44×44，Material 要求 48×48。现有时间周期按钮和 [LeverageField](../../../src/components/trade/order-form/fields/LeverageField.tsx) 中 `py-0.5` 的按钮远小于此。**实盘下单时点错杠杆是要赔钱的。**
- **底部留白契约** — 统一的 Tailwind 工具类，见 L1。

### iOS 键盘处理

输入框聚焦时 iOS 会整体上推页面，底部固定的 tab bar 和 sheet 会漂到键盘上方或错位。用 **`visualViewport` API** 监听尺寸变化并修正。这是 iOS 上最容易出丑的一处。

### 逐页工作量

| 路由 | 工作 | 量 |
|---|---|---|
| `/trade` | 上述重构 | 重 |
| `/settings` | **0 个响应式类**，全新做；API 密钥的长字符串在窄屏需特别处理 | 重 |
| `/orders` | **0 个响应式类**，表格转卡片 | 中 |
| `/screener` | 表格转卡片，筛选条件收进 sheet | 中 |
| `/dashboard` | 网格转单列，成绩表转卡片 | 中 |
| 首页 | 信任区左右分栏重排、行情条横向滚动。**必须保住 [DESIGN.md](../../../DESIGN.md) 的编辑式调性，不能简单堆成一列** | 中 |
| `/learn` | 改造成 hub | 中 |
| `/more` | 新页面 | 轻 |
| `/videos` `/articles` `/news` | 卡片尺寸 + 详情页阅读排版 | 轻 |
| `login` `register` `forgot-password` | 单列 + 键盘滚动 | 轻 |
| `/upgrade` | 定价卡横排转纵排 | 轻 |

---

## 错误处理与降级

| 失效 | 对策 |
|---|---|
| **SW 注册失败**（隐私模式 / 老浏览器 / 企业策略） | 应用照常运行，仅无离线与推送。`register()` 的 catch 只上报 Sentry，**绝不阻塞渲染**——PWA 是增强，不是前提 |
| **推送权限被拒** | 提醒照常保存；通知设置页显示"已被浏览器阻止"并给出各浏览器的恢复路径。**不反复骚扰申请** |
| **端点失效**（404 / 410） | 删除订阅行 |
| **发送失败**（5xx / 429） | `failed_count++`，累计 3 次删行（成功时重置），不重试当次 |
| **BingX 行情拿不到** | 跳过本轮巡检，**不标记触发、不发推送**。宁可晚一分钟，不可误判 |
| **iOS 清除存储** | 登录态与推送订阅一并丢失。重新登录时若 `getSubscription()` 为空但偏好为开启，**静默重新订阅** |
| **安装后切换语言** | `start_url` 锁定安装时的语言，冷启动仍进旧语言。启动时对比 cookie locale 做一次客户端跳转——**会有一帧闪烁**，属已知不完美 |

### 两条最危险的路径

**① 离线状态下的下单。** `/api/**` 不缓存，离线时请求会失败。但"失败"的表现形式很要命——转圈、静默无反应、或看不懂的报错，都可能让用户以为单已下出。

> **对策**：全局监听 `online` / `offline`，**离线时交易类按钮直接禁用并明示原因**。这是整份设计中最需要保证的一处，因为它的失败模式是用户赔钱。

**② cron 静默停摆。** Supabase Free 项目 **7 天无活动会暂停**（pg_cron 自身的活动是否计入"活跃"需实测，见「前置条件」）。一旦停止，价格提醒不会报错，只是**永远不触发**——用户以为提醒开着，实际早已失效。**静默失效比报错糟糕得多。**

> **对策**：`cron_heartbeats` 表记录每次巡检时间。后台显示状态，**同时在用户端 `/more/notifications` 显示"提醒服务：正常 / 异常"**——后台不做手机适配，而用户有权知道自己依赖的功能是否还活着。

---

## 测试策略

沿用项目现有的 vitest 层次（[vitest.config.ts](../../../vitest.config.ts) + 现有六个纯逻辑单测）。

**不引入 Playwright / e2e**：重依赖，且 PWA 真正的行为（安装、推送、存储驱逐）e2e 本就测不出来，装一套只会给人"测过了"的错觉。

### 可单测的（全部抽成纯函数）

| 目标 | 覆盖 |
|---|---|
| `lib/pwa/platform.ts` | 给定 UA / window 形状返回平台判断。覆盖 iOS Safari、iOS Chrome、Telegram 内置、微信、Android Chrome、standalone 六种 |
| `public/sw-strategy.js` | `shouldCache(url, mode) → strategy` 跑遍策略表。**`/api/**` 和 `?_rsc=` 必须返回 `never`**——硬规则需要测试锁住，不能靠 review 肉眼看 |
| `lib/push/evaluate.ts` | `evaluateAlerts(alerts, prices) → triggered[]`。边界：正好等于目标价、两个方向、已触发的不重复触发 |
| manifest 生成 | **三语 `id` 必须一致**（"三语是同一个 App"的保证）、`start_url` 正确 |

### 必须真机验证（写成验收清单）

沿用 [2026-07-29-acceptance-checklist.md](../plans/2026-07-29-acceptance-checklist.md) 的格式：

- [ ] iOS Safari 安装 → 主屏图标 → 冷启动无白闪 → 状态栏样式正确
- [ ] iOS 安装后申请推送权限 → 收到通知 → 点击深链跳转正确
- [ ] Android Chrome 触发 `beforeinstallprompt` → WebAPK 安装 → 图标裁切不缺角
- [ ] **双指缩放在 App 内被禁用，但 K 线图上仍可用**
- [ ] 断网后 App 能打开、访问过的文章可读、下单被正确拦截并提示
- [ ] Telegram 内置浏览器中显示"用 Safari 打开"而非安装卡
- [ ] 键盘弹出时 sheet 与 tab bar 不错位
- [ ] 三语下 tab 标签、通知文案、主屏应用名均正确

---

## 前置条件（实现开始前必须确认）

### 1. Vercel cron 的实际状态 ⚠️

[Vercel 文档](https://vercel.com/docs/cron-jobs/usage-and-pricing)明确：Hobby 计划 cron **最小间隔为每天一次**，且"Cron expressions that would run more frequently **will fail during deployment**"。

而 [vercel.json](../../../vercel.json) 中现有配置为 `"schedule": "0 */4 * * *"`（一天 6 次），正踩在该禁令上。以下三种情况必有其一：

1. 自 `751a7a4` 之后从未成功部署——**那三个 commit 的 Telegram 推送功能一直未上线**
2. 该项目实际在 Pro team 下
3. 手动在 Vercel 面板配置了 cron，绕过了 `vercel.json`

**需在 Vercel 面板确认**：Deployments 最近一次部署是否成功；Settings → Cron Jobs 是否注册、上次触发时间。若为情况 1，这比 PWA 更紧急。

### 2. Supabase Free 的 pg_cron 行为

需实测：Free 项目「7 天无活动自动暂停」的判定中，pg_cron 自身的定时执行是否计入"活跃"。若不计入，价格提醒会在项目暂停后静默失效，需另想办法（这也是 `cron_heartbeats` 存在的原因）。

### 3. 真机设备

**至少一台 iOS 16.4 以上的 iPhone**（Web Push 的版本下限）与一台 Android 设备。

> iOS 这半边**没有真机完全无法验证**——模拟器既不支持推送也不支持添加到主屏。若无设备，该部分只能标记为「未验证」交付。

### 4. VAPID 密钥对

生成一次并写入环境变量，**之后不可更换**。

---

## 待定的商业决策（不属于本设计的技术范围）

Vercel 的[合理使用条款](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)规定："the Hobby plan restricts users to **non-commercial, personal use only**"。

Chart-IX 有 `/upgrade` 页、Pro 订阅、定价后台，属商业项目。当前运行在禁止商业用途的免费计划上，平台有权暂停部署。

本设计通过决策 #9（Supabase Cron）**只解决了技术上的 cron 限制，未解决合规问题**。是否升级 Vercel Pro（$20/月）由用户决定。

---

## 已知限制（如实记录，不假装解决）

1. **禁用双指缩放在 iOS 浏览器标签页中不保证生效**，仅在安装后的 standalone 模式下可靠。
2. **离线首屏中文字体会闪。** Google CDN 的 Noto Sans SC 是上百个 woff2 分片按需加载，只能缓存用户实际触发过的分片。未命中的分片离线时回落系统字体。
3. **离线只能查看已访问过的内容。** 未打开过的文章离线打不开——这是 network-first 的固有性质，非缺陷。
4. **视频不缓存。** Supabase Storage 上的视频动辄上百 MB，iOS 配额撑不住。
5. **iOS 启动图仅覆盖主流 iPhone 尺寸**，老机型与 iPad 冷启动仍会白闪一下。
6. **安装后切换语言，冷启动会有一帧跳转闪烁。**
7. **不支持实盘成交 / 爆仓推送**（见「非目标」）。
8. **Telegram / 微信等内置浏览器中无法安装 PWA**，只能引导用户切换到系统浏览器。这是 iOS 系统限制。
