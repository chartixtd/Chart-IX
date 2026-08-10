# 手机导航整理设计文档

日期：2026-08-10
状态：已获用户批准

## 背景与问题

用户提出三件事，都属于「手机上的信息架构没理顺」：

1. **学习路径是个空壳。** `/learn` 页面上有「学习路径」分区，但数据库里一条
   都没有，页面渲染的是「学习路径即将上线，敬请期待。」——占着首屏位置却什么
   都给不了。
2. **行业资讯藏在「更多」里。** 它是学习性质的内容，却和订单、设置、升级并列
   在「更多」这个杂物抽屉里，学习 tab 反而找不到它。
3. **价格提醒和通知设置暂时不想露出。**

用户逐项确认的处置：

- 学习路径：**连后台一起删干净**（不是隐藏）。用户明确选择了不可逆的这一项。
- 行业资讯：移进「学习」。
- 价格提醒 + 通知设置：隐藏，代码保留（「暂时」意味着可逆）。手机顶部栏与
  桌面 Navbar 的**铃铛一并移除**（用户确认，避免入口一半在一半不在）。

## 已确认的现状事实（2026-08-10 核实）

**数据库**（通过 Supabase 直接查询）：

- `learning_paths` **0 行**，`learning_path_steps` **0 行**。删表不会毁掉任何
  已录入的数据——这是「删干净」这个选择可以放心执行的前提。
- 外键依赖只有 `learning_path_steps.path_id → learning_paths` 与
  `learning_path_steps.video_id → videos`。**没有任何第三方表引用这两张表**，
  quizzes 与它们完全无关。删除顺序：先 `learning_path_steps`，再 `learning_paths`。
- 建表迁移在 `supabase/migrations/011_learning_paths.sql`，另有
  `040_security_and_performance_hardening.sql` 触及它们（RLS/索引）。

**代码**：

- 学习页的三个入口在 `src/app/[locale]/(static)/learn/LearnHub.tsx` 的
  `sections` 数组：`videos` / `articles` / `paths`。
- `learn/page.tsx` 目前为了渲染路径列表要查两次库
  （`learning_paths` + `learning_path_steps`）。删掉列表后**这个页面不再需要
  任何数据库查询**，可以退化成纯静态渲染——顺带的性能收益。
- `tabs.ts` 的 `TAB_SEGMENTS` 里 `news` 归属 `more`；`buildMoreEntries` 的顺序是
  news / orders / alerts / settings / notifications / upgrade / admin。
- `resolveBackTarget` 里 `news` 落在 `case "news"` 一组，返回 `/more`。
- `PriceAlertBell` 只在两处渲染：`MobileHeader.tsx:83` 与 `Navbar.tsx:104`。
- 学习路径在代码里的牵连点（全部要处理）：`learn/page.tsx`、`LearnHub.tsx`、
  `learn/[slug]/page.tsx`、`admin/learning-paths/`（page + Manager，共 416 行）、
  `api/admin/learning-paths/route.ts`、`AdminSidebar.tsx` 导航项、
  `admin/page.tsx` 的统计查询、`AdminDashboardClient.tsx` 的统计卡、
  `sitemap.ts` 的查询、`types/index.ts` 的 `LearningPath`/`LearningPathStep`。
- **`learn.hub_subtitle` 三语都在宣传学习路径**（zh「课程、文章与学习路径…」/
  en「Courses, articles and structured paths…」/ ms「…laluan berstruktur…」），
  删掉分区后这句文案会说谎，必须一并改写。这是最容易漏的一处。

**测试**：`src/lib/nav/tabs.test.ts` 有**三条**断言会被本次改动打破：

1. 「更多 tab 收编资讯、订单、设置、升级」——`/news` 将改归 learn
2. 「常规入口按既定顺序排列并带语言前缀」——more 列表将只剩 orders/settings
3. 「未登录（或 auth 未加载完）时不显示 alerts/notifications 入口」——该测试
   断言登录后**应当**出现 alerts/notifications，而本次改动让它们永远不出现，
   测试的前提整个消失，应当删除而不是改断言（它保护的那条规则不复存在）

## 设计

### ① 学习路径全栈删除

**数据库**：新增迁移，按依赖顺序 `drop table if exists learning_path_steps;`
然后 `drop table if exists learning_paths;`。两表皆空，无第三方引用。

**整目录/整文件删除**：

- `src/app/[locale]/(static)/learn/[slug]/`
- `src/app/admin/learning-paths/`
- `src/app/api/admin/learning-paths/route.ts`

**修改**：

- `LearnHub.tsx`：`sections` 去掉 `paths`
- `learn/page.tsx`：删掉两次查询、`stepCounts`、整个 `<h2 id="paths">` 区块及其
  列表；随之删掉不再使用的 import（`createServiceRoleClient`、`Card`、`Badge`、
  `LearningPath`、`LEVEL_VARIANT`）。页面变成不查库的纯静态渲染。
- `AdminSidebar.tsx`：`ADMIN_NAV` 去掉学习路径项
- `admin/page.tsx`：去掉 `count("learning_paths")` 与 `learningPaths` 字段
- `AdminDashboardClient.tsx`：去掉 `learningPaths` 类型字段与那张 `<Stat>` 卡
- `sitemap.ts`：去掉 `learning_paths` 查询与对应 URL 生成
- `types/index.ts`：删 `LearningPath`、`LearningPathStep`
- i18n ×3：删 `learn.hub_paths`、`learn.hub_paths_desc`、`admin.learning_paths`

### ② 行业资讯移入学习

- `LearnHub.tsx`：`sections` 变成 `videos` / `articles` / `news`，
  `news` 指向 `/${locale}/news`
- `tabs.ts` `TAB_SEGMENTS`：`news` 从 `more` 挪到 `learn`
- `tabs.ts` `buildMoreEntries`：去掉 news 条目
- `tabs.ts` `resolveBackTarget`：`news` 从「归 `/more`」改为「归 `/learn`」
- i18n ×3 新增 `learn.hub_news` / `learn.hub_news_desc`，并**改写
  `learn.hub_subtitle`**，把「学习路径」换成「行业资讯」：
  - zh-CN：`hub_subtitle` →「课程、文章与行业资讯，循序渐进地建立交易认知」；
    `hub_news` →「行业资讯」；`hub_news_desc` →「每日市场动态与要闻速览」
  - en-US：`hub_subtitle` →「Courses, articles and industry news that build
    trading judgement step by step」；`hub_news` →「Industry news」；
    `hub_news_desc` →「Daily market moves and headlines at a glance」
  - ms-MY：`hub_subtitle` →「Kursus, artikel dan berita industri untuk membina
    pertimbangan dagangan langkah demi langkah」；`hub_news` →「Berita
    industri」；`hub_news_desc` →「Pergerakan pasaran harian dan berita utama
    sepintas lalu」

移到 learn 之后的连带效果（都是想要的）：进 `/news` 时底部高亮学习 tab；
在 `/news` 按返回退到 `/learn` 而不是 `/more`。

### ③ 隐藏价格提醒与通知设置

- `tabs.ts` `buildMoreEntries`：去掉 `alerts` 与 `notifications` 两个条目。
  已核实 `userId` 参数在该函数里**只**服务于这两个条目（`if (userId)` 两处），
  删掉后它就是死参数，因此连同参数、其 JSDoc 说明、以及 `more/page.tsx` 传参
  处一并移除。**不要**顺手改动 `upgrade`（依赖 `tier`）与 `admin`（依赖 `role`）
  的既有判断。
- `MobileHeader.tsx` 与 `Navbar.tsx`：移除 `<PriceAlertBell />` 及其 import。
- **保留**：`/more/alerts`、`/more/notifications` 两个路由与页面、
  `PriceAlertBell` 组件本身、`PriceAlertWatcher`、相关 API 与数据库。
  这是「暂时隐藏」，不是删除。

**两项已向用户明示并获认可的后果：**

1. 移除铃铛后，登录用户的手机顶部栏右侧会**变空**（只剩左侧 logo 或返回按钮）。
   这是预期结果，不是缺陷。
2. `PriceAlertWatcher` **仍在运行**：用户此前设置的提醒会继续推送通知，但已经
   没有界面可以管理它们。保留监控是刻意的——「暂时隐藏」应当可逆，停掉监控会
   让恢复时的行为更难预期。

## 测试与验收

单元测试（`src/lib/nav/tabs.test.ts` 修改既有 + 新增）：

- `resolveActiveTab("/zh-CN/news", "zh-CN")` 现在应为 `"learn"`（改既有断言）
- `buildMoreEntries` 的常规入口顺序断言改为 `["orders", "settings"]`；
  另加一条断言 alerts/notifications/news 三个 key 在任何输入下都不出现
- `resolveBackTarget("/zh-CN/news", "zh-CN")` 应为 `/zh-CN/learn`（新增）
- `shouldShowBackButton` 对 `/zh-CN/news` 仍为 `true`（回归，行为不变）

无法单测的验收步骤：

1. 手机视口打开 `/zh-CN/learn`：三个入口为「视频课程 / 文章 / 行业资讯」，
   页面上再无学习路径分区，副标题不再提学习路径
2. 点进「行业资讯」：底部高亮的是**学习** tab；点顶部返回退到 `/zh-CN/learn`
3. `/zh-CN/more`：只剩「交易历史」「设置」（未登录时还有升级、管理员另有后台）
4. 登录状态下手机顶部栏与桌面 Navbar 均无铃铛
5. 后台侧边栏无「学习路径」，后台首页无该统计卡
6. 直接访问 `/zh-CN/learn/anything` 应为 404（路由已删）
7. 三语各抽查一次学习页，确认无缺失文案键报错

## 明确不做（YAGNI）

- 不删除 `/more/alerts`、`/more/notifications` 的路由与页面（要可逆）
- 不停用 `PriceAlertWatcher`
- 不动订单、设置、升级、后台入口的既有逻辑
- 不重排「更多」页的其余结构（语言切换、登出按钮保持原样）
- 不给行业资讯做新的列表样式（复用现有 `/news` 页面）
- 不动桌面 `Navbar` 的其余导航项
