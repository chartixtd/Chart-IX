# 后台管理手机可用设计文档

日期：2026-08-10
状态：已获用户批准

## 背景与问题

后台在手机上是**真的不能用**，不是「不好看」：

- `AdminSidebar` 是 `fixed left-0 top-14 w-56`（224px），没有任何断点处理，
  在任何视口下都占满左侧
- `admin/layout.tsx` 的主内容区写死 `ml-56`，同样没有断点

在 375px 宽的手机上，224px 被侧边栏吃掉，主内容区只剩 **151px** 可用宽度——
表格、表单、按钮全部挤成一条。

项目此前有过「后台不做移动适配」的决定（记录在 `src/lib/nav/tabs.ts` 里
`buildMoreEntries` 的注释）。本设计推翻该决定的**执行部分**，但把范围限制在
「手机上能用」——用户明确选择了这一档，而不是「桌面版也重排」。

## 已确认的现状事实（2026-08-10 读码核实）

- `admin/layout.tsx` 是 **server component**，直接组合
  `<AdminHeader />` + `<AdminSidebar />` + `<main className="ml-56 flex-1 p-6">`。
- `AdminHeader` 与 `AdminSidebar` 都已经是 `"use client"`，但彼此之间没有任何
  共享状态——抽屉的开关状态需要一个共同的持有者。
- `AdminHeader` 是 `sticky top-0 z-40 h-14`，左侧是 logo + Admin 徽章，右侧是
  「返回网站」链接、用户邮箱、登出按钮。手机上右侧这三样会与 logo 挤在一起。
- `AdminSidebar` 底部还有一个「返回网站」链接，与 header 里那个重复。
- **六个后台表格已经全部包了 `overflow-x-auto`**
  （articles / learning-paths / logs / quizzes / users / videos 的 Manager 与
  Table 组件）。所以表格本身不需要改动——真正坏掉的只有外层布局。这把本设计的
  改动面缩小了一大截。
- 后台不在 i18n 路由内（`/admin` 不带语言前缀），但用 `AdminLocaleProvider`
  提供翻译上下文。

## 设计

**总原则：桌面端一像素不变。** 所有改动都以「手机上从不可用变为可用」为界，
不做视觉重构。

### ① 抽屉状态的持有者：`AdminShell`

`admin/layout.tsx` 是 server component，无法持有 `useState`。新增
`src/components/layout/AdminShell.tsx`（`"use client"`），由它持有
`sidebarOpen` 状态并组合三者：

```
AdminShell (client, 持有 open 状态)
├── AdminHeader   ← 新增 onMenuClick prop，手机上渲染汉堡按钮
├── AdminSidebar  ← 新增 open / onClose props
└── <main>        ← ml-0 lg:ml-56
```

`admin/layout.tsx` 退化成只负责 `AdminLocaleProvider` + `ToastProvider` +
`<AdminShell>{children}</AdminShell>`。

选 `AdminShell` 而不是 zustand store：抽屉开关是纯局部 UI 状态，只有这三个
组件关心，没有跨路由持久化需求。项目虽然有 zustand，但为一个布尔量新建全局
store 是过度设计。

### ② 三个组件的改动

**`admin/layout.tsx`**：主内容区 `ml-56` → `ml-0 lg:ml-56`，`p-6` → `p-4 lg:p-6`
（手机上 24px 内边距太奢侈）。

**`AdminSidebar`**：

- 桌面（`lg:`）：完全保持现状——`fixed`、`w-56`、常驻可见
- 手机：默认移出视野（`-translate-x-full`），`open` 为真时滑入
  （`translate-x-0`），加 `transition-transform`
- 手机上 `open` 时在侧边栏下方铺一层半透明遮罩（`lg:hidden`），点击关闭
- 点任意导航项后自动关闭（手机上）
- 层级：侧边栏 `z-50`、遮罩 `z-40`。header 是 `sticky z-40`，与遮罩同级——
  因此 **`AdminShell` 里遮罩与侧边栏必须渲染在 `AdminHeader` 之后**，靠 DOM
  顺序在同层级下胜出，遮罩才能盖住 header。侧边栏 `z-50` 高于两者，无歧义。
  这条顺序依赖要写进 `AdminShell` 的注释，否则将来有人重排 JSX 会静默破坏它。

**`AdminHeader`**：

- 左侧 logo 之前插入汉堡按钮，`lg:hidden`，触摸目标 44px
- 手机上隐藏「返回网站」链接与用户邮箱（`hidden lg:flex` / `hidden lg:inline`）——
  侧边栏底部已有「返回网站」，邮箱在手机上是纯噪声。登出按钮保留。

### ③ 无障碍与键盘

- 汉堡按钮带 `aria-label`（复用既有 `admin` 命名空间的文案，若无合适键则新增
  `admin.open_menu`，三语）
- 汉堡按钮标 `aria-expanded={open}`
- 抽屉打开时按 `Esc` 关闭
- 遮罩用 `<div>` 承担点击关闭，不放可聚焦内容

不做焦点陷阱（focus trap）：这是单人使用的内部后台，引入焦点管理库或手写陷阱
的复杂度超过收益。Esc + 点遮罩 + 点导航项三条关闭路径已经够用。

## 测试与验收

本设计几乎全是布局与交互，项目的 vitest 是 node 环境且 `include` 只覆盖
`src/lib/**` 与 `src/stores/**`，渲染不了组件——**不新增单元测试**，与
`MobileHeader` 的既有处理保持一致。

验收步骤（手机视口 375×812，除非另行说明）：

1. `/admin` 打开：内容区占满屏宽，无横向溢出；侧边栏不可见
2. 点汉堡：抽屉从左滑入并盖住 header；点遮罩关闭；再开一次，按 Esc 关闭
3. 抽屉里点任一导航项：跳转且抽屉自动关闭
4. `/admin/users` 与 `/admin/logs`：表格可横向滚动，**页面本身不横向滚动**
5. 桌面视口 1280×900 逐页比对：侧边栏常驻、`ml-56` 生效、汉堡按钮不出现、
   「返回网站」与邮箱正常显示——与改动前应当无任何可见差异
6. 后台各页控制台无报错

## 明确不做（YAGNI）

- 不重排任何后台页面的内部布局、间距、表格密度、表单结构
- 不动六个表格（它们已有 `overflow-x-auto`）
- 不做焦点陷阱
- 不为抽屉引入动画库或 UI 组件库
- 不把后台纳入 i18n 路由
- 不改 `AdminLocaleProvider`、`ToastProvider` 的既有行为
