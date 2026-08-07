# 感知性能优化 · 阶段 2：导航即时反馈 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击任何导航 100ms 内出现视觉响应；已看过的页面二次进入即时显示旧数据、后台静默刷新。

**Architecture:** 三条线——① React Query 全局启用 `keepPreviousData`，内容类查询延长 staleTime；② 五个手写 useEffect 取数页面迁移到 useQuery（顺带修 /settings 闪"请先登录"、/orders 无上限查询、/learn/[slug] 串行瀑布）；③ 为全部缺失路由补 `loading.tsx`（admin 用共享 layout 一个文件覆盖）。

**Tech Stack:** @tanstack/react-query v5（`keepPreviousData` placeholder）、Next.js App Router loading.tsx 约定、Supabase JS v2（PostgREST 嵌套查询）。

**Spec:** docs/superpowers/specs/2026-08-07-perceived-performance-design.md 第 2 节。阶段 1 已合并：页面现位于 `(app)`/`(static)` 路由组。

## Global Constraints

- 所有功能与交互逻辑保持不变；三语文案保持不变；不引入新依赖。
- **交易关键数据的新鲜度不得放宽**：持仓/余额/挂单相关 hook 的 staleTime/refetchInterval 现状不动；`useDashboardOrders` 与订单历史保持 staleTime ≤ 15s。
- 内容类查询（视频/文章列表、社区、定价等）staleTime 提至 5 分钟、gcTime 30 分钟。
- 每个 Task 独立 commit，信息末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 每个 Task 完成时 `npx tsc --noEmit` 与 `npm run test` 必须全绿。

## 背景知识（实施者必读）

1. React Query v5 中 `placeholderData: keepPreviousData`（从 `@tanstack/react-query` 具名导出）使 queryKey 变化时保留上一 key 的数据、`isPending` 为 false、`isPlaceholderData` 为 true——这正是"切换不塌陷"的机制。设为全局 default 后，所有 useQuery 自动获得该行为；各 hook 自己的 staleTime/refetchInterval 不受影响。
2. `loading.tsx` 是 App Router 的路由级 Suspense fallback：点击导航后、服务端 RSC 响应到达前立即显示。放在某段目录下即覆盖该段（admin 的 `layout.tsx` 在 `src/app/admin/layout.tsx`，故 `src/app/admin/loading.tsx` 一个文件覆盖全部 11 个 admin 子页切换）。
3. 骨架屏组件：`@/components/ui/Skeleton`（用法见 `src/app/[locale]/(static)/articles/loading.tsx`，本计划的骨架代码沿用同一风格）。
4. 阶段 1 之后 `useAuth()`（`@/components/auth/AuthProvider`）已能在一次往返内提供 `userId/email/displayName/tier/role/loading`——迁移页面应从 auth context 取身份，而不是自己再调 `supabase.auth.getUser()`。

## File Structure（改动全景）

```
src/components/layout/QueryProvider.tsx                     [修改] 全局 keepPreviousData
src/hooks/useDashboardData.ts                               [修改] staleTime/gcTime + limit(50)
src/hooks/useOrderHistory.ts                                [新建] 订单历史 useQuery hook
src/app/[locale]/(app)/orders/page.tsx                      [修改] 迁 useQuery
src/app/[locale]/(app)/settings/page.tsx                    [修改] 迁 useQuery + 修闪现
src/app/[locale]/(app)/upgrade/page.tsx                     [修改] 迁 useQuery
src/app/[locale]/(static)/videos/[id]/page.tsx              [修改] video 取数迁 useQuery
src/app/[locale]/(static)/learn/[slug]/page.tsx             [修改] 压平瀑布
src/app/[locale]/(app)/{dashboard,trade,screener,orders,community/[id],settings,settings/api-keys,more,more/alerts,more/notifications,upgrade}/loading.tsx  [新建 11 个]
src/app/[locale]/(static)/{videos/[id],learn/[slug]}/loading.tsx  [新建 2 个]
src/app/admin/loading.tsx                                   [新建 1 个]
```

---

### Task 1: QueryProvider 全局启用 keepPreviousData

**Files:**
- Modify: `src/components/layout/QueryProvider.tsx`

**Interfaces:**
- Produces: 全局所有 useQuery 在 queryKey 变化时保留旧数据（`isPlaceholderData` 标记），二次进入页面时缓存立即可用。后续 Task 3-7 及阶段 3 都依赖此默认值。

- [ ] **Step 1: 修改 QueryProvider**

整文件替换为：

```tsx
"use client";

import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
            // Key changes (symbol switch, page revisit) keep showing the
            // previous data while the new key loads in the background —
            // "old data first, silent refresh" (spec §2). Freshness is
            // still governed per-hook by staleTime/refetchInterval.
            placeholderData: keepPreviousData,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/QueryProvider.tsx
git commit -m "perf(query): global keepPreviousData — key switches keep old data visible"
```

---

### Task 2: useDashboardData——内容类 staleTime 提升 + 订单 limit(50)

**Files:**
- Modify: `src/hooks/useDashboardData.ts`

**Interfaces:**
- Produces: 四个 hook 对外签名不变。`useDashboardOrders` 最多返回 50 条（dashboard 账本区只渲染有限条，50 覆盖其客户端 filter 需求——spec §2 改动 5）。

- [ ] **Step 1: 修改四个 hook 的选项**

- `useContinueWatching`：`staleTime: 30_000` 保持（用户自己的进度，新鲜度重要），加 `gcTime: 30 * 60_000`。
- `useLatestVideos`：`staleTime: 60_000` → `staleTime: 5 * 60_000`，加 `gcTime: 30 * 60_000`。
- `useLatestArticles`：同上 → `staleTime: 5 * 60_000`，加 `gcTime: 30 * 60_000`。
- `useDashboardOrders`：`staleTime: 15_000` 保持（交易数据约束），加 `gcTime: 30 * 60_000`；查询链加 `.limit(50)`（插在 `.order(...)` 之后）。

> 偏离 spec 的说明（写死此裁定）：spec 说"内容类一律 5 分钟"，continue-watching 虽是内容区块但本质是用户自己的观看进度，保持 30s——用户刚看完视频回 dashboard 应尽快反映。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDashboardData.ts
git commit -m "perf(dashboard): content staleTime 5m + gcTime 30m; cap orders query at 50"
```

---

### Task 3: /orders 迁移 React Query + limit(200)

**Files:**
- Create: `src/hooks/useOrderHistory.ts`
- Modify: `src/app/[locale]/(app)/orders/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`（身份与 loading 态）、Task 1 的全局 keepPreviousData。
- Produces: `useOrderHistory(userId: string | null)` → `useQuery` 结果，`data: Order[]`（`@/types` 的 Order），最多 200 条。

- [ ] **Step 1: 写 useOrderHistory.ts**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Order } from "@/types";

/** Full order history for the /orders page. Capped at 200 — the page is a
 * recent-history view, not an archive export (spec §2). */
export function useOrderHistory(userId: string | null) {
  return useQuery({
    queryKey: ["orders", "history", userId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data as unknown as Order[]) ?? [];
    },
    enabled: !!userId,
    staleTime: 15_000,
    gcTime: 30 * 60_000,
  });
}
```

- [ ] **Step 2: 改写 orders/page.tsx 的数据层**

页面现状（`src/app/[locale]/(app)/orders/page.tsx`）：`orders/loading/error/notLoggedIn` 四个 useState + `fetchOrders` useCallback（内部先 `supabase.auth.getUser()` 再查表，串行两跳、无 limit、无缓存）。改为：

1. 删除这四个 useState、`fetchOrders`、`useEffect` 和顶层 `const supabase = createClient()`。
2. 引入 `const auth = useAuth();`（`@/components/auth/AuthProvider`）与 `const query = useOrderHistory(auth.userId);`。
3. 渲染分支映射（保持现有 JSX 骨架/空态/错误块不动，只换判定条件）：
   - 原 `if (loading)` → `if (auth.loading || (auth.userId && query.isPending))`
   - 原 `if (notLoggedIn)` → `if (!auth.loading && !auth.userId)`
   - 原 `if (error && !orders.length)` → `if (query.error && !query.data?.length)`，错误文案 `(query.error as Error).message`，重试按钮 onClick 改 `() => query.refetch()`
   - 正文中 `orders` → `query.data ?? []`（`filteredOrders` 的 useMemo 依赖同步改）
   - 顶部内联错误条 `{error && ...}` → `{query.error && !!query.data?.length && ...}`（有旧数据时仅提示不清空——spec §5 错误处理原则）
4. 页面本地的 `Order` interface 与 `@/types` 的 `Order` 对比：字段一致则删除本地定义改 import；不一致则保留本地定义并在 hook 返回处 `as` 转换（以实际比对结果为准，报告里写明选了哪条）。

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOrderHistory.ts "src/app/[locale]/(app)/orders/page.tsx"
git commit -m "perf(orders): migrate to React Query, cap at 200, auth from context"
```

---

### Task 4: /settings 迁移 + 修"请先登录"闪现

**Files:**
- Modify: `src/app/[locale]/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`；`useQueryClient`（保存后失效缓存）。
- Produces: 无对外接口；行为约定——加载中显示骨架而非"请先登录"；已登录用户绝不会看到未登录文案。

- [ ] **Step 1: 改写数据层**

现状：`user/profile` 两个 useState + useEffect 内串行 `getUser()` → 查 `users` 表；`if (!user)` 同时表示"加载中"和"未登录"（闪现根源）。改为：

1. 身份来自 context：删除 `user` state 与 useEffect 里的 `getUser()`；`const auth = useAuth();`。原 `user.id`/`user.email` 分别改 `auth.userId`/`auth.email ?? ""`。
2. profile 改 useQuery（文件内定义即可，不必抽 hook）：

```ts
const profileQuery = useQuery({
  queryKey: ["settings", "profile", auth.userId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("users")
      .select("display_name, language, tier, role")
      .eq("id", auth.userId as string)
      .single();
    if (error) throw new Error(error.message);
    return data as { display_name: string | null; language: string; tier: string; role: string };
  },
  enabled: !!auth.userId,
  staleTime: 5 * 60_000,
});
```

3. `displayName` 输入框 state 的初始化：保留 `const [displayName, setDisplayName] = useState("")`，加一个 effect 在 `profileQuery.data` 首次到达时 `setDisplayName(data.display_name ?? "")`（防止覆盖用户正在输入的值：仅当输入框仍为初始空串时同步）。
4. `saveProfile`：`user.id` → `auth.userId`；成功后 `queryClient.setQueryData(["settings","profile",auth.userId], (prev) => prev ? { ...prev, display_name: displayName || null } : prev)` 替代原 `setProfile`，`auth.refresh()` 保留。
5. `saveLanguage` 同理改 `queryClient.setQueryData` + `router.refresh()` 保留。
6. 渲染分支：

```tsx
if (auth.loading) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-8 h-64 w-full" />
      <Skeleton className="mt-6 h-32 w-full" />
    </div>
  );
}
if (!auth.userId) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
      <p className="text-text-muted">{t("please_login")}</p>
    </div>
  );
}
```

正文中 `profile?.xxx` 改为 `profileQuery.data?.xxx`（`?? "-"` 兜底已有，profile 未到达时显示占位，不阻塞整页）。需要新增 imports：`useQuery, useQueryClient`、`Skeleton`。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/settings/page.tsx"
git commit -m "fix(settings): loading skeleton instead of please-login flash; profile via React Query"
```

---

### Task 5: /upgrade 迁移 React Query

**Files:**
- Modify: `src/app/[locale]/(app)/upgrade/page.tsx`

**Interfaces:**
- Consumes: Task 1 全局 keepPreviousData（二次进入即时显示价格）。
- Produces: 无对外接口。现有的"—/loading"占位卡片继续充当首载占位（页面已有，无布局跳动问题的骨架不必重做）。

- [ ] **Step 1: 改写数据层**

现状：useEffect 里两个独立 Supabase 查询 setState。改为一个 useQuery 并行拿两者：

```ts
const { data } = useQuery({
  queryKey: ["upgrade", "pricing"],
  queryFn: async () => {
    const supabase = createClient();
    const [plansRes, tgRes] = await Promise.all([
      supabase
        .from("pricing_config")
        .select("*")
        .eq("is_active", true)
        .order("price", { ascending: true }),
      supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "telegram_group")
        .maybeSingle(),
    ]);
    return {
      plans: (plansRes.data as PricingPlan[]) ?? [],
      telegramUrl:
        typeof tgRes.data?.value === "string" ? tgRes.data.value : null,
    };
  },
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
});
const plans = data?.plans ?? [];
const telegramUrl = data?.telegramUrl ?? null;
```

删除原 `plans/telegramUrl` useState 与 useEffect；其余 JSX 不动（`plans.length > 0 ? ... : 占位卡片` 分支原样保留）。新增 import `useQuery`。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/upgrade/page.tsx"
git commit -m "perf(upgrade): pricing via React Query — cached, parallel, instant on revisit"
```

---

### Task 6: /videos/[id] 视频数据迁移 React Query

**Files:**
- Modify: `src/app/[locale]/(static)/videos/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 1 全局 keepPreviousData。
- Produces: 无对外接口。行为约定：浏览计数、进度上报（10s interval upsert）、防下载快捷键拦截、预览逻辑全部保持不变。

- [ ] **Step 1: 迁移 video 取数**

现状："Fetch video data" useEffect + `video/loading/error` useState；"Increment view count" effect 依赖 `video` state。改为：

1. video 查询：

```ts
const queryClient = useQueryClient();
const videoQuery = useQuery({
  queryKey: ["video", videoId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("videos")
      .select("*, category:video_categories(id, name, slug)")
      .eq("id", videoId)
      .eq("is_deleted", false)
      .single();
    if (error) throw new Error(error.message);
    return data as Video;
  },
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
});
const video = videoQuery.data ?? null;
```

2. 删除 `video/loading/error` 三个 useState 与取数 useEffect；页面中 `loading` → `videoQuery.isPending`，`error` → `videoQuery.error ? (videoQuery.error as Error).message : null`（渲染分支保持原判定顺序）。
3. 浏览计数 effect：`viewIncrementedRef` 机制保留，成功后原 `setVideo(prev => ...)` 改为：

```ts
queryClient.setQueryData<Video>(["video", videoId], (prev) =>
  prev ? { ...prev, view_count: (prev.view_count ?? 0) + 1 } : prev
);
```

注意 `viewIncrementedRef` 需在 `videoId` 变化时重置（切换视频也要计数）：在取数 effect 删除后，加一行 `useEffect(() => { viewIncrementedRef.current = false; }, [videoId]);`。
4. 其余 effect（快捷键拦截、进度 interval）不动；新增 imports：`useQuery, useQueryClient`。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(static)/videos/[id]/page.tsx"
git commit -m "perf(video): detail fetch via React Query — cached across navigations"
```

---

### Task 7: /learn/[slug] 压平四段瀑布

**Files:**
- Modify: `src/app/[locale]/(static)/learn/[slug]/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`、Task 1 全局 keepPreviousData。
- Produces: 无对外接口。行为约定：公开内容（路径+步骤）不再等认证态就绪才加载；进度到达后再合并；全部完成时的 `grant_achievement` RPC 保持（幂等）。

- [ ] **Step 1: 改写数据层**

现状：单个 useEffect 内 3 段串行（path → steps → progress），且 `if (!auth.loading) load()` 先等认证。改为两个并行 useQuery：

```ts
// path + steps 一次嵌套查询拿全（公开数据，立即发起，不等 auth）
const pathQuery = useQuery({
  queryKey: ["learn", "path", slug],
  queryFn: async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("learning_paths")
      .select("*, steps:learning_path_steps(*, video:videos(id, title, duration_seconds, tier_required))")
      .eq("slug", slug)
      .eq("is_published", true)
      .order("sort_order", { referencedTable: "learning_path_steps", ascending: true })
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { steps, ...path } = data as unknown as LearningPath & { steps: StepWithVideo[] };
    return { path: path as LearningPath, steps: steps ?? [] };
  },
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
});

const steps = pathQuery.data?.steps ?? [];
const videoIds = steps.map((s) => s.video_id);

// 用户进度：auth.userId 就绪即发，与 pathQuery 并行（不串行等 path——
// videoIds 到达前 enabled 为 false，到达后自动触发，仍比原来的三段串行少一跳）
const progressQuery = useQuery({
  queryKey: ["learn", "progress", auth.userId, slug, videoIds.length],
  queryFn: async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("video_progress")
      .select("video_id")
      .eq("user_id", auth.userId as string)
      .eq("completed", true)
      .in("video_id", videoIds);
    return new Set((data ?? []).map((p: { video_id: string }) => p.video_id));
  },
  enabled: !!auth.userId && videoIds.length > 0,
  staleTime: 30_000,
});
const completedVideoIds = progressQuery.data ?? new Set<string>();
```

删除原 `path/steps/completedVideoIds/loading` useState 与整个取数 useEffect。渲染判定：
- 原 `if (loading || path === undefined)` → `if (pathQuery.isPending)`
- 原 `if (path === null)` → `if (!pathQuery.data)`（查询完成但无数据）
- 正文 `path` → `pathQuery.data.path`。

- [ ] **Step 2: 成就 RPC 移到 effect**

原代码在取数函数里判断"全部完成则 grant"。改为：

```ts
useEffect(() => {
  if (
    auth.userId &&
    steps.length > 0 &&
    completedVideoIds.size === steps.length
  ) {
    // Idempotent server-side (no-ops if already earned) — safe to re-fire.
    createClient().rpc("grant_achievement", { p_key: "first_path_completed" }).then(() => {});
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [auth.userId, steps.length, completedVideoIds.size]);
```

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。另外人工核对（无需登录）：dev server 打开任一 `/zh-CN/learn/<slug>`，未登录也应立即渲染路径与步骤列表（原来要等 auth 才发第一个请求）。

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(static)/learn/[slug]/page.tsx"
git commit -m "perf(learn): flatten 4-hop waterfall — nested path+steps query, parallel progress"
```

---

### Task 8: 补齐全部 loading.tsx（13 个用户面 + 1 个 admin）

**Files:**
- Create: 下列 14 个文件。

**Interfaces:**
- Produces: 纯展示组件，无接口。约定：每个骨架的外层容器类名与对应 page.tsx 的外层容器一致（宽度/内边距同形，避免切换时横向跳动）；一律用 `@/components/ui/Skeleton`。

> 下列代码为基准实现。若实施时发现某页面首屏结构与骨架明显不符（比如区块数量、宽度类名有出入），以 page.tsx 实际外层容器类名为准微调，其余保持。

- [ ] **Step 1: (app) 组 11 个**

`src/app/[locale]/(app)/dashboard/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <Skeleton className="h-8 w-56" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    </div>
  );
}
```

`src/app/[locale]/(app)/trade/loading.tsx`（交易页是全屏工具页，骨架只给主区块，避免与动态布局冲突）：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function TradeLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-2 p-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="min-h-0 flex-1" />
      <Skeleton className="h-40 w-full lg:h-56" />
    </div>
  );
}
```

`src/app/[locale]/(app)/screener/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function ScreenerLoading() {
  return (
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <Skeleton className="h-8 w-48" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
```

`src/app/[locale]/(app)/orders/loading.tsx`（与页面内联骨架同形的精简版）：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function OrdersLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:py-12">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-8 mb-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20 rounded-sm" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
```

`src/app/[locale]/(app)/community/[id]/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function CommunityPostLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-6 h-8 w-3/4" />
      <div className="mt-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      <Skeleton className="mt-8 h-24 w-full" />
    </div>
  );
}
```

`src/app/[locale]/(app)/settings/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-8 h-64 w-full" />
      <Skeleton className="mt-6 h-32 w-full" />
      <Skeleton className="mt-6 h-28 w-full" />
    </div>
  );
}
```

`src/app/[locale]/(app)/settings/api-keys/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function ApiKeysLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:py-12">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-8 h-48 w-full" />
      <Skeleton className="mt-6 h-40 w-full" />
    </div>
  );
}
```

`src/app/[locale]/(app)/more/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function MoreLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="mt-8 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
```

`src/app/[locale]/(app)/more/alerts/loading.tsx` 与 `src/app/[locale]/(app)/more/notifications/loading.tsx`（同一份内容，组件名分别为 `AlertsLoading` / `NotificationsLoading`）：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function AlertsLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Skeleton className="h-8 w-40" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
```

`src/app/[locale]/(app)/upgrade/loading.tsx`：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function UpgradeLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Skeleton className="mx-auto h-4 w-40" />
        <Skeleton className="mx-auto mt-6 h-12 w-3/4" />
        <Skeleton className="mx-auto mt-5 h-5 w-2/3" />
      </div>
      <div className="mx-auto mt-16 grid max-w-3xl gap-6 md:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: (static) 组 2 个**

`src/app/[locale]/(static)/videos/[id]/loading.tsx`（外层容器以 page.tsx 实际类名为准）：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function VideoDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Skeleton className="aspect-video w-full" />
      <Skeleton className="mt-6 h-8 w-2/3" />
      <div className="mt-3 flex gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="mt-8 h-40 w-full" />
    </div>
  );
}
```

`src/app/[locale]/(static)/learn/[slug]/loading.tsx`（复用页面现有内联骨架的结构）：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function LearningPathLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Skeleton className="h-8 w-64" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: admin 1 个**

`src/app/admin/loading.tsx`（admin 共享 layout 下，一个文件覆盖全部子页切换；admin 不引用用户面 Skeleton 主题也成立——确认 `@/components/ui/Skeleton` 无用户面依赖后直接复用）：

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function AdminLoading() {
  return (
    <div className="p-6">
      <Skeleton className="h-8 w-56" />
      <div className="mt-6 flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit && npm run test`
Expected: 全绿。再 `npm run build`：articles/videos/learn 三个列表页仍为 ●（loading.tsx 不引入动态 API，不得破坏阶段 1 的静态化）。

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]" src/app/admin/loading.tsx
git commit -m "perf(nav): route-level loading skeletons for all remaining user + admin routes"
```

---

### Task 9: 阶段验证

**Files:** 无新改动（验证任务）。

- [ ] **Step 1: 构建核验**

Run: `npm run build`
Expected: 编译成功；路由表中 `/[locale]/articles`、`/[locale]/videos`、`/[locale]/learn` 仍为 ●（5m），其余用户页 ƒ；无新告警。

- [ ] **Step 2: 全量测试**

Run: `npm run test`
Expected: 427+ 全绿。

- [ ] **Step 3: 留给用户验收的清单（写进报告，不在本任务执行）**

Slow 4G 节流下：① 点击任意导航 100ms 内出现骨架或旧内容；② dashboard → 任意页 → 返回 dashboard，卡片即时显示旧数据后静默刷新；③ /settings 已登录硬刷新不再闪"请先登录"；④ /learn/[slug] 未登录立即出内容；⑤ /orders 列表最多 200 条、筛选/CSV 导出正常；⑥ admin 任意两页互切有骨架过渡。

---

## 阶段验收（对应 spec 验收标准 1、2）

- [ ] 全部 14 个 loading.tsx 存在且构建通过，三个静态页保持 ●；
- [ ] 全局 keepPreviousData 生效（切页返回即时显示旧数据）；
- [ ] 5 个手写 useEffect 页面全部迁移 React Query，/settings 无闪现、/orders 与 dashboard 订单查询有上限、/learn/[slug] 无认证等待；
- [ ] 交易关键数据 staleTime 未被放宽（useDashboardOrders/useOrderHistory 15s、trade 相关 hook 未动）。

完成后进入阶段 3 计划（交易页顺滑：图表增量更新、价格线 diff、断点修复、面板按需加载）。
