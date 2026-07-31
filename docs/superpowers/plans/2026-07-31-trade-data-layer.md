# 交易页数据层重写（Phase 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把合约面板（`FuturesInfoPanel`）和现货面板（`OrdersPanel`）从"每个面板自己 `setInterval` 轮询 5 秒"换成"React Query 统一缓存 + BingX listenKey 用户数据流实时推送、轮询降级为 30 秒兜底"，为后续四个阶段（K线历史、下单种类、面板增强、布局重做）打好数据地基。

**Architecture:** 新增 `src/lib/bingx/user-stream.ts`（listenKey 生命周期的签名请求）与 `src/lib/bingx/user-stream-events.ts`（把 BingX WS 推送的原始消息翻译成"该刷新哪些缓存"的纯函数，不掺入 I/O，方便单测）。新增 `src/app/api/bingx/user-stream/route.ts` 暴露 POST/PUT/DELETE。新增 `src/hooks/useUserDataStream.ts`（WS 连接生命周期：开连接、订阅、心跳、续期、断线重连），内部调用 `user-stream-events.ts` 的纯函数决定 `queryClient.invalidateQueries` 哪些 key。`src/hooks/useTradingAccount.ts` 新增四个 React Query hook（`useFuturesPositions`/`useFuturesOpenOrders`/`useFuturesBalance`/`useSpotOpenOrders`/`useSpotMyTrades`），query key 与上面的 invalidate 目标一一对应。最后把 `FuturesInfoPanel.tsx`、`OrdersPanel.tsx` 的手写 `fetchData`+`setInterval` 换成这些 hook，UI/JSX 保持不变——这一阶段只换数据来源，不动视觉和交互。

**Tech Stack:** Next.js App Router API routes、TanStack Query v5（已在项目里，`useQueryClient`/`useQuery`）、原生 WebSocket + `DecompressionStream`（沿用 `useBingXWebSocket.ts` 已验证的编解码方式）、Vitest（`environment: "node"`，仅 `src/lib/**/*.test.ts` 被收集）。

## Global Constraints

- listenKey REST 端点固定为 `/openApi/user/auth/userDataStream`（POST 生成、PUT 续期、DELETE 关闭），现货与合约共用同一个路径，两个市场各自独立生成一把 key
- listenKey 有效期 1 小时，官方文档建议每 30 分钟续期一次
- 现货用户数据流 WebSocket：`wss://open-api-ws.bingx.com/market?listenKey=<key>`，需要显式发送订阅消息（`spot.executionReport`、`ACCOUNT_UPDATE`）
- 合约用户数据流 WebSocket：`wss://open-api-swap.bingx.com/swap-market?listenKey=<key>`，连接后自动推送，**不需要**显式订阅
- 所有 WS 消息都是 GZIP 压缩，服务端会发 `Ping` 文本，客户端必须回 `Pong`（与 `useBingXWebSocket.ts` 现有行为一致）
- 新增的纯函数文件必须放在 `src/lib/bingx/` 下才会被 `vitest.config.ts` 的 `include` 收集到；`src/hooks/**` 目前没有任何测试基础设施，本计划不新增
- 现有 API 路由里"取用户 API Key"的样板代码（Supabase auth → 查 `api_keys` 表 → `decrypt`）在每个路由文件里都是重复的——这是既有约定，本计划的新路由跟随这个约定复制一份，不抽公共函数
- 本阶段**不改变** UI 结构、样式、交互；`FuturesInfoPanel.tsx`/`OrdersPanel.tsx` 的 JSX 输出必须与改动前逐字节一致，只换内部的数据获取方式

---

## File Structure

```
src/lib/bingx/
  user-stream.ts              新增：createListenKey / extendListenKey / deleteListenKey
  user-stream.test.ts         新增
  user-stream-events.ts       新增：parseFuturesStreamEvent / parseSpotStreamEvent / isListenKeyExpired
  user-stream-events.test.ts  新增
  ws-utils.ts                 新增：从 useBingXWebSocket.ts 提取出的共享 gunzip 函数
  ws-utils.test.ts            新增

src/app/api/bingx/
  user-stream/route.ts        新增：POST 创建、PUT 续期、DELETE 关闭 listenKey

src/hooks/
  useBingXWebSocket.ts         修改：改用 ws-utils.ts 的共享 gunzip，行为不变
  useUserDataStream.ts         新增：WS 连接生命周期 + 缓存失效派发
  useTradingAccount.ts         修改：新增 useFuturesPositions/useFuturesOpenOrders/useFuturesBalance/useSpotOpenOrders/useSpotMyTrades，并导出对应类型

src/components/trade/
  FuturesInfoPanel.tsx         修改：fetchData/setInterval → 新 hooks + useUserDataStream
  OrdersPanel.tsx              修改：fetchData/setInterval → 新 hooks + useUserDataStream
```

---

### Task 1: listenKey REST 生命周期函数

**Files:**
- Create: `src/lib/bingx/user-stream.ts`
- Test: `src/lib/bingx/user-stream.test.ts`

**Interfaces:**
- Consumes: `signedRequest` from `./signed-request`（已存在，签名：`signedRequest<T>(apiKey, secret, method, path, params?, env?): Promise<T>`）
- Produces：
  - `createListenKey(apiKey: string, secret: string): Promise<string>`
  - `extendListenKey(apiKey: string, secret: string, listenKey: string): Promise<void>`
  - `deleteListenKey(apiKey: string, secret: string, listenKey: string): Promise<void>`

供 Task 2（API 路由）与后续阶段直接调用。

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/bingx/user-stream.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const signedRequest = vi.fn();

vi.mock("./signed-request", () => ({
  signedRequest: (...args: unknown[]) => signedRequest(...args),
}));

const { createListenKey, extendListenKey, deleteListenKey } = await import("./user-stream");

beforeEach(() => {
  signedRequest.mockReset();
});

describe("createListenKey", () => {
  it("POSTs to the userDataStream endpoint and returns the listenKey string", async () => {
    signedRequest.mockResolvedValue({ listenKey: "abc123" });
    const key = await createListenKey("k", "s");
    expect(key).toBe("abc123");
    expect(signedRequest).toHaveBeenCalledWith("k", "s", "POST", "/openApi/user/auth/userDataStream");
  });
});

describe("extendListenKey", () => {
  it("PUTs the listenKey to extend its validity", async () => {
    signedRequest.mockResolvedValue({});
    await extendListenKey("k", "s", "abc123");
    expect(signedRequest).toHaveBeenCalledWith("k", "s", "PUT", "/openApi/user/auth/userDataStream", { listenKey: "abc123" });
  });
});

describe("deleteListenKey", () => {
  it("DELETEs the listenKey to release it", async () => {
    signedRequest.mockResolvedValue({});
    await deleteListenKey("k", "s", "abc123");
    expect(signedRequest).toHaveBeenCalledWith("k", "s", "DELETE", "/openApi/user/auth/userDataStream", { listenKey: "abc123" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/bingx/user-stream.test.ts`
Expected: FAIL（`Cannot find module './user-stream'` 或类似）

- [ ] **Step 3: 写实现**

```typescript
// src/lib/bingx/user-stream.ts
import { signedRequest } from "./signed-request";

/**
 * BingX 用户数据流（现货 spot.executionReport/ACCOUNT_UPDATE、合约
 * ORDER_TRADE_UPDATE/ACCOUNT_UPDATE）鉴权用的 listenKey 生命周期。
 * 现货与合约共用同一个 REST 端点，各自独立生成/续期/释放一把 key。
 */

interface ListenKeyResponse {
  listenKey: string;
}

export async function createListenKey(apiKey: string, secret: string): Promise<string> {
  const data = await signedRequest<ListenKeyResponse>(apiKey, secret, "POST", "/openApi/user/auth/userDataStream");
  return data.listenKey;
}

export async function extendListenKey(apiKey: string, secret: string, listenKey: string): Promise<void> {
  await signedRequest(apiKey, secret, "PUT", "/openApi/user/auth/userDataStream", { listenKey });
}

export async function deleteListenKey(apiKey: string, secret: string, listenKey: string): Promise<void> {
  await signedRequest(apiKey, secret, "DELETE", "/openApi/user/auth/userDataStream", { listenKey });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/bingx/user-stream.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/lib/bingx/user-stream.ts src/lib/bingx/user-stream.test.ts
git commit -m "feat(trade): add BingX listenKey lifecycle functions"
```

---

### Task 2: user-stream API 路由

**Files:**
- Create: `src/app/api/bingx/user-stream/route.ts`

**Interfaces:**
- Consumes: `createListenKey`/`extendListenKey`/`deleteListenKey` from `@/lib/bingx/user-stream`（Task 1）；`createClient` from `@/lib/supabase/server`；`decrypt` from `@/lib/crypto`
- Produces: `POST /api/bingx/user-stream` → `{ success: true, data: { listenKey: string } }`；`PUT`/`DELETE` body `{ listenKey: string }` → `{ success: true }`

这一步没有纯函数可单测（路由需要真实 Supabase session），跟随代码库里其它路由的现状——本仓库的 API 路由目前没有集成测试基础设施，只有 `lib/` 层做单测。用手动 curl/浏览器验证（Step 2）。

- [ ] **Step 1: 写实现**

```typescript
// src/app/api/bingx/user-stream/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { createListenKey, extendListenKey, deleteListenKey } from "@/lib/bingx/user-stream";

async function resolveApiKey(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return { error: NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 }) };
  }

  const { data: apiKeys, error: keyError } = await supabase
    .from("api_keys").select("api_key_encrypted, secret_encrypted")
    .eq("user_id", authData.user.id).eq("is_valid", true)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
    .limit(1);

  if (keyError || !apiKeys?.length) {
    return { error: NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 }) };
  }

  return { apiKey: decrypt(apiKeys[0].api_key_encrypted), secret: decrypt(apiKeys[0].secret_encrypted) };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (resolved.error) return resolved.error;

    const listenKey = await createListenKey(resolved.apiKey!, resolved.secret!);
    return NextResponse.json({ success: true, data: { listenKey } });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (resolved.error) return resolved.error;

    const { listenKey } = await request.json();
    if (!listenKey) {
      return NextResponse.json({ success: false, error: { message: "listenKey is required" } }, { status: 400 });
    }

    await extendListenKey(resolved.apiKey!, resolved.secret!, listenKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (resolved.error) return resolved.error;

    const { listenKey } = await request.json();
    if (!listenKey) {
      return NextResponse.json({ success: false, error: { message: "listenKey is required" } }, { status: 400 });
    }

    await deleteListenKey(resolved.apiKey!, resolved.secret!, listenKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
```

- [ ] **Step 2: 手动验证（登录态下，浏览器 devtools 或 curl 带上 session cookie）**

```bash
curl -X POST http://localhost:3000/api/bingx/user-stream -b "<session-cookie>"
```

Expected: `{"success":true,"data":{"listenKey":"..."}}`；未登录时返回 401；未绑定 API Key 时返回 400。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bingx/user-stream/route.ts
git commit -m "feat(trade): add listenKey create/extend/delete API route"
```

---

### Task 3: 提取共享的 WS gunzip 工具

`useBingXWebSocket.ts` 里已经写好了一份 GZIP 解压逻辑（`gunzip` 函数），新的用户数据流 hook 需要一模一样的逻辑。与其复制一份，不如提取成共享函数——这是一个可以独立测试、独立提交的小任务。

**Files:**
- Create: `src/lib/bingx/ws-utils.ts`
- Test: `src/lib/bingx/ws-utils.test.ts`
- Modify: `src/hooks/useBingXWebSocket.ts:31-38`（删除本地 `gunzip`，改为从 `ws-utils.ts` 导入）

**Interfaces:**
- Produces: `gunzipWsMessage(buf: ArrayBuffer): Promise<string>` — 供 Task 4 的 `useUserDataStream.ts` 使用

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/bingx/ws-utils.test.ts
import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { gunzipWsMessage } from "./ws-utils";

describe("gunzipWsMessage", () => {
  it("decompresses a gzip-compressed ArrayBuffer back to its original text", async () => {
    const original = JSON.stringify({ dataType: "BTC-USDT@ticker", data: { c: "63000" } });
    const compressed = gzipSync(Buffer.from(original));
    const arrayBuffer = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);

    const result = await gunzipWsMessage(arrayBuffer as ArrayBuffer);
    expect(result).toBe(original);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/bingx/ws-utils.test.ts`
Expected: FAIL（`Cannot find module './ws-utils'`）

- [ ] **Step 3: 写实现**

```typescript
// src/lib/bingx/ws-utils.ts
/** GZIP decompress an ArrayBuffer to text. Shared by every BingX WebSocket
 *  connection (market ticker stream, user data stream) — BingX compresses
 *  every binary WS frame regardless of channel. */
export async function gunzipWsMessage(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  return new Response(ds.readable).text();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/bingx/ws-utils.test.ts`
Expected: PASS

- [ ] **Step 5: 把 `useBingXWebSocket.ts` 改成使用共享函数**

在 `src/hooks/useBingXWebSocket.ts` 里：
- 删除第 31-38 行本地的 `async function gunzip(buf: ArrayBuffer): Promise<string> { ... }`
- 在文件顶部 import 区域新增：`import { gunzipWsMessage } from "@/lib/bingx/ws-utils";`
- 把文件里两处调用 `gunzip(...)` 的地方（第 114 行、第 130 行附近）改成调用 `gunzipWsMessage(...)`

行为完全不变，纯粹是把函数体搬到共享文件。

- [ ] **Step 6: 运行现有测试套件确认没有破坏任何东西**

Run: `npm test`
Expected: 全部 PASS（本仓库目前没有 `useBingXWebSocket` 的单测，这一步是确认没有其它测试因为改动而失败）

- [ ] **Step 7: Commit**

```bash
git add src/lib/bingx/ws-utils.ts src/lib/bingx/ws-utils.test.ts src/hooks/useBingXWebSocket.ts
git commit -m "refactor(trade): extract shared WS gunzip helper"
```

---

### Task 4: 用户数据流消息解析（纯函数）

把"BingX 推给我们的原始 WS 消息"翻译成"该刷新哪些缓存"——这一步不碰网络/WebSocket，只是纯函数，方便写测试锁定两个市场的消息形状差异（现货走 `spot.executionReport`/`ACCOUNT_UPDATE` 显式订阅频道，合约的 `ORDER_TRADE_UPDATE`/`ACCOUNT_UPDATE`/`listenKeyExpired` 是连接后自动推送、不带 `dataType` 包装）。

**Files:**
- Create: `src/lib/bingx/user-stream-events.ts`
- Test: `src/lib/bingx/user-stream-events.test.ts`

**Interfaces:**
- Produces:
  - `interface StreamInvalidation { orders: boolean; positions: boolean; balance: boolean }`
  - `parseFuturesStreamEvent(raw: unknown): StreamInvalidation | null`
  - `parseSpotStreamEvent(raw: unknown): StreamInvalidation | null`
  - `isListenKeyExpired(raw: unknown): boolean`

供 Task 5（`useUserDataStream.ts`）使用，决定收到一条 WS 消息后调用哪些 `queryClient.invalidateQueries`。

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/bingx/user-stream-events.test.ts
import { describe, it, expect } from "vitest";
import { parseFuturesStreamEvent, parseSpotStreamEvent, isListenKeyExpired } from "./user-stream-events";

describe("parseFuturesStreamEvent", () => {
  it("ORDER_TRADE_UPDATE invalidates both orders and positions (a fill changes both)", () => {
    const raw = { e: "ORDER_TRADE_UPDATE", E: 1700000000000, o: { s: "BTC-USDT", x: "TRADE", X: "FILLED" } };
    expect(parseFuturesStreamEvent(raw)).toEqual({ orders: true, positions: true, balance: false });
  });

  it("ACCOUNT_UPDATE invalidates positions and balance, not orders", () => {
    const raw = { e: "ACCOUNT_UPDATE", E: 1700000000000, a: { m: "ORDER", B: [], P: [] } };
    expect(parseFuturesStreamEvent(raw)).toEqual({ orders: false, positions: true, balance: true });
  });

  it("ACCOUNT_CONFIG_UPDATE (leverage/margin change) is not one of our invalidation targets", () => {
    const raw = { e: "ACCOUNT_CONFIG_UPDATE", ac: { s: "BTC-USDT", l: 20 } };
    expect(parseFuturesStreamEvent(raw)).toBeNull();
  });

  it("returns null for unrecognized event shapes instead of throwing", () => {
    expect(parseFuturesStreamEvent({})).toBeNull();
    expect(parseFuturesStreamEvent(null)).toBeNull();
  });
});

describe("isListenKeyExpired", () => {
  it("recognizes the listenKeyExpired push", () => {
    expect(isListenKeyExpired({ e: "listenKeyExpired", E: 1676964520421, listenKey: "abc" })).toBe(true);
  });

  it("is false for any other event", () => {
    expect(isListenKeyExpired({ e: "ORDER_TRADE_UPDATE" })).toBe(false);
    expect(isListenKeyExpired(null)).toBe(false);
  });
});

describe("parseSpotStreamEvent", () => {
  it("recognizes executionReport wrapped in a dataType envelope (ticker-style)", () => {
    const raw = { dataType: "spot.executionReport", data: { e: "executionReport", s: "BTC-USDT", X: "FILLED" } };
    expect(parseSpotStreamEvent(raw)).toEqual({ orders: true, positions: false, balance: false });
  });

  it("recognizes ACCOUNT_UPDATE via dataType even without a nested e field", () => {
    const raw = { dataType: "ACCOUNT_UPDATE", data: { a: { m: "ORDER", B: [] } } };
    expect(parseSpotStreamEvent(raw)).toEqual({ orders: false, positions: false, balance: true });
  });

  it("recognizes ACCOUNT_UPDATE via a top-level e field (unwrapped shape)", () => {
    const raw = { e: "ACCOUNT_UPDATE", a: { m: "ORDER", B: [] } };
    expect(parseSpotStreamEvent(raw)).toEqual({ orders: false, positions: false, balance: true });
  });

  it("returns null for unrecognized event shapes instead of throwing", () => {
    expect(parseSpotStreamEvent({})).toBeNull();
    expect(parseSpotStreamEvent(null)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/bingx/user-stream-events.test.ts`
Expected: FAIL（`Cannot find module './user-stream-events'`）

- [ ] **Step 3: 写实现**

```typescript
// src/lib/bingx/user-stream-events.ts
/**
 * 把 BingX 用户数据流推送的原始消息翻译成"该刷新哪些前端缓存"，不做网络 I/O，
 * 纯函数方便单测。现货和合约的消息形状不同：
 * - 合约（swap）：连接后自动推送，消息顶层直接带 `e` 字段，没有 dataType 包装
 *   （见 BingX swap-ws-account 文档：ORDER_TRADE_UPDATE / ACCOUNT_UPDATE /
 *   listenKeyExpired 都是顶层 `e`）。
 * - 现货（spot）：文档里 executionReport 的字段表写的是 `data.e` 前缀（暗示走
 *   ticker 那种 `{dataType, data}` 包装），但 ACCOUNT_UPDATE 那节的字段表又直接
 *   写顶层 `e`，两节自相矛盾。这里两种形状都识别，实现联调时应对照真实连接抓包
 *   确认实际形状，但无论哪种形状，下面的解析都能正确分派。
 */

export interface StreamInvalidation {
  orders: boolean;
  positions: boolean;
  balance: boolean;
}

interface FuturesRawEvent {
  e?: string;
}

export function isListenKeyExpired(raw: unknown): boolean {
  return (raw as FuturesRawEvent | null)?.e === "listenKeyExpired";
}

export function parseFuturesStreamEvent(raw: unknown): StreamInvalidation | null {
  const e = (raw as FuturesRawEvent | null)?.e;
  if (e === "ORDER_TRADE_UPDATE") return { orders: true, positions: true, balance: false };
  if (e === "ACCOUNT_UPDATE") return { orders: false, positions: true, balance: true };
  return null;
}

interface SpotRawEvent {
  dataType?: string;
  data?: { e?: string };
  e?: string;
}

export function parseSpotStreamEvent(raw: unknown): StreamInvalidation | null {
  const msg = raw as SpotRawEvent | null;
  if (!msg) return null;

  const dataType = msg.dataType;
  const innerEvent = msg.data?.e ?? msg.e;

  if (dataType === "ACCOUNT_UPDATE" || innerEvent === "ACCOUNT_UPDATE") {
    return { orders: false, positions: false, balance: true };
  }
  if (dataType === "spot.executionReport" || innerEvent === "executionReport") {
    return { orders: true, positions: false, balance: false };
  }
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/bingx/user-stream-events.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/lib/bingx/user-stream-events.ts src/lib/bingx/user-stream-events.test.ts
git commit -m "feat(trade): add pure parser for user-stream cache invalidation"
```

---

### Task 5: React Query hooks（持仓/挂单/余额）

**Files:**
- Modify: `src/hooks/useTradingAccount.ts`

**Interfaces:**
- Consumes: 无新依赖（沿用文件已有的 `getJson` helper 和 `useQuery`）
- Produces（供 Task 6/7 的面板组件与 Task 8 的 `useUserDataStream` 引用其 queryKey）：
  - `interface FuturesPosition { symbol; positionId; positionSide: "LONG"|"SHORT"; positionAmt; unrealizedProfit; leverage; avgPrice; markPrice; liquidationPrice; isolated: boolean }`
  - `interface FuturesOpenOrder { symbol; orderId; side; positionSide; type; origQty; price; stopPrice?; executedQty; status; leverage }`
  - `useFuturesPositions(enabled = true): UseQueryResult<FuturesPosition[]>` — queryKey `["trading", "futures-positions"]`
  - `useFuturesOpenOrders(enabled = true): UseQueryResult<FuturesOpenOrder[]>` — queryKey `["trading", "futures-open-orders"]`
  - `useFuturesBalance(enabled = true): UseQueryResult<{ availableMargin: string; equity: string } | null>` — queryKey `["trading", "futures-balance"]`
  - `interface SpotOpenOrder { symbol; orderId; price; stopPrice?; origQty; executedQty; status; type; side; time; updateTime }`
  - `interface SpotTradeRecord { symbol; id; orderId; price; qty; commission; commissionAsset; time; isBuyer; isMaker }`
  - `useSpotOpenOrders(enabled = true): UseQueryResult<SpotOpenOrder[]>` — queryKey `["trading", "spot-open-orders"]`
  - `useSpotMyTrades(limit = 30, enabled = true): UseQueryResult<SpotTradeRecord[]>` — queryKey `["trading", "spot-my-trades", limit]`

这一步没有新纯函数可单测（都是 `useQuery` 包装真实 fetch），行为在 Task 6/7 里通过页面手动验证。

- [ ] **Step 1: 在文件顶部新增类型定义（放在已有 `interface FuturesAccount` 之后）**

```typescript
// src/hooks/useTradingAccount.ts — 在现有 interface FuturesAccount 定义之后追加

export interface FuturesPosition {
  symbol: string;
  positionId: string;
  positionSide: "LONG" | "SHORT";
  positionAmt: string;
  unrealizedProfit: string;
  leverage: number;
  avgPrice: string;
  markPrice: string;
  liquidationPrice: string;
  isolated: boolean;
}

export interface FuturesOpenOrder {
  symbol: string;
  orderId: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  stopPrice?: string;
  executedQty: string;
  status: string;
  leverage: number;
}

export interface SpotOpenOrder {
  symbol: string;
  orderId: string;
  price: string;
  stopPrice?: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
  time: number;
  updateTime: number;
}

export interface SpotTradeRecord {
  symbol: string;
  id: string;
  orderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}
```

- [ ] **Step 2: 在文件末尾新增五个 hook**

```typescript
// src/hooks/useTradingAccount.ts — 追加在文件末尾

/** 账户下全部持仓（不按 symbol 过滤——面板本身就是"账户所有持仓"视图） */
export function useFuturesPositions(enabled = true) {
  return useQuery<FuturesPosition[]>({
    queryKey: ["trading", "futures-positions"],
    queryFn: () => getJson<FuturesPosition[]>("/api/bingx/futures/positions"),
    // WS 用户数据流（useUserDataStream）会在 ORDER_TRADE_UPDATE/ACCOUNT_UPDATE
    // 到达时立即 invalidate 触发重取；这个 30s 轮询只是断线兜底，不是主更新机制
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
  });
}

/** 账户下全部合约挂单（不按 symbol 过滤） */
export function useFuturesOpenOrders(enabled = true) {
  return useQuery<FuturesOpenOrder[]>({
    queryKey: ["trading", "futures-open-orders"],
    queryFn: async () => {
      const raw = await getJson<FuturesOpenOrder[] | { orders: FuturesOpenOrder[] }>("/api/bingx/futures/open-orders");
      return Array.isArray(raw) ? raw : raw?.orders ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
  });
}

/** 合约钱包权益/可用保证金（账户级，与当前图表 symbol 无关） */
export function useFuturesBalance(enabled = true) {
  return useQuery<{ availableMargin: string; equity: string } | null>({
    queryKey: ["trading", "futures-balance"],
    queryFn: () => getJson<{ availableMargin: string; equity: string } | null>("/api/bingx/futures/positions?type=balance"),
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
  });
}

/** 账户下全部现货挂单（不按 symbol 过滤） */
export function useSpotOpenOrders(enabled = true) {
  return useQuery<SpotOpenOrder[]>({
    queryKey: ["trading", "spot-open-orders"],
    queryFn: async () => {
      const raw = await getJson<SpotOpenOrder[] | { orders: SpotOpenOrder[] }>("/api/bingx/trade/open-orders");
      return Array.isArray(raw) ? raw : raw?.orders ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
  });
}

/** 账户下最近成交（不按 symbol 过滤） */
export function useSpotMyTrades(limit = 30, enabled = true) {
  return useQuery<SpotTradeRecord[]>({
    queryKey: ["trading", "spot-my-trades", limit],
    queryFn: async () => {
      const raw = await getJson<SpotTradeRecord[] | { fills: SpotTradeRecord[] }>(`/api/bingx/trade/my-trades?limit=${limit}`);
      return Array.isArray(raw) ? raw : raw?.fills ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    retry: false,
  });
}
```

- [ ] **Step 3: 类型检查确认没有引入编译错误**

Run: `npx tsc --noEmit`
Expected: 无新增错误（这一步只是新增导出，不改变任何现有签名）

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTradingAccount.ts
git commit -m "feat(trade): add React Query hooks for futures positions/orders and spot orders/trades"
```

---

### Task 6: useUserDataStream —— WS 连接生命周期

**Files:**
- Create: `src/hooks/useUserDataStream.ts`

**Interfaces:**
- Consumes:
  - `gunzipWsMessage` from `@/lib/bingx/ws-utils`（Task 3）
  - `parseFuturesStreamEvent`/`parseSpotStreamEvent`/`isListenKeyExpired` from `@/lib/bingx/user-stream-events`（Task 4）
  - `useQueryClient` from `@tanstack/react-query`
  - 三个 REST 端点：`POST/PUT/DELETE /api/bingx/user-stream`（Task 2）
- Produces: `useUserDataStream({ market: "spot" | "futures"; enabled: boolean }): void` — 供 Task 7/8 的面板组件调用

这是一个纯粹的连接管理 hook（无返回值，副作用是让 React Query 缓存保持新鲜），本仓库对 WebSocket hook 一贯不写单测（`useBingXWebSocket.ts` 同样没有测试——测试真实 WebSocket 连接需要 jsdom + mock WebSocket 服务端，投入产出比低），已经在 Task 4 把可测的部分（消息解析）单独拆出来测过了。

- [ ] **Step 1: 写实现**

```typescript
// src/hooks/useUserDataStream.ts
"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gunzipWsMessage } from "@/lib/bingx/ws-utils";
import {
  parseFuturesStreamEvent,
  parseSpotStreamEvent,
  isListenKeyExpired,
  type StreamInvalidation,
} from "@/lib/bingx/user-stream-events";

const SPOT_WS_URL = "wss://open-api-ws.bingx.com/market";
const SWAP_WS_URL = "wss://open-api-swap.bingx.com/swap-market";
const KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000; // BingX: 1h 有效期，每 30 分钟续期
const RECONNECT_DELAY_MS = 3_000;

interface UseUserDataStreamOptions {
  market: "spot" | "futures";
  /** false 时（未登录 / 未绑定 API Key / 当前不是这个市场）整体不建立连接 */
  enabled: boolean;
}

async function postJson<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

/**
 * 打开一条 BingX 用户数据流连接（现货或合约二选一，取决于 market），收到
 * ORDER_TRADE_UPDATE / ACCOUNT_UPDATE / executionReport 时让对应的 React Query
 * 缓存立即失效重取，而不是等 30 秒的兜底轮询。
 *
 * 只应该在"这个市场当前对用户可见"时挂载（例如 FuturesInfoPanel 只在
 * market === "futures" 时渲染），不需要跨面板去重——同一时刻只有一个面板可见。
 */
export function useUserDataStream({ market, enabled }: UseUserDataStreamOptions): void {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const listenKeyRef = useRef<string | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function invalidate(target: StreamInvalidation) {
      if (market === "futures") {
        if (target.orders) queryClient.invalidateQueries({ queryKey: ["trading", "futures-open-orders"] });
        if (target.positions) queryClient.invalidateQueries({ queryKey: ["trading", "futures-positions"] });
        if (target.balance) queryClient.invalidateQueries({ queryKey: ["trading", "futures-balance"] });
      } else {
        // 一笔成交既改变挂单状态也产生新的成交记录，两个缓存一起刷新
        if (target.orders) {
          queryClient.invalidateQueries({ queryKey: ["trading", "spot-open-orders"] });
          queryClient.invalidateQueries({ queryKey: ["trading", "spot-my-trades"] });
        }
        if (target.balance) queryClient.invalidateQueries({ queryKey: ["trading", "spot-balances"] });
      }
    }

    async function connect() {
      if (cancelled) return;
      let listenKey: string;
      try {
        const data = await postJson<{ listenKey: string }>("/api/bingx/user-stream");
        listenKey = data.listenKey;
      } catch {
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      if (cancelled) return;
      listenKeyRef.current = listenKey;

      const baseUrl = market === "spot" ? SPOT_WS_URL : SWAP_WS_URL;
      const ws = new WebSocket(`${baseUrl}?listenKey=${listenKey}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (market === "spot") {
          // 合约连接后自动推送，不需要订阅；现货需要显式订阅这两个频道
          ws.send(JSON.stringify({ id: `${Date.now()}-orders`, reqType: "sub", dataType: "spot.executionReport" }));
          ws.send(JSON.stringify({ id: `${Date.now()}-balance`, reqType: "sub", dataType: "ACCOUNT_UPDATE" }));
        }
      };

      ws.onmessage = async (event) => {
        let text: string;
        try {
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            if (event.data.byteLength === 0) return;
            const raw = new TextDecoder().decode(event.data);
            text = raw.startsWith("{") || raw.startsWith("[") ? raw : await gunzipWsMessage(event.data);
          } else {
            return;
          }
        } catch {
          return;
        }

        if (text === "Ping" || text.trim() === "Ping") { ws.send("Pong"); return; }

        let msg: unknown;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }

        if (isListenKeyExpired(msg)) {
          ws.close();
          return;
        }

        const invalidation = market === "spot" ? parseSpotStreamEvent(msg) : parseFuturesStreamEvent(msg);
        if (invalidation) invalidate(invalidation);
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        if (wsRef.current !== ws) return; // 已经被更新的连接替代
        wsRef.current = null;
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      keepaliveTimerRef.current = setInterval(async () => {
        const key = listenKeyRef.current;
        if (!key) return;
        try {
          await fetch("/api/bingx/user-stream", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listenKey: key }),
          });
        } catch {
          // 续期失败：等 listenKeyExpired 推送或者下一次 onclose 触发重连即可，不需要在这里特殊处理
        }
      }, KEEPALIVE_INTERVAL_MS);
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      const key = listenKeyRef.current;
      if (key) {
        fetch("/api/bingx/user-stream", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listenKey: key }),
        }).catch(() => {});
      }
    };
    // market 变化或 enabled 从 false→true 才需要重新建连接；queryClient 引用稳定不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, enabled]);
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUserDataStream.ts
git commit -m "feat(trade): add listenKey WebSocket lifecycle hook"
```

---

### Task 7: 接入 FuturesInfoPanel

**Files:**
- Modify: `src/components/trade/FuturesInfoPanel.tsx`

**Interfaces:**
- Consumes: `useFuturesPositions`/`useFuturesOpenOrders`/`useFuturesBalance`/`FuturesPosition`/`FuturesOpenOrder` from `@/hooks/useTradingAccount`（Task 5）；`useUserDataStream` from `@/hooks/useUserDataStream`（Task 6）；`useQueryClient` from `@tanstack/react-query`

只换数据获取方式，JSX 结构、className、文案一律不动。

- [ ] **Step 1: 替换 import 与本地类型**

删除文件顶部（第 1-47 行区域）的：
```typescript
import { useEffect, useState, useCallback } from "react";
```
以及本地定义的 `interface FuturesPosition`、`interface FuturesOrder`、`interface FuturesBalance`（第 15-47 行）。

改为：
```typescript
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { translateError } from "@/components/trade/order-form/OrderForm";
import {
  useFuturesPositions, useFuturesOpenOrders, useFuturesBalance,
  type FuturesPosition, type FuturesOpenOrder,
} from "@/hooks/useTradingAccount";
import { useUserDataStream } from "@/hooks/useUserDataStream";
```

组件内部原来引用 `FuturesOrder` 类型的地方（`useState<FuturesOrder[]>`、函数参数类型等）全部改成 `FuturesOpenOrder`。

- [ ] **Step 2: 替换数据获取逻辑**

删除：
```typescript
const [positions, setPositions] = useState<FuturesPosition[]>([]);
const [orders, setOrders] = useState<FuturesOrder[]>([]);
const [balance, setBalance] = useState<FuturesBalance | null>(null);
const [loading, setLoading] = useState(true);
```
（保留其余 `useState`：`cancelling`/`closing`/`editing`/`editValue`/`amending`/`editingPos`/`tpValue`/`slValue`/`savingTpSl`/`tpSlError`/`closeError` 都不变）

以及整个：
```typescript
const fetchData = useCallback(async () => { ... }, []);

useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 5_000);
  return () => clearInterval(interval);
}, [fetchData]);
```

替换为：
```typescript
useUserDataStream({ market: "futures", enabled: true });

const queryClient = useQueryClient();
const { data: positions = [], isLoading: positionsLoading } = useFuturesPositions();
const { data: orders = [], isLoading: ordersLoading } = useFuturesOpenOrders();
const { data: balance = null } = useFuturesBalance();
const loading = positionsLoading || ordersLoading;

function refetchAll() {
  queryClient.invalidateQueries({ queryKey: ["trading", "futures-positions"] });
  queryClient.invalidateQueries({ queryKey: ["trading", "futures-open-orders"] });
  queryClient.invalidateQueries({ queryKey: ["trading", "futures-balance"] });
}
```

- [ ] **Step 3: 把每个 mutation 收尾的 `fetchData()` 换成 `refetchAll()`**

文件里一共 4 处调用 `fetchData()`（`handleCancel` 末尾、`handleAmend` 末尾、`handleClose` 的 `finally` 块、`handleSaveTpSl` 成功分支），全部改成调用 `refetchAll()`。函数体其余逻辑（错误处理、`setCancelling`/`setAmending` 等状态更新）保持不变。

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，登录一个绑定了合约 API Key 的账号，打开 `/trade` 切到 Futures：
1. 页面加载后应该看到持仓/挂单/钱包数据（与改动前视觉一致）
2. 挂一个合约限价单，观察挂单列表是否很快（不等 30 秒）出现新单——这验证 WS 推送在生效
3. 撤单/改价/设置 TP-SL/平仓，确认操作后列表刷新且没有报错
4. 打开浏览器 Network 面板的 WS 分支，确认有一条到 `open-api-swap.bingx.com` 的连接且状态为 101

Expected: 功能与改动前完全一致，只是挂单/持仓变化的反应速度从"最多等 5 秒"变成"几乎实时"

- [ ] **Step 5: Commit**

```bash
git add src/components/trade/FuturesInfoPanel.tsx
git commit -m "refactor(trade): wire FuturesInfoPanel to React Query + listenKey stream"
```

---

### Task 8: 接入 OrdersPanel（现货）

**Files:**
- Modify: `src/components/trade/OrdersPanel.tsx`

**Interfaces:**
- Consumes: `useSpotOpenOrders`/`useSpotMyTrades`/`useSpotBalances`/`SpotOpenOrder`/`SpotTradeRecord` from `@/hooks/useTradingAccount`（Task 5，`useSpotBalances` 已存在）；`useUserDataStream` from `@/hooks/useUserDataStream`（Task 6）；`useQueryClient` from `@tanstack/react-query`

- [ ] **Step 1: 替换 import 与本地类型**

删除本地定义的 `interface BingXOrder`、`interface BingXTradeRecord`、`interface BingXBalanceItem`（第 13-46 行），改为从 hooks 文件导入对应类型（`SpotOpenOrder`、`SpotTradeRecord`）；余额条目沿用 `useSpotBalances` 已有的返回类型（该 hook 目前没有导出具名类型，直接用其推断类型即可，不需要新增类型）。

顶部 import 改为：
```typescript
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import {
  useSpotOpenOrders, useSpotMyTrades, useSpotBalances,
  type SpotOpenOrder, type SpotTradeRecord,
} from "@/hooks/useTradingAccount";
import { useUserDataStream } from "@/hooks/useUserDataStream";
```

文件里所有 `BingXOrder` 类型引用改成 `SpotOpenOrder`，`BingXTradeRecord` 改成 `SpotTradeRecord`。

- [ ] **Step 2: 替换数据获取逻辑**

删除：
```typescript
const [orders, setOrders] = useState<BingXOrder[]>([]);
const [trades, setTrades] = useState<BingXTradeRecord[]>([]);
const [balances, setBalances] = useState<BingXBalanceItem[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
```
（保留 `cancelling`/`editing`/`editValue`/`amending` 这几个 `useState`）

以及整个 `fetchData`/`useEffect` 轮询块，替换为：
```typescript
useUserDataStream({ market: "spot", enabled: true });

const queryClient = useQueryClient();
const { data: orders = [], isLoading: ordersLoading, error: ordersError } = useSpotOpenOrders();
const { data: trades = [], isLoading: tradesLoading } = useSpotMyTrades(30);
const { data: rawBalances = [], isLoading: balancesLoading } = useSpotBalances();

const loading = ordersLoading || tradesLoading || balancesLoading;
const error = ordersError?.message?.includes("No valid API key")
  ? "Please add your BingX API key in Settings first."
  : null;

const balances = [...rawBalances]
  .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
  .sort((a, b) => {
    const ia = PRIORITY_ASSETS.indexOf(a.asset);
    const ib = PRIORITY_ASSETS.indexOf(b.asset);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.asset.localeCompare(b.asset);
  });

function refetchAll() {
  queryClient.invalidateQueries({ queryKey: ["trading", "spot-open-orders"] });
  queryClient.invalidateQueries({ queryKey: ["trading", "spot-my-trades"] });
  queryClient.invalidateQueries({ queryKey: ["trading", "spot-balances"] });
}
```

（`PRIORITY_ASSETS` 常量已经在文件顶部定义，沿用不变；这段过滤/排序逻辑是从原 `fetchData` 里原样搬过来的，行为不变。）

- [ ] **Step 3: 把 `handleCancel`/`handleAmend` 末尾的 `fetchData()` 换成 `refetchAll()`**

两处调用点，函数体其余逻辑不变。

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，登录一个绑定了现货 API Key 的账号，打开 `/trade`（默认 Spot）：
1. 页面加载后挂单/成交记录/钱包余额与改动前视觉一致
2. 挂一个现货限价单，确认挂单列表很快出现新单（不等 30 秒）
3. 撤单/改价确认操作后列表刷新
4. 未绑定 API Key 的账号应仍然看到 "Please add your BingX API key in Settings first." 提示
5. Network 面板确认有一条到 `open-api-ws.bingx.com` 带 `listenKey` 参数的 WS 连接

Expected: 功能与改动前完全一致，实时性提升

- [ ] **Step 5: Commit**

```bash
git add src/components/trade/OrdersPanel.tsx
git commit -m "refactor(trade): wire OrdersPanel to React Query + listenKey stream"
```

---

## 本计划之外（下一阶段处理）

- K线无限滚动历史（`useKlineHistory`、`KlineChart` 分页拼接）
- 下单种类补全（TIF/Reduce-Only/OCO/快捷比例按钮）
- `PaperOrdersPanel` 增强、历史订单/成交记录 tab、部分平仓/一键反向
- 可拖拽四栏布局、价格联动交互、视觉打磨

这些都依赖本计划打好的 React Query 缓存结构（尤其是这里定义的 queryKey 命名），但属于独立可发布的后续阶段，会有各自的实施计划。
