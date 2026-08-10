# 手机版全局返回按钮与触摸目标设计文档

日期：2026-08-10
状态：已获用户批准

## 背景与问题

站点的移动端外壳是 `AppChrome` → `MobileShell`（`MobileHeader` + `MobileTabBar`），
所有页面共用。底部 5 个 tab 是 `dashboard` / `learn` / `trade` / `screener` / `more`。

两个问题：

1. **深层页面没有返回入口。** 全站只有三个页面自带页内返回链接
   （`articles/[slug]`、`videos/[id]`、`community/[id]`）。`/news`、`/orders`、
   `/settings`、`/settings/api-keys`、`/upgrade`、`/more/alerts`、
   `/more/notifications`、`/learn/[slug]` 全都没有——手机上进去之后只能靠
   系统手势或点底部 tab 跳走，而点 tab 是"跳到别处"，不是"退回来"。
2. **触摸目标不达标。** `Button` 的尺寸算下来是 `sm` ≈ 28px、`md` ≈ 40px、
   `lg` ≈ 52px（`text-xs`/16px 行高 + `py-1.5`/12px = 28；`text-sm`/20px +
   `py-2.5`/20px = 40；`text-base`/24px + `py-3.5`/28px = 52）。iOS 人机指南的
   下限是 44px，`sm` 和 `md` 都不达标。项目里 `MobileTabBar` 已经专门写了
   `min-h-[44px]` 并注释说明遵循这条规范，但 `Button` 组件本身没有。

## 已确认的现状事实（2026-08-10 读码核实）

- `MobileHeader` 目前是：左侧 logo（链接到 dashboard 或首页），右侧未登录时
  显示登录/注册两个 `size="sm"` 按钮、已登录时显示 `PriceAlertBell`。
  高度 `h-12`，`sticky top-0`，吃 `pt-safe-t`。
- `MobileTabBar` 在**未登录时整个不渲染**（`!auth.loading && !auth.userId`
  时 return null）。这意味着未登录用户在公开页面（文章/视频/学习）上没有
  底部导航——返回按钮对这部分用户的价值更高。
- tab 归属关系已经集中在 `src/lib/nav/tabs.ts` 的 `TAB_SEGMENTS` 里：
  `learn` 收编 `learn`/`videos`/`articles`，`more` 收编
  `more`/`news`/`orders`/`settings`/`upgrade`。返回的"上级"映射应该复用
  这个已有的归属关系，而不是另起一套。
- `size="sm"` 全站 **100 处**使用，横跨 `src/app/admin/*`（后台，
  `tabs.ts` 注释明确写了"后台不做移动适配"）与 `trade`/`screener` 等密集
  工具页。给它加 `min-h` 会撑高全部 100 处，回归风险大。
- 自定义 spacing 工具类（`safe-t`/`safe-b`/`tabbar`）定义在
  `tailwind.config.ts` 的 `theme.extend.spacing`，新增工具类沿用此处。
- `globals.css` 目前没有 `pointer: coarse` / `hover: none` 一类的触摸设备
  媒体查询，需要新增。

## 设计

### ① 全局返回按钮

**位置**：`MobileHeader` 左侧。在非主 tab 页面上，logo 位置替换为返回按钮
（左箭头图标 + 「返回」文字），触摸区 44px。只改 `MobileHeader` 一个组件，
十几个页面自动生效。

**不显示返回的页面**（导航终点，不是"进去的"页面）：

- 首页 `/{locale}`
- 5 个 tab 根页：`/{locale}/dashboard`、`/learn`、`/trade`、`/screener`、`/more`

其余页面一律显示。判定逻辑放进 `src/lib/nav/tabs.ts`（与 `resolveActiveTab`
为邻，共用同一套路径解析），不散落在组件里。

**点击行为**：优先回真实的上一页，没有站内历史时回上级页面。

判断"有没有站内历史"**不能用 `window.history.length > 1`**——用户从搜索结果
或微信点进来时它同样 ≥ 2，一按就被踢出站点。改用**站内导航计数器**：
在 `MobileShell` 里监听 `pathname` 变化，跳过首次挂载，真正发生过站内跳转
才计数。

- 计数器 > 0 → `router.back()`
- 计数器 = 0（外部链接直入 / PWA 冷启动）→ 按下表 `router.push()` 跳上级

| 当前页 | 上级 |
|---|---|
| `/articles/[slug]` | `/articles` |
| `/videos/[id]` | `/videos` |
| `/learn/[slug]` | `/learn` |
| `/articles`、`/videos` | `/learn` |
| `/community/[id]` | `/articles?tab=community` |
| `/settings/api-keys` | `/settings` |
| `/more/alerts`、`/more/notifications` | `/more` |
| `/news`、`/orders`、`/settings`、`/upgrade` | `/more` |
| 其余（含 `/login`、`/register`、`/forgot-password`、`/offline`） | 首页 `/{locale}` |

映射表放在 `tabs.ts`，导出一个 `resolveBackTarget(pathname, locale): string`。
兜底到首页而不是 dashboard——未登录用户占公开页面流量的大头，dashboard 对
他们是登录墙。

**文案用通用的「返回」**，不写「返回文章列表」：走 `router.back()` 时用户
可能从任何地方来，写死上级名称会说谎。

**页内返回链接的处理**：`articles/[slug]`、`videos/[id]`、`community/[id]`
三处已有的页内返回链接加 `hidden lg:flex`（或 `lg:inline-flex`，按各自
原有 display 值），手机上隐藏、桌面保留——桌面没有 `MobileHeader`，那三个
链接仍是桌面端唯一的返回入口，不能删。

### ② 触摸目标

**不改任何按钮的视觉尺寸**，只在垂直方向扩大可点区域：给 `Button` 加一个
伪元素，把命中区撑到 44px，画出来的按钮一模一样。

```css
/* 仅触摸设备生效 */
@media (pointer: coarse) {
  .tap-44::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    min-height: 44px;
  }
}
```

配套：`Button` 根元素加 `relative`（伪元素定位基准）与 `tap-44`。

为什么这样而不是直接 `min-h-[44px]`：

- **横向不扩**（`left:0; right:0` 锁死在按钮自身宽度内），并排按钮的命中区
  不会互相重叠、不会误触。
- **纵向各溢出 8px**（28px → 44px），而项目里堆叠按钮的间距普遍 ≥ 12px，
  同样不重叠。
- **视觉零变化** → 后台管理与交易终端的密集布局完全不受影响，避开了那
  100 处 `size="sm"` 的回归风险。
- `@media (pointer: coarse)` 限定只在触摸设备生效，鼠标端不变。

`lg` 尺寸（52px）本就达标，伪元素的 `min-height: 44px` 小于它，不产生影响。

代价（已向用户明示）：这是"隐形"的改善，肉眼看不出区别，只有手指点的时候
更容易命中。用户已确认接受这个取舍，放弃"看得见的变大"方案（后者需要把
范围缩到面向用户的移动页面并逐一排除后台与交易终端，工作量与回归风险都
高一截）。

### ③ 测试与验收

单元测试（`src/lib/nav/tabs.test.ts`，新建或扩展）：

- `shouldShowBackButton`：首页与 5 个 tab 根页返回 `false`；
  `/articles/x`、`/settings`、`/more/alerts` 等返回 `true`；
  语言前缀不匹配当前 locale 时的行为与 `resolveActiveTab` 保持一致
- `resolveBackTarget`：上表每一行各一条断言；未列出的路径兜底到 `/{locale}`；
  `community/[id]` 带 query 的目标串完整匹配

无法单测的部分（`MobileHeader` 依赖 `usePathname`/`useRouter`，命中区依赖
真实触摸）的验收步骤：

1. 手机尺寸下打开 `/{locale}/dashboard`，顶部左侧显示 logo、**不显示**返回
2. 进入 `/{locale}/settings`，顶部左侧变为「← 返回」；点击回到上一页
3. 新标签页直接打开 `/{locale}/settings/api-keys`（模拟外部链接直入），
   点返回应到 `/{locale}/settings` 而不是离开站点
4. 文章详情页在手机上只有顶部一个返回，桌面上只有页内一个返回，都不重复
5. 未登录状态下打开文章详情（此时没有底部 tab bar），返回按钮可用

## 明确不做（YAGNI）

- 不给返回按钮加页面标题（需要每个页面声明标题，耦合过重）
- 不改底部 `MobileTabBar` 的结构与图标
- 不动桌面版 `Navbar`
- 不做手势返回（系统已提供，重复造轮子）
- 不改那 100 处 `size="sm"` 的视觉尺寸
- 不给后台 `/admin` 做移动适配（既有决定，本设计不推翻）
