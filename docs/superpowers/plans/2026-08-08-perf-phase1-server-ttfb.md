# 感知性能优化 · 阶段 1：服务端 TTFB 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 砍掉每个页面服务端渲染前的认证串行往返，恢复 articles/videos/learn 三个内容页的 ISR 静态直出。

**Architecture:** 三步走——① DB 触发器把 `display_name` 同步进 JWT claims（复用既有 009 迁移的模式），使 `getUser()` 一次往返带回全部认证信息；② `getServerAuth()` 用 React `cache()` 去重；③ 把 `[locale]/layout.tsx` 拆成"纯 Provider 父布局 +（app）/（static）两个路由组布局"，认证只发生在 (app) 组，(static) 组不读 cookie，三个内容页恢复静态渲染。

**Tech Stack:** Next.js 15 App Router（路由组、ISR、React `cache()`）、Supabase（Postgres 触发器、`raw_app_meta_data`）、React 19。

**Spec:** docs/superpowers/specs/2026-08-07-perceived-performance-design.md 第 1 节。与 spec 草案的一个实现偏差（语义不变、更稳健）：昵称同步采用"DB 触发器写 `app_metadata`"而非"settings 页双写 `user_metadata`"——与 009 迁移同一模式，admin 后台改昵称也不会失同步，settings 页零改动。

## Global Constraints

- 所有功能与交互逻辑保持不变；三语文案内容保持不变。
- 沿用现有技术栈，不引入任何新依赖。
- 部署顺序：**先在 Supabase 应用迁移 039，再部署应用代码**（代码读不到 claims 里的 display_name 时回退到邮箱前缀，不报错但会短暂显示邮箱前缀）。
- URL 不变：路由组 `(app)`/`(static)` 不出现在 URL 里。
- 提交信息格式沿用仓库惯例（如 `perf(auth): ...`、`refactor(layout): ...`），提交末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## 背景知识（实施者必读）

1. **现状瀑布**：`src/app/[locale]/layout.tsx:65` 每次请求调 `getServerAuth()` → `supabase.auth.getUser()`（网络往返到 Supabase Auth）→ 再查一次 `users` 表拿 `display_name`（第二次往返）。tier/role **已经**由迁移 009 的触发器同步进 `app_metadata`，不需要第二次查询——第二次查询纯粹为了 display_name。
2. **ISR 失效原因**：articles/videos/learn 三个列表页自己用 service-role 客户端 + `revalidate = 300`，但父布局 `getServerAuth()` → `createClient()` → `cookies()`（`src/lib/supabase/server.ts:5`）把整棵路由树拉成动态渲染。
3. **路由组语义**：`(app)`、`(static)` 是 Next.js 路由组，不影响 URL；但**父布局仍然对组内路由生效**，所以必须把 `getServerAuth()` 从 `[locale]/layout.tsx` 下移到 `(app)/layout.tsx`，父布局绝不能碰 cookie。
4. **QueryProvider 必须留在父布局**：跨组导航（如 /dashboard → /articles）会卸载旧组布局、挂载新组布局；若 React Query 的 Provider 在组布局里，跨组导航会清空全部查询缓存，直接违背阶段 2 的"旧数据先上"目标。
5. **AuthProvider 在组布局里**（它需要接收各组不同的 `initialAuth`），跨组导航会重挂载。为避免跨组时导航栏登录态闪烁，用模块级变量缓存上一次的认证状态（客户端导航时 remount 立即恢复；硬加载时该变量为 null，与服务端渲染输出一致，无水合冲突）。
6. `getSiteSettings()`（`src/lib/site-settings.ts:85`）用 service-role 客户端且已包 `cache()`，不读 cookie，静态安全，可以在任何布局调用。
7. `getTranslations({ locale, namespace })` 显式传 locale 时不读请求头，静态安全（next-intl 规则：只有省略 locale 才会退到读请求状态）。

## File Structure（改动全景）

```
supabase/migrations/039_sync_display_name_to_claims.sql   [新建] 触发器扩展 + 回填
src/lib/supabase/get-auth.ts                              [修改] cache() + claims 读 display_name
src/components/auth/AuthProvider.tsx                      [修改] claims 读 display_name + 模块级缓存
src/app/[locale]/layout.tsx                               [修改] 只留 Provider，不再认证
src/app/[locale]/LocaleProviders.tsx                      [新建] NextIntl + Query + Toast（客户端）
src/app/[locale]/AppChrome.tsx                            [新建] AuthProvider + Navbar/Shell/Footer/watchers（客户端）
src/app/[locale]/ClientLocaleLayout.tsx                   [删除] 被上面两个文件取代
src/app/[locale]/(app)/layout.tsx                         [新建] getServerAuth → AppChrome
src/app/[locale]/(static)/layout.tsx                      [新建] 无认证 → AppChrome
src/app/[locale]/(app)/…                                  [移动] 除 articles/learn/videos 外全部页面目录
src/app/[locale]/(static)/{articles,learn,videos}/        [移动] 三个内容目录（含各自的 [slug]/[id] 子页）
```

不动：`manifest.webmanifest/`（留在 `[locale]` 直下）、`src/middleware.ts`、settings 页（触发器使其零改动）。

---

### Task 1: 迁移 039——display_name 同步进 JWT claims

**Files:**
- Create: `supabase/migrations/039_sync_display_name_to_claims.sql`

**Interfaces:**
- Produces: 此后 `supabase.auth.getUser()` 返回的 `user.app_metadata.display_name` 与 `public.users.display_name` 实时一致（同事务同步）。Task 2/3 依赖这一点。

- [ ] **Step 1: 写迁移文件**

```sql
-- ============================================================
-- Chart-IX 数据库迁移 #039: 把 display_name 也同步进 auth.users.app_metadata
-- ============================================================
-- 009 已把 tier/role 同步进 app_metadata，但 getServerAuth()/AuthProvider
-- 仍要为 display_name 单独多查一次 public.users。本迁移把 display_name
-- 加入同一个同步函数与触发器，使 auth.getUser() 一次往返带回全部信息，
-- 应用层可彻底删除第二次查询。
--
-- 与 009 相同的安全性：触发器与 public.users 写入同事务，无滞后窗口；
-- settings 页 / admin 后台改昵称都会即时同步，应用层无需双写。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_user_claims()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'tier', NEW.tier,
         'role', NEW.role,
         'display_name', NEW.display_name
       )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP TRIGGER IF EXISTS on_user_tier_role_change ON public.users;
CREATE TRIGGER on_user_tier_role_change
  AFTER INSERT OR UPDATE OF tier, role, display_name ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_claims();

-- 回填所有现存用户（UPDATE OF 列出的列出现在 SET 里即触发，不要求值变化）
UPDATE public.users SET display_name = display_name;
```

- [ ] **Step 2: 在 Supabase 生产项目应用迁移**

用 Supabase MCP 的 `apply_migration`（name: `sync_display_name_to_claims`，query 为上面全文）。

- [ ] **Step 3: 验证回填生效**

用 Supabase MCP 的 `execute_sql` 运行：

```sql
SELECT count(*) AS missing
FROM auth.users a JOIN public.users p ON p.id = a.id
WHERE a.raw_app_meta_data->>'display_name' IS DISTINCT FROM p.display_name;
```

Expected: `missing = 0`。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/039_sync_display_name_to_claims.sql
git commit -m "perf(db): 039 sync display_name into JWT claims, kill second auth round trip"
```

---

### Task 2: `getServerAuth()`——cache() 去重 + 从 claims 读 display_name

**Files:**
- Modify: `src/lib/supabase/get-auth.ts`

**Interfaces:**
- Consumes: Task 1 的 `app_metadata.display_name`。
- Produces: `getServerAuth(): Promise<ServerAuthState>` 签名与返回类型**完全不变**（调用方 `[locale]` 布局、`page.tsx`、admin 等零改动）；新增行为：同一请求内多次调用只执行一次；claims 齐全时全程只有 1 次网络往返。

- [ ] **Step 1: 改写 get-auth.ts**

用以下内容整体替换 `src/lib/supabase/get-auth.ts`（保留既有 interface 与 EMPTY_AUTH，函数体改为）：

```ts
import { cache } from "react";
import { createClient } from "./server";
import { createServiceRoleClient } from "./middleware";

export interface ServerAuthState {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  tier: "free" | "pro" | null;
  role: "user" | "admin" | null;
  loading: boolean;
}

const EMPTY_AUTH: ServerAuthState = {
  userId: null,
  email: null,
  displayName: null,
  tier: null,
  role: null,
  loading: false,
};

/**
 * Fetch the current user's auth state on the server.
 *
 * tier/role/display_name are all kept in sync onto auth.users.app_metadata
 * by a DB trigger (migrations 009 + 039), so getUser() alone carries the
 * complete, real-time auth state in a single round trip. If those
 * migrations haven't been applied, app_metadata simply lacks the fields
 * and we transparently fall back to the service_role table read.
 *
 * Wrapped in React cache(): layout + page calling this in the same request
 * only pay for one execution.
 */
export const getServerAuth = cache(async (): Promise<ServerAuthState> => {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return EMPTY_AUTH;

    let tier = user.app_metadata?.tier as "free" | "pro" | undefined;
    let role = user.app_metadata?.role as "user" | "admin" | undefined;
    let displayName =
      (user.app_metadata?.display_name as string | null | undefined) ?? null;

    if (tier === undefined || role === undefined) {
      const serviceClient = createServiceRoleClient();
      const { data: profile } = await serviceClient
        .from("users")
        .select("tier, role, display_name")
        .eq("id", user.id)
        .single();

      tier = (profile?.tier as "free" | "pro") ?? "free";
      role = (profile?.role as "user" | "admin") ?? "user";
      displayName = profile?.display_name ?? null;
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      displayName,
      tier,
      role,
      loading: false,
    };
  } catch {
    return EMPTY_AUTH;
  }
});
```

要点：删除了原来 58-67 行"claims 命中仍单查 display_name"的整个 else 分支——那正是要消灭的第二次往返。

- [ ] **Step 2: 全量类型检查与既有测试**

Run: `npx tsc --noEmit && npm run test`
Expected: 均通过（该文件无直接单测；纯网络+框架 API 包装，按仓库惯例不为其编造 mock 单测）。

- [ ] **Step 3: 行为验证（开发服务器）**

启动 dev server，用已登录账号访问 `/zh-CN/dashboard`：导航栏右上角显示的昵称应与 settings 里设置的一致（证明 claims 路径生效，而非邮箱前缀回退）。在 settings 改昵称并保存，导航栏应随 `auth.refresh()` 更新为新昵称（证明触发器同步生效）。

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/get-auth.ts
git commit -m "perf(auth): getServerAuth reads display_name from claims + request-level cache()"
```

---

### Task 3: AuthProvider——claims 读 display_name + 跨组导航防闪烁缓存

**Files:**
- Modify: `src/components/auth/AuthProvider.tsx`

**Interfaces:**
- Consumes: Task 1 的 `app_metadata.display_name`。
- Produces: `AuthProvider`、`useAuth()`、`useAuthFlag()`、`AuthState` 对外接口完全不变。新增行为：① 客户端 `fetchAuth` 在 claims 齐全时只需 1 次 `getUser()`；② 组件重挂载（Task 5 的跨路由组导航）时用模块级 `lastKnownAuth` 立即恢复上次状态，不闪"未登录"。

- [ ] **Step 1: 修改 AuthProvider.tsx**

三处改动：

(a) 文件顶部（`AuthContext` 定义之后、`AuthProvider` 之前）加模块级缓存：

```ts
// Survives AuthProvider remounts (route-group crossings re-mount the group
// layout). Hard loads start with null — matching the server-rendered HTML,
// so hydration is never affected; only client-side remounts read it.
let lastKnownAuth: AuthState | null = null;
```

(b) `AuthProvider` 内部：state 初始化改为读缓存，并让所有状态写入都经过同一个记录缓存的 setter：

```ts
const [auth, setAuthState] = useState<AuthState>(
  () =>
    initialAuth ??
    lastKnownAuth ?? {
      userId: null,
      email: null,
      displayName: null,
      tier: null,
      role: null,
      loading: true,
    }
);

const setAuth = useCallback((next: AuthState) => {
  lastKnownAuth = next;
  setAuthState(next);
}, []);
```

原文件里所有 `setAuth({...})` 调用点（fetchAuth 的两处、SIGNED_OUT 分支一处）保持调用名 `setAuth` 不变，自动经过新 setter。另外在 `AuthProvider` 函数体开头补一行，让服务端种子也进缓存：

```ts
if (initialAuth) lastKnownAuth = initialAuth;
```

（模块变量赋值不是 setState，渲染期执行安全。）

(c) `fetchAuth` 的 claims 命中分支：删除单查 display_name 的 else 分支，与 Task 2 同构：

```ts
let tier = user.app_metadata?.tier as "free" | "pro" | undefined;
let role = user.app_metadata?.role as "user" | "admin" | undefined;
let displayName =
  (user.app_metadata?.display_name as string | null | undefined) ?? null;

if (tier === undefined || role === undefined) {
  const { data: profile } = await supabase
    .from("users")
    .select("tier, role, display_name")
    .eq("id", user.id)
    .single();

  tier = (profile?.tier as "free" | "pro") ?? "free";
  role = (profile?.role as "user" | "admin") ?? "user";
  displayName = profile?.display_name ?? null;
}
```

(d) mount effect 里 `hasServerAuth` 的判定改为把模块缓存视同服务端种子（有种子就不必再 fetch，也不必吃 INITIAL_SESSION 那次重复拉取）：

```ts
const hasServerAuth = Boolean((initialAuth ?? lastKnownAuth)?.userId);
```

- [ ] **Step 2: 类型检查与既有测试**

Run: `npx tsc --noEmit && npm run test`
Expected: 通过。

- [ ] **Step 3: 行为验证**

dev server 下：已登录硬刷新 `/zh-CN/dashboard` → 导航栏无"未登录闪烁"；登出 → 导航栏立即切到登录/注册按钮（SIGNED_OUT 路径经过新 setter，`lastKnownAuth` 同步清空，再进任何页面不会闪已登录）。

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/AuthProvider.tsx
git commit -m "perf(auth): client auth reads claims in one round trip; cache across remounts"
```

---

### Task 4: 布局拆分——LocaleProviders / AppChrome 两个组件

**Files:**
- Create: `src/app/[locale]/LocaleProviders.tsx`
- Create: `src/app/[locale]/AppChrome.tsx`
- Delete: `src/app/[locale]/ClientLocaleLayout.tsx`
- Modify: `src/app/[locale]/layout.tsx`

**Interfaces:**
- Produces:
  - `LocaleProviders({ children, locale, messages }: { children: ReactNode; locale: string; messages: any })` —— 客户端组件：NextIntlClientProvider + QueryProvider + `document.documentElement.lang` 同步。**不含** AuthProvider/ToastProvider/页面骨架。
  - `AppChrome({ children, locale, initialAuth, siteSettings }: { children: ReactNode; locale: string; initialAuth?: AuthState; siteSettings: SiteSettings })` —— 客户端组件：AuthProvider + ToastProvider + Navbar/MobileShell/Footer + 5 个 headless watcher，即原 ClientLocaleLayout 除 Provider 外的全部内容。
- Consumes: `AuthState`（`@/components/auth/AuthProvider`）、`SiteSettings`（`@/lib/site-settings`）。
- Task 5 的两个组布局会分别以不同 `initialAuth` 组合这两个组件。

> ToastProvider 放 AppChrome（而非 LocaleProviders）：toast 是 UI 层，与 Navbar 同层级；跨组导航时丢失未读 toast 可接受（toast 生命周期本就以秒计）。QueryProvider 必须在 LocaleProviders（见"背景知识"第 4 条）。

- [ ] **Step 1: 写 LocaleProviders.tsx**

```tsx
"use client";

import { NextIntlClientProvider } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { QueryProvider } from "@/components/layout/QueryProvider";

export function LocaleProviders({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
}) {
  // The root layout (src/app/layout.tsx) can't know the locale — it's above
  // the [locale] segment and reading it there would force the whole app into
  // dynamic rendering. Setting it here also keeps it correct when the
  // language switcher does a client-side navigation between locales, which
  // doesn't re-run the root layout.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <QueryProvider>{children}</QueryProvider>
    </NextIntlClientProvider>
  );
}
```

- [ ] **Step 2: 写 AppChrome.tsx**

原 `ClientLocaleLayout.tsx` 的其余部分原样搬入（imports 跟着搬）：

```tsx
"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider, type AuthState } from "@/components/auth/AuthProvider";
import { ZoomGuard } from "@/components/pwa/ZoomGuard";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { UpdateBanner } from "@/components/pwa/UpdateBanner";
import { Navbar } from "@/components/layout/Navbar";
import { MobileShell } from "@/components/layout/MobileShell";
import { Footer } from "@/components/layout/Footer";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ToastProvider } from "@/components/ui/Toast";
import { PriceAlertWatcher } from "@/components/alerts/PriceAlertWatcher";
import { PaperTpSlWatcher } from "@/components/alerts/PaperTpSlWatcher";
import { PreferencesSync } from "@/components/preferences/PreferencesSync";
import type { SiteSettings } from "@/lib/site-settings";

export function AppChrome({
  children,
  locale,
  initialAuth,
  siteSettings,
}: {
  children: ReactNode;
  locale: string;
  initialAuth?: AuthState;
  siteSettings: SiteSettings;
}) {
  // 交易终端是工具页，不是营销页——底部这条"品牌+介绍+社群链接"的 footer 在这里
  // 纯粹是滚动过图表/持仓面板之后的死区，只在非 /trade 页面显示
  const pathname = usePathname();
  const isTradePage = pathname === `/${locale}/trade` || pathname?.startsWith(`/${locale}/trade/`);

  return (
    <AuthProvider initialAuth={initialAuth}>
      <ToastProvider>
        <ZoomGuard />
        <ServiceWorkerRegistrar />
        <UpdateBanner />
        <div className="flex min-h-dvh flex-col">
          <Navbar />
          <MobileShell>
            {/* pb-tabbar 给底部导航条 + 中央凸起 + 系统安全区统一让位 */}
            <main className="flex-1 pb-tabbar lg:pb-0">{children}</main>
            {/* 手机上 footer 沉在 tab bar 下面没人看得到，只在桌面渲染 */}
            {!isTradePage && (
              <div className="hidden lg:block">
                <Footer settings={siteSettings} />
              </div>
            )}
          </MobileShell>
        </div>
        <OnboardingModal />
        <InstallPrompt />
        <PriceAlertWatcher />
        <PaperTpSlWatcher />
        <PreferencesSync />
      </ToastProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: 改 `[locale]/layout.tsx` 为纯 Provider 布局**

`generateMetadata` 原样保留（它只用 getTranslations(显式 locale) + getSiteSettings，静态安全）。函数体改为：

```tsx
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const allMessages = (await import(`@/i18n/messages/${locale}.json`)).default;

  // The `admin` namespace is a third of the whole message bundle and is only
  // read under /admin, which sits outside this layout and loads its own copy
  // via AdminLocaleProvider. Dropping it here keeps ~7KB of JSON out of the
  // serialized RSC payload of every user-facing page.
  const { admin: _admin, ...messages } = allMessages;

  return (
    <LocaleProviders locale={locale} messages={messages}>
      {children}
    </LocaleProviders>
  );
}
```

imports 相应更新：删掉 `getServerAuth`、`ClientLocaleLayout`；`getSiteSettings` 仅 `generateMetadata` 还在用，保留 import。**此布局从此不再接触 cookie。**

- [ ] **Step 4: 删除 ClientLocaleLayout.tsx**

```bash
git rm src/app/[locale]/ClientLocaleLayout.tsx
```

（此刻编译会短暂断掉——页面还没有组布局提供 AppChrome，Task 5 立即接上。Task 4+5 作为一个整体在 Task 5 末尾一起验证与提交，中间不单独 commit。）

---

### Task 5: 路由组落位 +（app）/（static）布局 + 静态验证

**Files:**
- Create: `src/app/[locale]/(app)/layout.tsx`
- Create: `src/app/[locale]/(static)/layout.tsx`
- Move: `[locale]` 下除 `articles`、`learn`、`videos`、`manifest.webmanifest`、`layout.tsx`、`LocaleProviders.tsx`、`AppChrome.tsx` 外的全部页面文件 → `(app)/`
- Move: `articles/`、`learn/`、`videos/` → `(static)/`

**Interfaces:**
- Consumes: Task 4 的 `AppChrome`、Task 2 的 `getServerAuth`、`getSiteSettings`。
- Produces: URL 全部不变；`/{locale}/articles`、`/{locale}/videos`、`/{locale}/learn` 变为 ISR 静态路由。

- [ ] **Step 1: 移动目录（git mv 保留历史）**

```bash
cd "C:\Users\Rex\Downloads\Chart-IX\src\app\[locale]"
mkdir "(app)" "(static)"
git mv community dashboard forgot-password login more news offline orders register screener settings trade upgrade "(app)/"
git mv page.tsx HomeClient.tsx HotCoinsRail.tsx "(app)/"
git mv articles learn videos "(static)/"
```

（`manifest.webmanifest/`、`layout.tsx`、`LocaleProviders.tsx`、`AppChrome.tsx` 留在 `[locale]` 直下。`HomeClient.tsx`/`HotCoinsRail.tsx` 是首页 `page.tsx` 的相对导入兄弟文件，必须同移。）

- [ ] **Step 2: 写 `(app)/layout.tsx`**

```tsx
import { getServerAuth } from "@/lib/supabase/get-auth";
import { getSiteSettings } from "@/lib/site-settings";
import { AppChrome } from "../AppChrome";

// Everything under (app) is per-user — the auth read below opts this whole
// group into dynamic rendering, which is what these pages need anyway.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [initialAuth, siteSettings] = await Promise.all([
    getServerAuth(),
    getSiteSettings(locale),
  ]);

  return (
    <AppChrome locale={locale} initialAuth={initialAuth} siteSettings={siteSettings}>
      {children}
    </AppChrome>
  );
}
```

- [ ] **Step 3: 写 `(static)/layout.tsx`**

```tsx
import { getSiteSettings } from "@/lib/site-settings";
import { AppChrome } from "../AppChrome";

// This group is the static/ISR island: no cookies, no per-user reads.
// Auth for the navbar hydrates client-side via AuthProvider's own fetch
// (instant when coming from an (app) page thanks to its module-level cache).
// Do NOT import getServerAuth or anything that touches cookies()/headers()
// here — that would silently demote articles/videos/learn back to dynamic
// rendering and defeat their `revalidate = 300`.
export default async function StaticLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const siteSettings = await getSiteSettings(locale);

  return (
    <AppChrome locale={locale} siteSettings={siteSettings}>
      {children}
    </AppChrome>
  );
}
```

- [ ] **Step 4: 给三个静态列表页补 `generateStaticParams`**

`[locale]` 是动态段，没有 `generateStaticParams` 时 Next 无法在构建期预渲染这些路由。在 `(static)/articles/page.tsx`、`(static)/videos/page.tsx`、`(static)/learn/page.tsx` 三个文件各加（放在 `export const revalidate = 300;` 旁边）：

```ts
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
```

（detail 子页 `articles/[slug]` 等不加——它们各自读 cookie/走客户端，本来就是动态，父布局静态化不影响它们。）

- [ ] **Step 5: 修复移动导致的相对导入**

Run: `npx tsc --noEmit`
被移动文件内的相对导入（如 `./HomeClient`、`./ArticlesClient`）随目录整体移动不受影响；`@/` 别名导入不受影响。tsc 若报错，逐个把报错文件里指向 `[locale]` 层的相对路径加一层 `../`（例如 `(app)/page.tsx` 里若有 `../ClientLocaleLayout` 之类引用则按新结构改）。
Expected: 0 错误。

- [ ] **Step 6: 构建并验证静态化**

Run: `npm run build`
Expected：构建成功；路由表中 `/[locale]/articles`、`/[locale]/videos`、`/[locale]/learn` 标记为 **●（SSG/ISR，revalidate 5m）**，且为三个 locale 各生成一份；`/[locale]/dashboard`、`/[locale]/trade` 等保持 **ƒ（Dynamic）**。
若三个页面仍显示 ƒ：说明 (static) 子树里仍有代码触碰动态 API——用构建输出的错误堆栈（Next 会指出哪个文件调用了 cookies/headers）定位，常见嫌疑是组内某组件 import 了 `@/lib/supabase/server`。

- [ ] **Step 7: 运行时验证**

```bash
npm run start
```

第二次请求 `http://localhost:3000/zh-CN/articles` 的响应头应带 `x-nextjs-cache: HIT`（第一次是 MISS/STALE，属正常）。再用浏览器验证：
1. 未登录访问 /zh-CN/articles → 页面即时渲染，导航栏短暂中性态后显示登录/注册按钮；
2. 已登录从 /zh-CN/dashboard 点导航去 /zh-CN/articles → 导航栏登录态**不闪**（模块缓存生效）；再点回 dashboard → 正常；
3. 已登录硬刷新 /zh-CN/articles → 导航栏短暂中性态后显示昵称（客户端水合，符合 spec 批准的取舍）；
4. /zh-CN（首页）未登录显示营销页、已登录跳 dashboard；
5. /zh-CN/trade 页 footer 不显示、其他页显示（isTradePage 逻辑随 AppChrome 迁移后仍正确）；
6. 语言切换器在 /articles 页切到 en-US → URL 与文案正确。

- [ ] **Step 8: 既有测试回归**

Run: `npm run test`
Expected: 全部通过。

- [ ] **Step 9: Commit（Task 4+5 一并提交）**

```bash
git add -A src/app
git commit -m "perf(layout): split auth into (app) route group, restore ISR for content pages"
```

---

## 阶段验收（对应 spec 验收标准 5、部分 1）

- [ ] `npm run build` 路由表：articles/videos/learn 为 ISR，其余用户页 Dynamic；
- [ ] 生产部署后 `/zh-CN/articles` 二次访问响应头 `x-nextjs-cache: HIT`（或 Vercel 上 `x-vercel-cache: HIT`）；
- [ ] 已登录账号全站点击走查（dashboard/trade/articles/videos/learn/settings/community/screener/orders/upgrade/more）无报错、无登录态闪烁异常；
- [ ] Supabase 侧确认：单次页面请求只产生 1 次 `auth.getUser`（可从 Supabase 日志 Auth 请求量趋势验证，部署前后对比应明显下降）。

完成后进入阶段 2 计划（导航即时反馈——loading.tsx 补齐 + keepPreviousData 全局启用），阶段 2 计划文档基于本阶段落地后的实际目录结构编写。
