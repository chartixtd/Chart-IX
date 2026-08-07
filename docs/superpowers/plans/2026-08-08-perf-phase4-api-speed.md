# 感知性能优化 · 阶段 4：API 提速 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 鉴权 BingX 路由从三跳串行降到约一跳；任何上游抖动快速失败；缓存过期不再由用户请求承担重算；全局 headless 组件不与首屏抢请求；admin 中间件减半查询。

**Architecture:** ① 项目已启用 ES256 非对称 JWT（JWKS 端点已验证有密钥），`supabase.auth.getClaims()` 在 supabase-js 2.110 下本地验签、进程内缓存 JWKS——只读路由零网络认证；② 解密后的 API 密钥按 userId 做 60 秒进程内 TTL 缓存，密钥变更路由主动失效；③ `ttl-cache` 升级 stale-while-revalidate；④ watcher 按需激活/localStorage 记忆；⑤ 中间件 admin 角色短 TTL 缓存。

**Tech Stack:** supabase-js 2.110（getClaims/JWKS）、Next.js 15（route handlers、middleware、experimental.optimizePackageImports）、vitest。

**Spec:** docs/superpowers/specs/2026-08-07-perceived-performance-design.md 第 4 节。阶段 1-3 已合并。

## Global Constraints

- **安全边界不变**：写操作路由（下单/撤单/改单/改杠杆/TP-SL/密钥管理/社区发帖等一切 POST/PUT/DELETE 语义）保留完整 `getUser()` 网络校验；只有只读 GET 轮询路由改本地 JWT。
- 已知取舍（spec 批准）：本地 JWT 下被封禁用户的既有 token 在剩余有效期（≤1h）内仍可通过只读轮询；密钥缓存 60s 意味着换密钥后最多 60s 生效（同实例内有主动失效，跨实例靠 TTL）。
- admin 角色缓存 60s：撤销 admin 权限/禁用账号最多延迟 60s 生效（记录进文档）。
- 所有功能与交互逻辑不变；不引入新依赖。
- 每 Task 独立 commit（末尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）；每 Task `npx tsc --noEmit` + `npm run test` 全绿；新纯逻辑带 vitest 测试。

## 背景知识（实施者必读）

1. 现状三跳（例：`src/app/api/bingx/futures/positions/route.ts:16-32`）：`createClient()` → `auth.getUser()`（网络到 Supabase Auth）→ 查 `api_keys` 表（DB）→ `decrypt()` → 调 BingX。GET 被 5~30 秒轮询反复支付全程。
2. `getClaims()`：supabase-js 2.110 已内置；项目 JWKS 端点（`https://ezvswjvyoykdquepghib.supabase.co/auth/v1/.well-known/jwks.json`）返回 ES256 公钥 → 本地验签生效，JWKS 进程内缓存。返回 `{ data: { claims }, error }`，`claims.sub` 即 userId。token 无效/过期时 error 非空或 claims 为空。
3. `src/lib/ttl-cache.ts`：现为"过期即等待重算"（仅失败时回退旧值）；`screener-server.ts` 冷缓存重算 = 用户请求里等 400~800 次上游调用。
4. `src/lib/bingx/client.ts:24` 公开行情 fetch 无超时（对比 `signed-request.ts:98` 有 10s）。
5. `src/middleware.ts:14-62`：每个 /admin 请求 1 次 `getUser()` + 1 次 role 查询。
6. `src/components/onboarding/OnboardingModal.tsx`：每次 AppChrome 挂载（含跨路由组导航）都查一次 `users.onboarding_completed`（阶段 1 加了会话级去重，但硬加载/新会话仍每次查）。`finish()` 是完成入口。
7. `src/components/alerts/PaperTpSlWatcher.tsx`：所有页面都调 `usePaperAccount(!!userId)` 轮询模拟盘账户；其触发本就依赖交易页才有的行情 tick（组件注释自述），页面门控是行为保持的。
8. 阶段 2 纪律：交易/用户键控查询 `placeholderData: undefined`——本阶段新增的任何 useQuery 同样遵守。

## File Structure（改动全景）

```
src/lib/supabase/api-auth.ts                 [新建] getApiUserId("readonly"|"verified")
src/lib/trading/api-key-cache.ts             [新建] 60s 密钥缓存 + invalidate + 测试
src/lib/trading/api-key-cache.test.ts        [新建]
src/app/api/bingx/**（7 个只读 GET）          [修改] 接入 readonly 认证 + 密钥缓存
src/app/api/bingx/**（写路由）                [修改] 仅接入密钥缓存（认证不动）
src/app/api/user/api-keys/route.ts           [修改] 密钥变更处 invalidate
src/app/api/user/api-keys/verify/route.ts    [修改] 同上
src/lib/ttl-cache.ts + ttl-cache.test.ts     [修改] stale-while-revalidate
src/app/api/screener/route.ts                [修改] Cache-Control 头
src/lib/bingx/client.ts                      [修改] AbortSignal.timeout(8000)
src/components/onboarding/OnboardingModal.tsx [修改] localStorage 永久记忆
src/components/alerts/PaperTpSlWatcher.tsx   [修改] 仅交易页激活
src/app/[locale]/AppChrome.tsx               [修改] watcher 空闲挂载
src/middleware.ts                            [修改] admin 角色 60s 缓存
next.config.mjs                              [修改] optimizePackageImports
```

---

### Task 1: `getApiUserId` 认证助手 + 7 个只读路由接入

**Files:**
- Create: `src/lib/supabase/api-auth.ts`
- Modify: `src/app/api/bingx/futures/positions/route.ts`（仅 GET）、`src/app/api/bingx/futures/open-orders/route.ts`（仅 GET）、`src/app/api/bingx/futures/history-orders/route.ts`、`src/app/api/bingx/futures/fill-history/route.ts`、`src/app/api/bingx/account/balance/route.ts`、`src/app/api/bingx/trade/open-orders/route.ts`（仅 GET）、`src/app/api/bingx/trade/my-trades/route.ts`

**Interfaces:**
- Produces: `getApiUserId(mode: "readonly" | "verified"): Promise<string | null>`——null 表示未认证，调用方返回 401。readonly 走本地 JWT 验签（零网络）；verified 走 `getUser()`（网络实时校验）。

- [ ] **Step 1: 写 api-auth.ts**

```ts
import { createClient } from "./server";

/**
 * Route-handler auth in two strengths.
 *
 * "readonly"  — verifies the JWT locally against the project's JWKS
 *   (ES256 asymmetric signing is enabled; supabase-js caches the JWKS
 *   in-process). Zero network round trips. Use ONLY for read-only GET
 *   polling routes: a banned user's existing token stays valid for its
 *   remaining lifetime (≤1h) — approved trade-off, spec §4.
 *
 * "verified"  — full network check against Supabase Auth (revocation-aware).
 *   Required for every route with write semantics.
 */
export async function getApiUserId(mode: "readonly" | "verified"): Promise<string | null> {
  const supabase = await createClient();
  if (mode === "readonly") {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub as string;
  }
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
```

- [ ] **Step 2: 七个只读 GET 接入**

每个目标 GET handler 的开头模式统一从：

```ts
const supabase = await createClient();
const { data: authData } = await supabase.auth.getUser();
if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
```

改为：

```ts
const userId = await getApiUserId("readonly");
if (!userId) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
```

后续所有 `authData.user.id` 引用改 `userId`。**注意**：`api_keys` 查询仍需要 supabase 客户端——本 Task 里暂时保留 `const supabase = await createClient();`（cookie 解析是本地操作，无网络成本），Task 2 会把整段密钥查询换成缓存调用。同文件的 POST handler **一律不动**。`futures/positions/route.ts` 的 GET 无 tier 检查可直接换；若某个目标文件的 GET 里有 tier/pro 检查（逐个确认），tier 从 `getClaims()` 的 `data.claims.app_metadata?.tier` 读（迁移 009 已把 tier 同步进 claims），不再查表。

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/lib/supabase/api-auth.ts src/app/api/bingx
git commit -m "perf(api): local JWT verification for read-only BingX polling routes"
```

---

### Task 2: 解密密钥 60 秒缓存 + 全 BingX 路由接入 + 主动失效

**Files:**
- Create: `src/lib/trading/api-key-cache.ts`、`src/lib/trading/api-key-cache.test.ts`
- Modify: 全部引用 `api_keys` 表 + `decrypt` 的 `src/app/api/bingx/**` 路由（grep `api_key_encrypted` 定位，GET/POST 都接入）
- Modify: `src/app/api/user/api-keys/route.ts`、`src/app/api/user/api-keys/verify/route.ts`（变更处 invalidate）

**Interfaces:**
- Produces:
  - `getDecryptedApiKeys(userId: string): Promise<{ apiKey: string; secret: string } | null>`——null 表示无有效密钥（调用方返回既有的 400 文案）。
  - `invalidateApiKeys(userId: string): void`
  - 测试注入点：`__setDepsForTest(deps)`（fetcher 与时钟）。

- [ ] **Step 1: 写失败测试**

`api-key-cache.test.ts` 覆盖：①首次调用走 fetcher 并缓存；②60s 内第二次调用不再走 fetcher；③TTL 过期后重新走 fetcher；④invalidate 后立即重新走 fetcher；⑤fetcher 返回 null（无密钥）不缓存负结果（下次仍会查——密钥刚添加的用户不用等 60s）；⑥不同 userId 互不影响。用注入时钟与 mock fetcher，不碰真实 DB/crypto。

- [ ] **Step 2: 实现**

```ts
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { decrypt } from "@/lib/crypto";

interface CachedKeys { apiKey: string; secret: string; at: number }

const TTL_MS = 60_000;
const cache = new Map<string, CachedKeys>();

type Fetcher = (userId: string) => Promise<{ apiKey: string; secret: string } | null>;

async function defaultFetcher(userId: string) {
  // service-role：与原路由内查询同一张表同一过滤条件；用 service 客户端
  // 使查询不依赖调用方的 cookie 会话（readonly 路由已本地验签拿到 userId）
  const { data, error } = await createServiceRoleClient()
    .from("api_keys").select("api_key_encrypted, secret_encrypted")
    .eq("user_id", userId).eq("is_valid", true)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
    .limit(1);
  if (error || !data?.length) return null;
  return { apiKey: decrypt(data[0].api_key_encrypted), secret: decrypt(data[0].secret_encrypted) };
}

let deps: { fetcher: Fetcher; now: () => number } = { fetcher: defaultFetcher, now: Date.now };

/** 60s per-user cache of decrypted BingX credentials. Poll routes hit this
 * every 5-30s — without it every poll pays a DB read + AES decrypt. Key
 * rotation: the api-keys mutation routes call invalidateApiKeys() (instant
 * within this instance); other instances converge within TTL_MS. */
export async function getDecryptedApiKeys(userId: string) {
  const hit = cache.get(userId);
  if (hit && deps.now() - hit.at < TTL_MS) return { apiKey: hit.apiKey, secret: hit.secret };
  const fresh = await deps.fetcher(userId);
  if (fresh) cache.set(userId, { ...fresh, at: deps.now() });
  else cache.delete(userId);
  return fresh;
}

export function invalidateApiKeys(userId: string): void {
  cache.delete(userId);
}

export function __setDepsForTest(next: Partial<typeof deps>): void {
  deps = { ...deps, ...next };
  cache.clear();
}
```

- [ ] **Step 3: 路由接入**

grep `api_key_encrypted` 定位全部 BingX 路由，把"查 api_keys + 两次 decrypt"整段（含 keyError 分支）替换为：

```ts
const keys = await getDecryptedApiKeys(userId);
if (!keys) {
  return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
}
```

后续 `apiKey`/`secret` 改 `keys.apiKey`/`keys.secret`。POST 路由里 userId 来自既有的 `authData.user.id`（认证方式不动）。只读 GET 若此后不再需要 cookie 客户端，删掉多余的 `createClient()` 行。

- [ ] **Step 4: 密钥变更失效**

`user/api-keys/route.ts` 与 `verify/route.ts`：在新增/删除/标记 valid 等每个成功写入分支后调 `invalidateApiKeys(userId)`（import 自 api-key-cache）。

- [ ] **Step 5: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿（含新测试）。

```bash
git add src/lib/trading/api-key-cache.ts src/lib/trading/api-key-cache.test.ts src/app/api/bingx src/app/api/user/api-keys
git commit -m "perf(api): 60s decrypted-key cache — polling routes stop re-reading and re-decrypting"
```

---

### Task 3: 行情超时 + ttl-cache SWR + screener 缓存头

**Files:**
- Modify: `src/lib/bingx/client.ts`、`src/lib/ttl-cache.ts`、`src/lib/ttl-cache.test.ts`、`src/app/api/screener/route.ts`

- [ ] **Step 1: client.ts 加超时**

`publicRequest` 的 fetch options 加 `signal: AbortSignal.timeout(8_000),`（与 signed-request 10s、paper order 8s 对齐；轮询路由快速失败交给 React Query retry）。

- [ ] **Step 2: ttl-cache SWR（先补失败测试再实现）**

新测试：①过期且有旧值时 `get()` 立即返回旧值且触发后台 compute；②后台 compute 完成后下一次 `get()` 拿到新值；③后台 compute 失败保留旧值且不抛；④并发过期 `get()` 只触发一次后台 compute。实现（保持接口不变）：

```ts
export function createTtlCache<T>({ ttlMs, compute, now = Date.now }: TtlCacheOptions<T>) {
  let cached: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  function kick(): Promise<T> {
    if (!inflight) {
      inflight = compute().then(
        (data) => { cached = { at: now(), data }; inflight = null; return data; },
        (err) => {
          inflight = null;
          if (cached) return cached.data; // stale-while-error
          throw err;
        }
      );
    }
    return inflight;
  }

  return {
    async get(): Promise<T> {
      if (cached && now() - cached.at < ttlMs) return cached.data;
      if (cached) {
        // stale-while-revalidate：过期先还旧值，重算在后台进行，
        // 消灭"每小时一个用户在自己的请求里等全量重算"
        void kick().catch(() => {});
        return cached.data;
      }
      return kick(); // 冷缓存只能等
    },
    peek: () => cached,
  };
}
```

既有 6 个测试语义核对：若有测试断言"过期后 get() 返回新值"，改为先收旧值、`await` 冲刷微任务后再断言新值（测试意图不变，时序更新）。

- [ ] **Step 3: screener 响应加缓存头**

`screener/route.ts` 的成功 NextResponse 加：

```ts
{ headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } }
```

（数据本身 1 小时 TTL，CDN 5 分钟新鲜 + 1 小时 SWR——同区域用户合并到 CDN 一份。）

- [ ] **Step 4: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/lib/bingx/client.ts src/lib/ttl-cache.ts src/lib/ttl-cache.test.ts src/app/api/screener/route.ts
git commit -m "perf(api): market-proxy timeout, ttl-cache stale-while-revalidate, screener CDN headers"
```

---

### Task 4: watcher 降载

**Files:**
- Modify: `src/components/onboarding/OnboardingModal.tsx`、`src/components/alerts/PaperTpSlWatcher.tsx`、`src/app/[locale]/AppChrome.tsx`

- [ ] **Step 1: OnboardingModal localStorage 记忆**

已完成引导的用户不再每次会话查库：查询 effect 前先读 `localStorage.getItem("chartix:onboarding-done:" + userId) === "1"`，命中则直接不查不显示；`finish()`（以及查询返回 `onboarding_completed === true` 时）写入该 key。读写包 try/catch（隐私模式可能抛）。SSR 纪律：localStorage 只在 effect/事件里碰。

- [ ] **Step 2: PaperTpSlWatcher 页面门控**

```ts
const pathname = usePathname();
// 触发本就依赖交易页才有的行情 tick（见文件头注释）——非交易页轮询纯属浪费
const onTradePage = !!pathname && /\/trade(\/|$)/.test(pathname);
const { data } = usePaperAccount(!!userId && onTradePage);
```

主 effect 的早退条件同步加 `|| !onTradePage`。

- [ ] **Step 3: AppChrome 空闲挂载**

AppChrome 里加一个内联小组件：

```tsx
function WhenIdle({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as typeof window & { requestIdleCallback?: (cb: () => void) => number };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setReady(true));
      return () => (window as typeof window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setReady(true), 2_000); // Safari 无 rIC
    return () => clearTimeout(t);
  }, []);
  return ready ? <>{children}</> : null;
}
```

用它包住 `<InstallPrompt />`、`<PriceAlertWatcher />`、`<PreferencesSync />`（三个都不影响首屏内容；PriceAlertWatcher/PreferencesSync 的会话级去重守卫与延迟挂载正交，不冲突）。`OnboardingModal`（新用户要及时看到）与 `PaperTpSlWatcher`（交易页需即时）不包。

- [ ] **Step 4: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿。

```bash
git add src/components/onboarding/OnboardingModal.tsx src/components/alerts/PaperTpSlWatcher.tsx "src/app/[locale]/AppChrome.tsx"
git commit -m "perf(chrome): idle-mount watchers, page-scope paper TP/SL, localStorage onboarding memo"
```

---

### Task 5: admin 中间件角色缓存

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: 加 60s 角色缓存**

模块级：

```ts
// 60s per-user cache of the admin-gate lookup. Trade-off (documented in the
// perf spec §4): revoking admin / disabling an account can take up to 60s to
// bite in an already-warm edge instance. getUser() itself stays uncached.
const roleCache = new Map<string, { role: string | null; disabled: boolean; at: number }>();
const ROLE_TTL_MS = 60_000;

async function getAdminProfile(userId: string) {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit;
  const { data } = await createServiceRoleClient()
    .from("users").select("role, is_disabled").eq("id", userId).single();
  const entry = { role: data?.role ?? null, disabled: Boolean(data?.is_disabled), at: Date.now() };
  roleCache.set(userId, entry);
  return entry;
}
```

两处查询点（login 分支 :26-30 与主分支 :45-49）改用 `getAdminProfile(user.id)`，判定逻辑不变（`role !== "admin"` 重定向、`disabled` 登出）。

- [ ] **Step 2: 验证 + Commit**

Run: `npx tsc --noEmit && npm run test` → 全绿；`npm run build` 无 middleware 编译告警。

```bash
git add src/middleware.ts
git commit -m "perf(admin): cache role lookup in middleware — halve per-request Supabase queries"
```

---

### Task 6: optimizePackageImports + 阶段验证

**Files:**
- Modify: `next.config.mjs`

- [ ] **Step 1: 构建配置**

`nextConfig` 加：

```js
experimental: {
  optimizePackageImports: ["next-intl", "@tanstack/react-query", "react-resizable-panels", "zustand"],
},
```

- [ ] **Step 2: 全量验证**

Run: `npm run build` → 编译成功；三个静态页仍 ●；记录 First Load JS 前后对比（dashboard/trade/articles 各一行）。
Run: `npm run test` → 全绿。

- [ ] **Step 3: Commit**

```bash
git add next.config.mjs
git commit -m "perf(build): optimizePackageImports for the four barrel-heavy deps"
```

- [ ] **Step 4: 留给用户验收的清单（写进报告）**

① 合约页持仓/余额刷新明显变快（服务端只剩 BingX 一跳，可在 Vercel 日志看路由耗时下降）；② screener 冷缓存时段打开不再有几十秒等待（旧数据立即返回）；③ 换 BingX 密钥后 60s 内生效；④ admin 后台操作照常，撤权最多延迟 60s；⑤ 已完成引导的账号硬刷新不再发 onboarding 查询（Network 面板验证）；⑥ 非交易页不再出现 /api/paper/account 轮询。

---

## 明确不做（记录）

- 写操作路由的认证不做任何弱化（安全边界）。
- Supabase/Vercel 区域迁移、盘口 WebSocket 化——既定二期项。
- 跨账号 `queryClient.clear()`（阶段 2 台账遗留）——牵涉登出流程回归面，与本阶段 API 主题无关，保留在待办清单单独立项。

阶段 4 是 spec 的最后一个阶段。完成合并后：四阶段全部落地，输出总验收清单。
