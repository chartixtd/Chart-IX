# 手机导航整理 + 后台手机可用 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把学习路径这个空壳功能连根删掉、把行业资讯搬进「学习」、隐藏价格提醒与通知设置，并让后台在手机上从「不可用」变成「可用」。

**Architecture:** 两个子项目合成一份计划，因为它们都要改 `AdminSidebar.tsx`——分成两份计划会在同一文件上制造无谓的合并摩擦。顺序是先 A 后 B：A 把学习路径从侧边栏导航数组里删掉，B 再把整个侧边栏改成响应式抽屉。导航的数据决策集中在 `src/lib/nav/tabs.ts` 的纯函数里（已有测试覆盖），组件只消费不判断；后台抽屉的开关状态由一个新的客户端组件 `AdminShell` 持有，因为 `admin/layout.tsx` 是 server component 拿不了 `useState`。

**Tech Stack:** Next.js 15 App Router、next-intl（三语 zh-CN / en-US / ms-MY）、Tailwind 3.4、Supabase（迁移文件）、vitest。

**设计文档：**
- A：`docs/superpowers/specs/2026-08-10-mobile-nav-cleanup-design.md`
- B：`docs/superpowers/specs/2026-08-10-admin-mobile-layout-design.md`

## Global Constraints

- **学习路径是不可逆删除，包括数据库表。** 已核实 `learning_paths` 与 `learning_path_steps` 均为 **0 行**、无第三方外键引用（只有 `learning_path_steps` 自己指向 `learning_paths` 和 `videos`），quizzes 与它们无关。删表不丢数据。
- **价格提醒与通知设置是「暂时隐藏」，不是删除。** 必须保留：`/more/alerts` 与 `/more/notifications` 两个路由与页面、`PriceAlertBell` 组件本身、`PriceAlertWatcher`、相关 API 与数据库表。只移除进入它们的入口。
- **`PriceAlertWatcher` 保持运行**（刻意为之，见设计文档）。不要顺手停用它。
- **后台改动的边界是「手机上能用」。桌面端必须一像素不变。** 不重排任何后台页面的内部布局、间距、表格密度、表单结构。
- **六个后台表格已经全部带 `overflow-x-auto`**，不要动它们。
- 三个语言文件 `zh-CN` / `en-US` / `ms-MY` 必须同步改动，缺一个都会在该语言下抛缺失键错误。
- 不新增组件测试。项目 vitest 是 node 环境、`include` 只有 `src/lib/**` 与 `src/stores/**`，渲染不了组件；不要为此引入 jsdom 或 React Testing Library。
- 每个任务结束前跑 `npx tsc --noEmit`；涉及 `src/lib/nav/` 的任务跑 `npx vitest run src/lib/nav/tabs.test.ts`；最后一个任务跑全量。
- 提交信息用中文，沿用仓库前缀风格（`feat(...)` / `fix(...)` / `refactor(...)` / `chore(...)`）。

---

## File Structure

| 文件 | 责任 | 处置 |
|---|---|---|
| `src/lib/nav/tabs.ts` | 移动端导航的全部路径与菜单决策 | 修改（Task 1） |
| `src/lib/nav/tabs.test.ts` | 上述纯函数的测试 | 修改（Task 1） |
| `src/app/[locale]/(app)/more/page.tsx` | 「更多」页 | 修改（Task 1，跟随 `buildMoreEntries` 签名变化） |
| `src/app/[locale]/(static)/learn/LearnHub.tsx` | 学习页的分区入口 | 修改（Task 2） |
| `src/app/[locale]/(static)/learn/page.tsx` | 学习页 | 修改（Task 2，删列表后不再查库） |
| `src/app/[locale]/(static)/learn/[slug]/` | 学习路径详情路由 | **整目录删除**（Task 2） |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | 三语文案 | 修改（Task 2 改 learn.*，Task 3 删 admin.learning_paths） |
| `src/app/admin/learning-paths/` | 后台学习路径管理 | **整目录删除**（Task 3，416 行） |
| `src/app/api/admin/learning-paths/route.ts` | 对应 API | **删除**（Task 3） |
| `src/components/layout/AdminSidebar.tsx` | 后台侧边栏 | 修改（Task 3 去导航项；Task 6 改抽屉） |
| `src/app/admin/page.tsx` | 后台首页数据 | 修改（Task 3 去统计查询） |
| `src/components/admin/AdminDashboardClient.tsx` | 后台首页渲染 | 修改（Task 3 去统计卡） |
| `src/app/sitemap.ts` | 站点地图 | 修改（Task 3 去 learning_paths 查询） |
| `src/types/index.ts` | 类型定义 | 修改（Task 3 删两个接口） |
| `supabase/migrations/042_drop_learning_paths.sql` | 删表迁移 | **新建**（Task 4） |
| `src/components/layout/MobileHeader.tsx` | 手机顶部栏 | 修改（Task 5 去铃铛） |
| `src/components/layout/Navbar.tsx` | 桌面顶部栏 | 修改（Task 5 去铃铛） |
| `src/components/layout/AdminShell.tsx` | **新建**，持有后台抽屉开关状态并组合三件套 | 创建（Task 6） |
| `src/app/admin/layout.tsx` | 后台布局 | 修改（Task 6） |
| `src/components/layout/AdminHeader.tsx` | 后台顶部栏 | 修改（Task 6 加汉堡） |

---

### Task 1: 导航数据变更（`tabs.ts`）

**Files:**
- Modify: `src/lib/nav/tabs.ts`
- Modify: `src/lib/nav/tabs.test.ts`
- Modify: `src/app/[locale]/(app)/more/page.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `buildMoreEntries` 的入参去掉 `userId`，新签名为
  `buildMoreEntries(input: { locale: string; tier: string | null; role: string | null }): MoreEntry[]`。
  Task 5 之后没有别的任务消费它。
- 保持不变：`MOBILE_TABS`、`resolveActiveTab`、`shouldShowBackButton`、`MoreEntry` 接口。

**背景：**
三处数据要改：`TAB_SEGMENTS`（`news` 从 more 挪到 learn）、`buildMoreEntries`（去掉 news / alerts / notifications 三个条目，并因此去掉变成死参数的 `userId`）、`resolveBackTarget`（`news` 从退到 `/more` 改成退到 `/learn`）。

`userId` 在 `buildMoreEntries` 里**只**服务于 alerts 与 notifications 两个 `if (userId)` 分支，删掉条目后它没有任何使用者，因此连同参数、它的 JSDoc 说明、以及 `more/page.tsx` 的传参一并移除。**不要**动 `upgrade`（依赖 `tier`）与 `admin`（依赖 `role`）的判断。

- [ ] **Step 1: 改测试（先让它红）**

在 `src/lib/nav/tabs.test.ts` 中做三处修改与一处新增。

**(a)** 把这条既有用例

```ts
  it("更多 tab 收编资讯、订单、设置、升级", () => {
    expect(resolveActiveTab("/zh-CN/news", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/orders", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/settings", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/upgrade", "zh-CN")).toBe("more");
  });
```

改为

```ts
  it("更多 tab 收编订单、设置、升级——资讯已改归学习", () => {
    expect(resolveActiveTab("/zh-CN/orders", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/settings", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/upgrade", "zh-CN")).toBe("more");
  });
```

**(b)** 把这条既有用例

```ts
  it("学习 tab 收编视频与文章", () => {
    expect(resolveActiveTab("/zh-CN/videos", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/videos/abc-123", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/articles/hello", "zh-CN")).toBe("learn");
  });
```

改为

```ts
  it("学习 tab 收编视频、文章与行业资讯", () => {
    expect(resolveActiveTab("/zh-CN/videos", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/videos/abc-123", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/articles/hello", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/news", "zh-CN")).toBe("learn");
  });
```

**(c)** 把 `describe("buildMoreEntries")` 里的 `base` 常量与受影响的用例改掉。`base` 从

```ts
  const base = { locale: "zh-CN", tier: "free", role: "user", userId: "u1" };
```

改为

```ts
  const base = { locale: "zh-CN", tier: "free", role: "user" };
```

**删除**这条用例（它保护的规则已不复存在——alerts/notifications 现在对任何人都不出现，原用例断言登录后应当出现，前提整个消失）：

```ts
  it("未登录（或 auth 未加载完）时不显示 alerts/notifications 入口，避免访问后拿到 401 出现假的服务异常提示", () => { ... });
```

把顺序断言那条

```ts
  it("常规入口按既定顺序排列并带语言前缀", () => {
    const entries = buildMoreEntries({ locale: "ms-MY", tier: "pro", role: "user", userId: "u1" });
    expect(entries.map((e) => e.key)).toEqual([
      "news",
      "orders",
      "alerts",
      "settings",
      "notifications",
    ]);
    expect(entries[0].href).toBe("/ms-MY/news");
  });
```

改为

```ts
  it("常规入口按既定顺序排列并带语言前缀", () => {
    const entries = buildMoreEntries({ locale: "ms-MY", tier: "pro", role: "user" });
    expect(entries.map((e) => e.key)).toEqual(["orders", "settings"]);
    expect(entries[0].href).toBe("/ms-MY/orders");
  });
```

**(d)** 新增两条用例（放在 `describe("buildMoreEntries")` 内部末尾）：

```ts
  it("资讯、价格提醒、通知设置都不再出现在更多里", () => {
    for (const input of [
      base,
      { ...base, tier: "pro" },
      { ...base, role: "admin" },
      { ...base, tier: null },
    ]) {
      const keys = buildMoreEntries(input).map((e) => e.key);
      expect(keys).not.toContain("news");
      expect(keys).not.toContain("alerts");
      expect(keys).not.toContain("notifications");
    }
  });
```

以及在 `describe("resolveBackTarget")` 内部末尾新增：

```ts
  it("行业资讯退回学习中心——它已从「更多」改归「学习」", () => {
    expect(resolveBackTarget("/zh-CN/news", "zh-CN")).toBe("/zh-CN/learn");
  });
```

同时把 `describe("resolveBackTarget")` 里这条既有用例

```ts
  it("更多 tab 收编的页面都退回更多", () => {
    expect(resolveBackTarget("/zh-CN/more/alerts", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/more/notifications", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/news", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/orders", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/upgrade", "zh-CN")).toBe("/zh-CN/more");
  });
```

改为（去掉 news 那一行，其余不动）

```ts
  it("更多 tab 收编的页面都退回更多", () => {
    expect(resolveBackTarget("/zh-CN/more/alerts", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/more/notifications", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/orders", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/upgrade", "zh-CN")).toBe("/zh-CN/more");
  });
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/nav/tabs.test.ts
```

预期：FAIL。`/zh-CN/news` 仍被判为 `more`；`buildMoreEntries` 仍返回 5 个条目；TypeScript 会抱怨 `base` 少了 `userId`。

- [ ] **Step 3: 改 `tabs.ts` 的 `TAB_SEGMENTS`**

把

```ts
const TAB_SEGMENTS: Record<TabKey, string[]> = {
  dashboard: ["dashboard"],
  learn: ["learn", "videos", "articles"],
  trade: ["trade"],
  screener: ["screener"],
  more: ["more", "news", "orders", "settings", "upgrade"],
};
```

改为

```ts
const TAB_SEGMENTS: Record<TabKey, string[]> = {
  dashboard: ["dashboard"],
  // 行业资讯是学习性质的内容，归学习 hub；原先它和订单/设置挤在「更多」这个
  // 杂物抽屉里，学习 tab 反而找不到它
  learn: ["learn", "videos", "articles", "news"],
  trade: ["trade"],
  screener: ["screener"],
  more: ["more", "orders", "settings", "upgrade"],
};
```

同时把该常量上方的注释

```ts
/**
 * 每个 tab 收编哪些一级路由段。
 * 学习 tab 是 hub，收编视频与文章；更多 tab 收编所有低频页面。
 */
```

改为

```ts
/**
 * 每个 tab 收编哪些一级路由段。
 * 学习 tab 是 hub，收编视频、文章与行业资讯；更多 tab 收编所有低频页面。
 */
```

- [ ] **Step 4: 改 `resolveBackTarget` 的 news 归属**

在 `resolveBackTarget` 的 switch 里，把 `news` 从「退到 `/more`」那一组移出来，单独归到 learn。即把

```ts
    case "news":
    case "orders":
    case "upgrade":
      return `/${locale}/more`;
```

改为

```ts
    // 资讯归学习 hub（见 TAB_SEGMENTS），退回时也该回 /learn 而不是 /more
    case "news":
      return `/${locale}/learn`;
    case "orders":
    case "upgrade":
      return `/${locale}/more`;
```

- [ ] **Step 5: 改 `buildMoreEntries`**

把整个函数（含其上方的 `input` 类型注释）替换为：

```ts
export function buildMoreEntries(input: {
  locale: string;
  tier: string | null;
  role: string | null;
}): MoreEntry[] {
  const { locale, tier, role } = input;
  // 资讯已移入「学习」；价格提醒与通知设置暂时隐藏（路由与页面都保留，
  // 想开回来把条目加回这里即可）
  const entries: MoreEntry[] = [
    { key: "orders", href: `/${locale}/orders` },
    { key: "settings", href: `/${locale}/settings` },
  ];

  // tier 为 null 表示 auth 还没加载完。此时不显示升级入口，
  // 避免 Pro 用户在加载窗口内看到升级链接闪一下（沿用 Navbar 的既有判断）
  if (tier !== null && tier !== "pro") {
    entries.push({ key: "upgrade", href: `/${locale}/upgrade` });
  }

  // 后台不做移动适配，这里只是个入口链接；它在 i18n 路由之外，不带语言前缀
  if (role === "admin") {
    entries.push({ key: "admin", href: "/admin" });
  }

  return entries;
}
```

注意原函数上方那段关于 `userId` 的 JSDoc 说明（`/** null/undefined = 未登录…`）随参数一并删除。

- [ ] **Step 6: 改 `more/page.tsx` 的调用**

把

```tsx
      buildMoreEntries({
        locale,
        tier: auth.tier ?? null,
        role: auth.role ?? null,
        userId: auth.userId ?? null,
      }),
    [locale, auth.tier, auth.role, auth.userId]
```

改为

```tsx
      buildMoreEntries({
        locale,
        tier: auth.tier ?? null,
        role: auth.role ?? null,
      }),
    [locale, auth.tier, auth.role]
```

- [ ] **Step 7: 运行测试与类型检查**

```bash
npx vitest run src/lib/nav/tabs.test.ts
npx tsc --noEmit
```

预期：全部通过。

- [ ] **Step 8: 提交**

```bash
git add src/lib/nav/tabs.ts src/lib/nav/tabs.test.ts "src/app/[locale]/(app)/more/page.tsx"
git commit -m "refactor(nav): 资讯移入学习 tab，更多页隐藏价格提醒与通知设置"
```

---

### Task 2: 学习页去掉学习路径、加上行业资讯

**Files:**
- Modify: `src/app/[locale]/(static)/learn/LearnHub.tsx`
- Modify: `src/app/[locale]/(static)/learn/page.tsx`
- Delete: `src/app/[locale]/(static)/learn/[slug]/`（整个目录）
- Modify: `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`

**Interfaces:**
- Consumes: Task 1 已把 `news` 归入 learn tab（本任务加的入口因此会点亮正确的 tab）
- Produces: 无代码接口。移除 `learn.hub_paths` / `learn.hub_paths_desc`，新增 `learn.hub_news` / `learn.hub_news_desc`。Task 3 会删 `admin.learning_paths`。

**背景：**
`LearnHub` 的 `sections` 数组决定学习页顶部的三个入口。`learn/page.tsx` 目前为了渲染路径列表查了两次库（`learning_paths` + `learning_path_steps`），删掉列表后**这一页不再需要任何数据库查询**，可以退化成纯静态渲染——顺带的性能收益，别把查询留着。

`learn.hub_subtitle` 三语都在宣传学习路径，删掉分区后这句会说谎，必须一并改写。

- [ ] **Step 1: 改 `LearnHub.tsx` 的分区**

把

```tsx
  const sections = [
    { key: "videos", href: `/${locale}/videos` },
    { key: "articles", href: `/${locale}/articles` },
    { key: "paths", href: "#paths" },
  ] as const;
```

改为

```tsx
  const sections = [
    { key: "videos", href: `/${locale}/videos` },
    { key: "articles", href: `/${locale}/articles` },
    { key: "news", href: `/${locale}/news` },
  ] as const;
```

同时把下方那句注释 `{/* 三个分区入口用发丝线台账列表，不做卡片堆叠 */}` 保持原样（仍是三个分区）。

- [ ] **Step 2: 改 `learn/page.tsx`——删列表并去掉数据库查询**

把整个文件替换为：

```tsx
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildLanguageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { LearnHub } from "./LearnHub";

// 学习路径删除后这一页不再读库，纯静态渲染即可。
export const revalidate = 300;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "learn" });
  return { title: t("hub_title"), alternates: { languages: buildLanguageAlternates("/learn") } };
}

export default async function LearnPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:py-12">
      <LearnHub locale={locale} />
    </div>
  );
}
```

- [ ] **Step 3: 删除学习路径详情路由**

```bash
rm -rf "src/app/[locale]/(static)/learn/[slug]"
```

- [ ] **Step 4: 改三个语言文件的 `learn` 命名空间**

在每个文件的 `learn` 对象内：**删除** `hub_paths` 与 `hub_paths_desc` 两个键，**新增** `hub_news` 与 `hub_news_desc`，并**改写** `hub_subtitle`。

`src/i18n/messages/zh-CN.json`：
```json
      "hub_subtitle": "课程、文章与行业资讯，循序渐进地建立交易认知",
      "hub_news": "行业资讯",
      "hub_news_desc": "每日市场动态与要闻速览",
```

`src/i18n/messages/en-US.json`：
```json
      "hub_subtitle": "Courses, articles and industry news that build trading judgement step by step",
      "hub_news": "Industry news",
      "hub_news_desc": "Daily market moves and headlines at a glance",
```

`src/i18n/messages/ms-MY.json`：
```json
      "hub_subtitle": "Kursus, artikel dan berita industri untuk membina pertimbangan dagangan langkah demi langkah",
      "hub_news": "Berita industri",
      "hub_news_desc": "Pergerakan pasaran harian dan berita utama sepintas lalu",
```

把 `hub_news` / `hub_news_desc` 放在 `hub_articles_desc` 之后（与页面上从上到下的顺序一致），缩进对齐该层级既有的键。

- [ ] **Step 5: 校验 JSON 与类型**

```bash
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
npx tsc --noEmit
```

预期：输出 `all valid JSON`；类型检查通过。

- [ ] **Step 6: 确认没有残留引用**

```bash
grep -rn "hub_paths" src/ || echo "no hub_paths refs — good"
```

预期：输出 `no hub_paths refs — good`。

- [ ] **Step 7: 提交**

```bash
git add "src/app/[locale]/(static)/learn" src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(learn): 学习页去掉空的学习路径分区，换成行业资讯入口"
```

---

### Task 3: 从后台与全站清除学习路径

**Files:**
- Delete: `src/app/admin/learning-paths/`（整个目录）
- Delete: `src/app/api/admin/learning-paths/route.ts`
- Modify: `src/components/layout/AdminSidebar.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/components/admin/AdminDashboardClient.tsx`
- Modify: `src/app/sitemap.ts`
- Modify: `src/types/index.ts`
- Modify: `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`

**Interfaces:**
- Consumes: Task 2 已删掉前台入口与 `/learn/[slug]` 路由
- Produces: `AdminSidebar` 的 `ADMIN_NAV` 少一项——Task 6 会在这个已清理过的数组基础上改抽屉。

**背景：**
这一步把学习路径从后台和全站彻底清掉。数据库表在 Task 4 处理。注意 `admin/page.tsx` 里 `pathsTotal` 是从一个 `Promise.all` 的解构里拿的，删查询时**必须同时删解构变量**，否则位置会错位、后面的 `quizzesTotal` 会拿到错的结果——这是本任务最容易出错的地方。

- [ ] **Step 1: 删除后台页面与 API**

```bash
rm -rf src/app/admin/learning-paths
rm -rf src/app/api/admin/learning-paths
```

- [ ] **Step 2: 从后台侧边栏去掉导航项**

在 `src/components/layout/AdminSidebar.tsx` 的 `ADMIN_NAV` 数组里删掉这一行：

```tsx
    { href: "/admin/learning-paths", label: t("learning_paths"), icon: "🧭" },
```

其余项、顺序、图标都不动。

- [ ] **Step 3: 从后台首页去掉统计查询**

在 `src/app/admin/page.tsx` 中：

删掉 `Promise.all` 数组里的这一行

```ts
    count("learning_paths"),
```

并在解构里去掉 `pathsTotal`，即把

```ts
    videosTotal, articlesTotal, articlesPublished, pathsTotal, quizzesTotal,
```

改为

```ts
    videosTotal, articlesTotal, articlesPublished, quizzesTotal,
```

再删掉返回对象里的这一行

```ts
      learningPaths: pathsTotal.count ?? 0,
```

**顺序敏感：** `Promise.all` 的解构是按位置对应的，删查询与删解构变量必须同时做，只删一边会让 `quizzesTotal` 静默拿到错误的计数。

- [ ] **Step 4: 从后台首页组件去掉统计卡**

在 `src/components/admin/AdminDashboardClient.tsx` 中，删掉类型里的这一行

```ts
    learningPaths: number;
```

以及渲染里的这一行

```tsx
          <Stat label={t("learning_paths")} value={content.learningPaths} href="/admin/learning-paths" />
```

- [ ] **Step 5: 从 sitemap 去掉学习路径 URL**

在 `src/app/sitemap.ts` 中，把

```ts
  const [{ data: articles }, { data: videos }, { data: paths }] = await Promise.all([
    client.from("articles").select("slug, updated_at").eq("is_published", true).limit(MAX_ENTRIES_PER_TYPE),
    client.from("videos").select("id, updated_at").eq("is_deleted", false).limit(MAX_ENTRIES_PER_TYPE),
    client.from("learning_paths").select("slug, updated_at").eq("is_published", true).limit(MAX_ENTRIES_PER_TYPE),
  ]);
```

改为

```ts
  const [{ data: articles }, { data: videos }] = await Promise.all([
    client.from("articles").select("slug, updated_at").eq("is_published", true).limit(MAX_ENTRIES_PER_TYPE),
    client.from("videos").select("id, updated_at").eq("is_deleted", false).limit(MAX_ENTRIES_PER_TYPE),
  ]);
```

并删掉遍历 `paths` 生成 `/learn/${p.slug}` 条目的整个 `for (const p of paths ?? []) { ... }` 块。

`STATIC_PATHS` 里的 `"/learn"` **保留**——学习页本身还在。把注释里提到 learning_paths 的那句

```ts
    // articles/learning_paths share one row per item across all locales
```

改为

```ts
    // articles share one row per item across all locales
```

- [ ] **Step 6: 删掉类型定义**

在 `src/types/index.ts` 中删除 `LearningPath` 与 `LearningPathStep` 两个 interface 的完整定义。

- [ ] **Step 7: 从三个语言文件删掉后台文案键**

在每个文件的 `admin` 对象里删掉 `learning_paths` 这一个键（zh-CN 值为「学习路径」，en-US 为 "Learning Paths"，ms-MY 为 "Laluan Pembelajaran"）。

- [ ] **Step 8: 确认没有残留引用**

```bash
grep -rn "learning_path\|LearningPath\|learning-path\|learningPath" src/ || echo "no learning-path refs left in src/ — good"
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
npx tsc --noEmit
```

预期：第一条输出 `no learning-path refs left in src/ — good`（`src/` 下零残留）；JSON 合法；类型检查通过。若 grep 仍有命中，逐一清理后重跑。

- [ ] **Step 9: 提交**

```bash
git add -A src/app/admin src/app/api/admin src/components/layout/AdminSidebar.tsx src/app/admin/page.tsx src/components/admin/AdminDashboardClient.tsx src/app/sitemap.ts src/types/index.ts src/i18n/messages
git commit -m "refactor(admin): 清除学习路径的后台页面、API、统计与站点地图条目"
```

---

### Task 4: 删表迁移

**Files:**
- Create: `supabase/migrations/042_drop_learning_paths.sql`

**Interfaces:**
- Consumes: Task 3 已清掉所有读写这两张表的代码
- Produces: 无

**背景：**
仓库已有删表迁移的先例（`037_drop_trading_limits.sql`、`038_drop_feature_flags.sql`），沿用同样的命名与写法。当前最大编号是 `041_daily_briefing.sql`，所以新文件是 `042`。

删除顺序必须是先子表后父表（`learning_path_steps` 的 `path_id` 指向 `learning_paths`）。已核实两表均为 0 行、没有第三方表引用它们。

**本任务只写文件，不应用到线上数据库。** 应用迁移是不可逆的 DDL，由控制方在计划之外单独执行，并在执行前再查一次两张表确实仍为空。

- [ ] **Step 1: 写迁移文件**

创建 `supabase/migrations/042_drop_learning_paths.sql`：

```sql
-- 删除学习路径功能。
--
-- 这个功能从未上线：写这份迁移时 learning_paths 与 learning_path_steps
-- 均为 0 行，前台的入口渲染的是「学习路径即将上线，敬请期待。」——占着
-- 学习页的首屏位置却什么都给不了。用户决定连后台一并删干净，学习页改为
-- 「视频课程 / 文章 / 行业资讯」三个入口。
--
-- 依赖关系：learning_path_steps.path_id -> learning_paths，
-- learning_path_steps.video_id -> videos。没有任何第三方表引用这两张表
-- （quizzes 与它们无关），所以按「先子表后父表」的顺序删即可，不需要 CASCADE。
-- 相关的 RLS 策略与索引随表一起消失。
--
-- 建表见 011_learning_paths.sql；040_security_and_performance_hardening.sql
-- 也曾调整过它们的 RLS 与索引。

drop table if exists public.learning_path_steps;
drop table if exists public.learning_paths;
```

- [ ] **Step 2: 确认文件名与既有迁移不冲突**

```bash
ls supabase/migrations | grep -E "^04[0-9]"
```

预期：看到 `040_...`、`041_daily_briefing.sql`、`042_drop_learning_paths.sql`，没有第二个 `042`。

- [ ] **Step 3: 提交**

```bash
git add supabase/migrations/042_drop_learning_paths.sql
git commit -m "chore(db): 新增删除学习路径两张表的迁移（表为空，无第三方引用）"
```

---

### Task 5: 移除价格提醒铃铛

**Files:**
- Modify: `src/components/layout/MobileHeader.tsx`
- Modify: `src/components/layout/Navbar.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无

**背景：**
`PriceAlertBell` 只在这两个文件里渲染。移除的是**入口**，组件本身、`PriceAlertWatcher`、`/more/alerts` 路由与页面、相关 API 与数据库**全部保留**——这是「暂时隐藏」。

`MobileHeader` 里铃铛处在一个三元表达式的 else 分支上（未登录显示登录/注册，已登录显示铃铛）。移除后 else 分支应当渲染 `null`，不要留一个空的 `<div>`。移除后已登录用户的顶部栏右侧会变空，这是设计文档里明示并获认可的结果。

- [ ] **Step 1: 改 `MobileHeader.tsx`**

删掉这行 import：

```tsx
import { PriceAlertBell } from "@/components/alerts/PriceAlertBell";
```

把这段

```tsx
        {!auth.loading && !auth.userId ? (
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">{t("sign_in")}</Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm">{t("sign_up")}</Button>
            </Link>
          </div>
        ) : (
          <PriceAlertBell />
        )}
```

改为

```tsx
        {/* 价格提醒暂时隐藏（组件与路由都还在，见
            docs/superpowers/specs/2026-08-10-mobile-nav-cleanup-design.md），
            所以已登录时右侧就是空的 */}
        {!auth.loading && !auth.userId ? (
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">{t("sign_in")}</Button>
            </Link>
            <Link href={`/${locale}/register`}>
              <Button size="sm">{t("sign_up")}</Button>
            </Link>
          </div>
        ) : null}
```

- [ ] **Step 2: 改 `Navbar.tsx`**

删掉这行 import：

```tsx
import { PriceAlertBell } from "@/components/alerts/PriceAlertBell";
```

并删掉右侧区域里的这一行：

```tsx
          <PriceAlertBell />
```

同一个 flex 容器里的 `<LanguageSwitcher />` 与其后的内容都不动。

- [ ] **Step 3: 确认组件本身还在，只是没人用**

```bash
ls src/components/alerts/PriceAlertBell.tsx
grep -rn "PriceAlertBell" src/ | grep -v "src/components/alerts/PriceAlertBell.tsx" || echo "no remaining usages — component preserved but unused, as intended"
```

预期：文件存在；第二条输出 `no remaining usages — component preserved but unused, as intended`。

- [ ] **Step 4: 类型检查与全量测试**

```bash
npx tsc --noEmit
npx vitest run
```

预期：全部通过。若 lint 因 `PriceAlertBell.tsx` 成为未被引用的文件而报错，**不要删除该文件**——它是刻意保留的；如确有 lint 规则拦截，在报告里说明，由控制方裁决。

- [ ] **Step 5: 提交**

```bash
git add src/components/layout/MobileHeader.tsx src/components/layout/Navbar.tsx
git commit -m "feat(nav): 暂时隐藏价格提醒铃铛（组件与路由保留）"
```

---

### Task 6: 后台手机可用——抽屉式侧边栏

**Files:**
- Create: `src/components/layout/AdminShell.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/components/layout/AdminHeader.tsx`
- Modify: `src/components/layout/AdminSidebar.tsx`

**Interfaces:**
- Consumes: Task 3 已从 `ADMIN_NAV` 删掉学习路径项
- Produces:
  - `AdminShell({ children }: { children: React.ReactNode })` — 客户端组件，持有抽屉开关
  - `AdminHeader({ onMenuClick }: { onMenuClick: () => void })` — 新增必填 prop
  - `AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void })` — 新增两个必填 prop

**背景：**
后台在手机上真的不能用：侧边栏 `fixed w-56`（224px）无断点，主内容区写死 `ml-56`，375px 屏幕上只剩 151px。

`admin/layout.tsx` 是 server component，拿不到 `useState`，所以抽屉状态需要一个客户端持有者。选 `AdminShell` 而不是 zustand：这是纯局部 UI 状态，只有三个组件关心，没有跨路由持久化需求，为一个布尔量建全局 store 是过度设计。

**桌面端必须一像素不变**——所有新行为都挂在 `lg:` 断点以下。

**层级与 DOM 顺序：** header 是 `sticky z-40`。遮罩取 `z-40`（与 header 同级）、侧边栏取 `z-50`。同级下靠 DOM 顺序决胜，所以 `AdminShell` 里**遮罩与侧边栏必须渲染在 `AdminHeader` 之后**，否则抽屉滑出来会被 header 压住。这条顺序依赖要写进注释。

- [ ] **Step 1: 新建 `AdminShell`**

创建 `src/components/layout/AdminShell.tsx`：

```tsx
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminHeader } from "./AdminHeader";
import { AdminSidebar } from "./AdminSidebar";

/**
 * 后台的布局外壳。
 *
 * 存在的理由：admin/layout.tsx 是 server component，拿不到 useState，而手机上
 * 侧边栏要收成抽屉、header 要有汉堡按钮，两者必须共享同一个开关状态。
 *
 * 选组件内 state 而不是 zustand：这是纯局部 UI 状态，只有这三个组件关心，
 * 也不需要跨路由持久化——为一个布尔量建全局 store 是过度设计。
 *
 * ⚠️ JSX 顺序有意义：AdminSidebar（含遮罩）必须渲染在 AdminHeader 之后。
 * header 是 sticky z-40，遮罩也是 z-40，同级下靠 DOM 顺序决胜；顺序反了
 * 抽屉滑出来会被 header 压住。重排这段 JSX 前先想清楚这一点。
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  // 抽屉打开时 Esc 关闭。不做焦点陷阱：这是单人使用的内部后台，
  // Esc + 点遮罩 + 点导航项三条关闭路径已经够用。
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-bg-primary">
      <AdminHeader onMenuClick={toggleSidebar} />
      <div className="flex">
        <AdminSidebar open={sidebarOpen} onClose={closeSidebar} />
        <main className="ml-0 flex-1 p-4 lg:ml-56 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 改 `admin/layout.tsx`**

把整个文件替换为：

```tsx
import { AdminLocaleProvider } from "@/components/admin/AdminLocaleProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { AdminShell } from "@/components/layout/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminLocaleProvider>
      <ToastProvider>
        <AdminShell>{children}</AdminShell>
      </ToastProvider>
    </AdminLocaleProvider>
  );
}
```

- [ ] **Step 3: 改 `AdminHeader`——加汉堡按钮**

把组件签名从

```tsx
export function AdminHeader() {
```

改为

```tsx
export function AdminHeader({ onMenuClick }: { onMenuClick: () => void }) {
```

把左侧那段

```tsx
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="Chart-IX" width={240} height={160} className="h-8 w-auto" />
        <span className="rounded-sm border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
          Admin
        </span>
      </div>
```

改为

```tsx
      <div className="flex items-center gap-3">
        {/* 汉堡只在手机出现；桌面侧边栏常驻，不需要它 */}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={t("open_menu")}
          className="-ml-2 flex h-11 w-11 items-center justify-center text-text-secondary transition-colors active:text-text-primary lg:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Image src="/logo.png" alt="Chart-IX" width={240} height={160} className="h-8 w-auto" />
        <span className="rounded-sm border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
          Admin
        </span>
      </div>
```

把右侧的「返回网站」链接与用户邮箱改成只在桌面显示（侧边栏底部已有「返回网站」，邮箱在手机上是纯噪声；登出按钮保留）。即把

```tsx
        <Link
          href={`/${locale}/dashboard`}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
```

改为

```tsx
        <Link
          href={`/${locale}/dashboard`}
          className="hidden items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary lg:flex"
        >
```

并把

```tsx
            <span className="text-xs text-text-tertiary">
              {user.email}
            </span>
```

改为

```tsx
            <span className="hidden text-xs text-text-tertiary lg:inline">
              {user.email}
            </span>
```

- [ ] **Step 4: 改 `AdminSidebar`——手机上收成抽屉**

把组件签名从

```tsx
export function AdminSidebar() {
```

改为

```tsx
export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
```

把 `return (` 之后的 `<aside ...>` 那一行及其闭合改为下面这段（遮罩 + 侧边栏，用 Fragment 包起来）。原来的：

```tsx
    <aside className="fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-56 border-r border-border-default glass overflow-y-auto flex flex-col">
```

改为：

```tsx
    <>
      {/* 手机上的遮罩：点它关抽屉。z-40 与 sticky 的 header 同级，靠 DOM 顺序
          盖住 header——AdminShell 里本组件必须渲染在 AdminHeader 之后 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-14 z-50 flex h-[calc(100vh-3.5rem)] w-56 flex-col overflow-y-auto border-r border-border-default glass transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
```

并把文件结尾的

```tsx
    </aside>
  );
}
```

改为

```tsx
      </aside>
    </>
  );
}
```

最后，让点击导航项后自动关闭抽屉——给 `ADMIN_NAV` 的 `<Link>` 加 `onClick={onClose}`：

```tsx
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
```

底部那个「返回网站」`<Link>` 同样加 `onClick={onClose}`。

`cn` 已经在该文件顶部 import 过（`import { cn } from "@/lib/utils";`），不需要新增 import。

- [ ] **Step 5: 加汉堡按钮的无障碍文案**

在三个语言文件的 `admin` 对象里新增 `open_menu` 键：

`src/i18n/messages/zh-CN.json`：
```json
    "open_menu": "打开菜单",
```

`src/i18n/messages/en-US.json`：
```json
    "open_menu": "Open menu",
```

`src/i18n/messages/ms-MY.json`：
```json
    "open_menu": "Buka menu",
```

- [ ] **Step 6: 校验**

```bash
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
npx tsc --noEmit
npm run lint
npx vitest run
```

预期：全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/layout/AdminShell.tsx src/app/admin/layout.tsx src/components/layout/AdminHeader.tsx src/components/layout/AdminSidebar.tsx src/i18n/messages
git commit -m "feat(admin): 侧边栏在手机上改为抽屉，后台从此可用"
```

---

### Task 7: 全量校验与浏览器验收

**Files:** 无代码改动（纯验证任务）

**Interfaces:**
- Consumes: Task 1–6 的全部产出
- Produces: 无

**背景：**
前六个任务里只有 Task 1 有单元测试覆盖；学习页、后台抽屉、铃铛移除都属于组件与布局，项目的 node 环境 vitest 覆盖不到。本任务用真实浏览器补上。

**注意 dev server 的坑：** 若在 git worktree 里执行本计划，`preview_start` 按会话工作目录解析 `.claude/launch.json`，起的可能是主仓库而不是 worktree。验收前先确认服务的是正确的代码（例如访问 `/zh-CN/learn` 看是否已无学习路径分区）。

- [ ] **Step 1: 全量校验**

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

预期：四项全过。

- [ ] **Step 2: 起开发服务器，切手机视口（375×812）**

- [ ] **Step 3: 验收学习页**

访问 `/zh-CN/learn`：

- 三个入口为「视频课程 / 文章 / 行业资讯」
- 页面上**没有**学习路径分区，也没有「学习路径即将上线」字样
- 副标题不再提学习路径

- [ ] **Step 4: 验收资讯的 tab 归属与返回**

从学习页点进「行业资讯」：

- 底部高亮的是**学习** tab（不是更多）
- 点顶部返回，退到 `/zh-CN/learn`

- [ ] **Step 5: 验收「更多」页**

访问 `/zh-CN/more`（登录状态）：只剩「交易历史」「设置」（免费用户另有「升级 Pro」，管理员另有「后台管理」）。**没有**行业资讯、价格提醒、通知设置。

- [ ] **Step 6: 验收铃铛已移除**

登录状态下，手机顶部栏右侧无铃铛；桌面视口（1280×900）Navbar 右侧同样无铃铛。

- [ ] **Step 7: 验收已删路由**

访问 `/zh-CN/learn/anything`，应为 404。

- [ ] **Step 8: 验收后台手机可用（本任务的重头）**

手机视口访问 `/admin`：

- 内容区占满屏宽，页面**不横向滚动**；侧边栏不可见
- 点汉堡：抽屉从左滑入并**盖住 header**（不是被 header 压住）
- 点遮罩关闭；再打开，按 `Esc` 关闭
- 打开抽屉点任一导航项：跳转且抽屉自动关闭
- 侧边栏里**没有**「学习路径」
- 访问 `/admin/users` 与 `/admin/logs`：表格可横向滚动，但**页面本身不横向滚动**

- [ ] **Step 9: 验收桌面后台零变化**

桌面视口 1280×900 逐页比对 `/admin`、`/admin/users`、`/admin/videos`：

- 侧边栏常驻可见、主内容区 `ml-56` 生效
- 汉堡按钮**不出现**
- 「返回网站」与用户邮箱正常显示
- 与改动前应当无任何可见差异

- [ ] **Step 10: 三语抽查**

分别打开 `/en-US/learn` 与 `/ms-MY/learn`，确认三个入口文案正确、无缺失键报错；后台切到英文确认汉堡按钮的 `aria-label` 有值。

- [ ] **Step 11: 控制台检查**

上述各页控制台无报错。

- [ ] **Step 12: 关闭开发服务器**

---

## 自检记录

- **设计文档 A 逐节覆盖：** ①学习路径全栈删除 → Task 2（前台）+ Task 3（后台/全站）+ Task 4（数据库）；②行业资讯移入学习 → Task 1（tab 归属与返回目标）+ Task 2（入口与文案）；③隐藏价格提醒与通知设置 → Task 1（更多页条目）+ Task 5（铃铛）；测试与验收 → Task 1 的单测 + Task 7 的 Step 3–7。
- **设计文档 B 逐节覆盖：** ①`AdminShell` → Task 6 Step 1–2；②三个组件的改动 → Task 6 Step 3–4；③无障碍与键盘 → Task 6 Step 1（Esc）+ Step 3（aria-label/aria-expanded）+ Step 5（文案）；验收 → Task 7 Step 8–9。
- **一处对设计文档的补充：** 设计 B 提到汉堡按钮要带 `aria-expanded={open}`，但 `AdminHeader` 只拿到 `onMenuClick` 拿不到 `open`。**Task 6 Step 3 的代码里因此没有 `aria-expanded`**——要加就得再传一个 `open` prop 下去。判断：`aria-label` 已经提供了可访问名称，缺 `aria-expanded` 对单人内部后台影响很小，不值得为它多穿一个 prop。这一处刻意偏离设计文档，写在这里备案，实施者不必自行补上。
- **顺序依赖已锁死：** Task 3 必须早于 Task 6（前者从 `ADMIN_NAV` 删项，后者重排整个侧边栏——反过来会在同一处制造冲突）。Task 1 必须早于 Task 2（`news` 的 tab 归属先改，学习页的入口才会点亮正确的 tab）。
- **类型一致性：** Task 1 产出 `buildMoreEntries({locale, tier, role})`，Task 1 Step 6 同步改了唯一调用点；Task 6 产出的三个组件签名（`AdminShell`/`AdminHeader({onMenuClick})`/`AdminSidebar({open,onClose})`）在 Step 1–4 内部自洽，无外部消费者。
- **占位符扫描：** 无 TBD / TODO / 「类似 Task N」/ 无代码的步骤。
