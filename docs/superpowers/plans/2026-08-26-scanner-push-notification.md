# 扫描器新卡片推送通知 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/settings` 页加一个开关，打开后扫描器出新警报卡时向手机推送系统通知，安卓与 iOS 都能收到。

**Architecture:** 推送链路（SW / 订阅 API / 服务端发送 / cron 扇出）已经完整存在，本次只做四件事：把「设备级浏览器订阅」与「用户级通知偏好」在结构上拆开以修掉「显示已开启却收不到」的 bug；把 web-push 的文案从固定的「新的选币榜单」换成真实卡片内容并与 Telegram 通道共用同一份文案表；加一个走完整真实链路的测试按钮；删掉那个没有入口且带 bug 的旧页面。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、next-intl、Tailwind、Supabase、`web-push`、Vitest（node 环境）。

## Global Constraints

- **不修改 `public/sw.js`。** 因此不需要 bump `VERSION`，也不涉及老客户端拿不到新 service worker 的问题。
- **不修改 `notification_prefs` / `push_subscriptions` 表结构，不新增迁移。**
- **不修改 `/api/user/notification-prefs` 与 `/api/push/subscribe` 的请求/响应契约。** `PUT` 的 body 仍是三个键的完整对象 `{ price_alerts, screener, new_content }`。
- **UI 只暴露 `screener` 一个开关。** `price_alerts` 与 `new_content` 仍在表里照常生效，只是没有 UI。
- **关闭开关时绝不调用 `unsubscribeFromPush()`。** `push_subscriptions` 是一台设备一行、三类通知共用，退订会连带废掉到价提醒。
- **场景名与操作文案只有 `zh` / `en` 两语**（类型 `AlertCopyLang = "en" | "zh"`）。`ms-MY` 的场景名落到英文，这是与 Telegram 通道一致的现状，本次不扩三语。
- **新增的纯函数必须放在 `src/lib/**` 下**，vitest 的 `include` 只覆盖 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts`，且 `environment: "node"`（没有 DOM）。
- 单测命令：`npm test`；单文件：`npx vitest run <path>`。
- 提交信息用中文，说清「为什么」而不只是「做了什么」，与仓库现有风格一致。

## File Structure

**新增**

| 文件 | 职责 |
|---|---|
| `src/lib/screener/alert-copy.ts` | 警报卡文案表（场景名 / 操作 / 点火 / 触发价格式化 / 语言选择）。纯模块，无 IO，Telegram 与 Web Push 共用。 |
| `src/lib/push/messages.test.ts` | `buildScreenerAlertMessage` 的单测。 |
| `src/lib/push/client.test.ts` | `derivePushState` 的单测。 |
| `src/app/api/push/test/route.ts` | 「发送测试通知」端点。 |
| `src/components/settings/NotificationSettings.tsx` | 通知区块整块 UI：状态探测、开关、降级说明、测试按钮。 |

**修改**

| 文件 | 改动 |
|---|---|
| `src/lib/screener/alert-push.ts` | 删掉四段本地定义，改从 `alert-copy.ts` import。行为不变。 |
| `src/lib/push/messages.ts` | `buildScreenerMessage` → `buildScreenerAlertMessage`；新增 `buildTestMessage`。 |
| `src/lib/push/client.ts` | 新增 `PushState`、`PushEnvironment`、`derivePushState`、`readPushState`。 |
| `src/app/api/cron/screener-scan/route.ts` | 换文案构造函数。 |
| `src/app/[locale]/(app)/settings/page.tsx` | 插入 `<NotificationSettings />`。 |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | `settings` 下新增 5 个键；删除 `nav.more_notifications`。 |
| `src/lib/nav/tabs.test.ts` | 删掉一行引用已删除路由的断言。 |

**删除**

- `src/app/[locale]/(app)/more/notifications/page.tsx`
- `src/app/[locale]/(app)/more/notifications/loading.tsx`

## 对 spec 的两处修正（实现前必读）

**1. 不新增 `ensurePushSubscription()`。** spec 的 E 节把它列为新函数，但细读 `src/lib/push/client.ts` 后确认：现有的 `subscribeToPush()` 语义已经完全一致——它检查支持性、请求权限、`existing ?? subscribe()` 复用已有订阅、并且**无论订阅是新建还是复用都会 POST 给服务端**（幂等，`onConflict: "endpoint"`）。bug 从来不在这个函数里，而在旧页面的 `hadAny` 判断让它压根没被调用。再加一个同义函数只是重复。**直接调用 `subscribeToPush(locale)`。**

**2. `navigator.serviceWorker.ready` 必须带超时。** `src/components/pwa/ServiceWorkerRegistrar.tsx:11` 有 `if (process.env.NODE_ENV !== "production") return;`——`npm run dev` 下**根本不注册 service worker**。而 `serviceWorker.ready` 在从未注册过 SW 时**永不 resolve**（不是 reject，是挂起）。不加超时的话，设置页的通知区块在本地开发中永远停在加载态，这个功能没法被开发。超时后按「没有可用的 service worker」处理，落到 `unsupported`——那正是事实。

---

### Task 1: 抽出 Telegram 与 Web Push 共用的警报文案表

把场景名、操作文案、点火文案、触发价格式化从 `alert-push.ts` 搬到一个纯模块。这是纯重构，`alert-push.test.ts` 必须原样通过——它是这次搬运没搬坏东西的证据。

**Files:**
- Create: `src/lib/screener/alert-copy.ts`
- Modify: `src/lib/screener/alert-push.ts`（删除 4 段本地定义，改为 import）
- Test: `src/lib/screener/alert-push.test.ts`（不修改，用作回归证据）

**Interfaces:**
- Consumes: `ScenarioKind`（`@/lib/screener/factors/scenario`）
- Produces:
  - `type AlertCopyLang = "en" | "zh"`
  - `const SCENARIO_LABELS: Record<AlertCopyLang, Record<ScenarioKind, string>>`
  - `const SCENARIO_ACTIONS: Record<AlertCopyLang, Record<ScenarioKind, string>>`
  - `const IGNITION_LABELS: Record<AlertCopyLang, { up: string; down: string; action: string }>`
  - `function fmtTriggerPrice(n: number): string`
  - `function pickAlertLang(locale: string): AlertCopyLang`

- [ ] **Step 1: 先跑一遍现有测试，记下基线**

Run: `npx vitest run src/lib/screener/alert-push.test.ts`
Expected: PASS（全绿）。如果这一步就有红的，停下来先问，不要在红的基础上重构。

- [ ] **Step 2: 创建 `src/lib/screener/alert-copy.ts`**

内容整段照抄（这些表的具体措辞取自 brief 的六场景速查表，**一个字都不要改**）：

```ts
import type { ScenarioKind } from "./factors/scenario";

/**
 * 警报卡的文案表。Telegram 与 Web Push 两个通道共用。
 *
 * 共用不是为了省几行——两个通道说的是**同一个事件**，文案各写一份就会分叉：
 * Telegram 说「反手做空」而系统推送说「考虑做空」，读的人无从判断哪个是准的。
 * 场景名与操作文案原样取自 brief 的六场景速查表，改这里之前先去改那张表。
 *
 * 只有 zh / en 两语。推送订阅的 locale 有 ms-MY，它会落到 en（见 pickAlertLang）。
 * 这跟 Telegram 侧的 TelegramMessageLang 是同一个取值集合，但不复用那个类型——
 * telegram-push.ts 会拉进 Supabase 依赖，而这个模块必须保持纯净：
 * lib/push/messages.ts 要在 cron 路由里 import 它。
 */
export type AlertCopyLang = "en" | "zh";

/** 场景名，跟 brief 里六场景速查表用的中文名一一对应，英文是直译。 */
export const SCENARIO_LABELS: Record<AlertCopyLang, Record<ScenarioKind, string>> = {
  zh: {
    healthy_trend: "健康趋势",
    inventory_flush: "存量清算",
    true_top_div: "真顶背离",
    true_bottom_div: "真底背离",
    false_top_div: "假顶背离",
    false_bottom_div: "假底背离",
  },
  en: {
    healthy_trend: "Healthy Trend",
    inventory_flush: "Inventory Flush",
    true_top_div: "True Top Divergence",
    true_bottom_div: "True Bottom Divergence",
    false_top_div: "False Top Divergence",
    false_bottom_div: "False Bottom Divergence",
  },
};

/** 操作文案，原样取自 brief 六场景速查表最后一列——不重新措辞，避免文案与判定表脱节。 */
export const SCENARIO_ACTIONS: Record<AlertCopyLang, Record<ScenarioKind, string>> = {
  zh: {
    healthy_trend: "顺势，回调进场",
    inventory_flush: "分批止盈，等反手",
    true_top_div: "反手做空",
    true_bottom_div: "反手做多",
    false_top_div: "禁止做空，顺势做多",
    false_bottom_div: "禁止做多，顺势做空",
  },
  en: {
    healthy_trend: "Follow the trend, enter on pullback",
    inventory_flush: "Scale out, wait for reversal",
    true_top_div: "Reverse to short",
    true_bottom_div: "Reverse to long",
    false_top_div: "Do not short — follow trend, go long",
    false_bottom_div: "Do not long — follow trend, go short",
  },
};

/** 点火卡的名称与操作文案。两种触发源共用一条消息格式，这里只是把
 *  「场景名 · 操作」那两格换成点火自己的说法。 */
export const IGNITION_LABELS: Record<AlertCopyLang, { up: string; down: string; action: string }> = {
  zh: { up: "向上点火", down: "向下点火", action: "刚突破区间，顺势跟" },
  en: { up: "Ignition Up", down: "Ignition Down", action: "Just broke range — follow it" },
};

/**
 * 触发价。加千分位，`2369` 读起来像编号，`2,369` 才一眼是价格。
 *
 * 小数位按量级给：一美元以下的币（0.09426、0.01467 这种）必须留够 6 位，
 * 统一取 2 位会把它们全压成 0.09 —— 那个数字对使用者毫无意义。
 */
export function fmtTriggerPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 });
}

/**
 * 把订阅行存的 locale（zh-CN / en-US / ms-MY）映射到这张表的两语。
 *
 * ms-MY 落到英文是已知的不对称，跟 Telegram 侧一致。给马来语用户看英文场景名，
 * 好过给他一个 undefined。
 */
export function pickAlertLang(locale: string): AlertCopyLang {
  return locale.startsWith("zh") ? "zh" : "en";
}
```

- [ ] **Step 3: 从 `alert-push.ts` 删掉搬走的四段，改为 import**

在 `src/lib/screener/alert-push.ts` 顶部的 import 区，`import type { AlertCardData } from "./cards";` 之后加一行：

```ts
import {
  SCENARIO_LABELS,
  SCENARIO_ACTIONS,
  IGNITION_LABELS,
  fmtTriggerPrice,
} from "./alert-copy";
```

然后**删除**该文件中这四段本地定义（连同它们上方的注释块一起删，注释已经原样搬进 `alert-copy.ts`）：

1. `const SCENARIO_LABELS: Record<TelegramMessageLang, Record<ScenarioKind, string>> = { ... };`
2. `const SCENARIO_ACTIONS: Record<TelegramMessageLang, Record<ScenarioKind, string>> = { ... };`
3. `const IGNITION_LABELS: Record<TelegramMessageLang, { up: string; down: string; action: string }> = { ... };`
4. `function fmtTriggerPrice(n: number): string { ... }`

**同时删掉现在没人用的 import：** 检查 `import type { ScenarioKind } from "./factors/scenario";` 是否还有其他引用；如果没有，删掉它（ESLint 的 `no-unused-vars` 会报）。`TelegramMessageLang` 仍在 `STRINGS`、`groupHeading`、`formatAlertMessage` 里用着，**保留**。

**为什么类型对得上：** `groupHeading(a, lang)` 的 `lang` 是 `TelegramMessageLang = "en" | "zh"`，而新表的索引类型是 `AlertCopyLang = "en" | "zh"`——两个字面量联合结构相同，TypeScript 直接接受，不需要断言。

- [ ] **Step 4: 跑测试确认重构没改行为**

Run: `npx vitest run src/lib/screener/alert-push.test.ts`
Expected: PASS，且与 Step 1 的基线**完全一致**（同样数量的测试通过）。

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/alert-copy.ts src/lib/screener/alert-push.ts
git commit -m "refactor(screener): 警报文案表抽成共用模块——两个通道说的是同一个事件

Telegram 和 Web Push 推的是同一批警报卡，文案却各写一份就会分叉：
一边说「反手做空」另一边说「考虑做空」，读的人无从判断哪个是准的。

不复用 telegram-push 的 TelegramMessageLang 类型：那个模块会拉进 Supabase
依赖，而这张表接下来要被 lib/push/messages.ts 在 cron 路由里 import，
必须保持纯净。两个字面量联合结构相同，类型上直接对得上。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 推送文案改成真实卡片内容

`buildScreenerMessage(locale)` 发的是固定的「新的选币榜单／本轮筛选结果已更新」，而触发源早就是「扫描出新警报卡」。换成按卡片数自适应的文案，并把调用点一起换掉。

**Files:**
- Modify: `src/lib/push/messages.ts`
- Modify: `src/app/api/cron/screener-scan/route.ts`
- Test: `src/lib/push/messages.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `SCENARIO_LABELS` / `SCENARIO_ACTIONS` / `IGNITION_LABELS` / `fmtTriggerPrice` / `pickAlertLang`；`AlertCardData`（`@/lib/screener/cards`）
- Produces:
  - `function buildScreenerAlertMessage(locale: string, cards: AlertCardData[]): { title: string; body: string }`
  - `function buildTestMessage(locale: string): { title: string; body: string }`（Task 4 用）
  - **移除** `buildScreenerMessage`

> **对 spec 的一处澄清：** spec 的示例把截断写成 `PENDLE · ICP · SOL 等 12 个`（只列 3 个）。实现按 **最多列 5 个** 处理，即 12 张卡时 body 是 `A · B · C · D · E 等 12 个`。spec 那个示例是示意，`MAX_LISTED_COINS = 5` 是准数。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/push/messages.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildScreenerAlertMessage } from "./messages";
import type { AlertCardData } from "@/lib/screener/cards";
import type { Scenario } from "@/lib/screener/factors/scenario";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    kind: "healthy_trend",
    direction: "long",
    trap: false,
    swingPrev: 0.28,
    swingNow: 0.2961,
    swingNowAt: 0,
    cvdPct: 3.1,
    oiPct: 2.4,
    side: "high",
    ...overrides,
  };
}

function card(overrides: Partial<AlertCardData> = {}): AlertCardData {
  return {
    key: "TIA-USDT|healthy_trend|long|high|0.31",
    symbol: "TIA-USDT",
    coin: "TIA",
    trigger: { type: "scenario", scenario: scenario() },
    direction: "long",
    factors: { oi: 26, cvd: 13 },
    total: 39,
    firstSeenAt: "2026-08-26T00:00:00.000Z",
    firstPrice: 2369.5,
    peakPct: 1.2,
    invalidation: null,
    ...overrides,
  };
}

describe("buildScreenerAlertMessage", () => {
  it("只有一张卡时说清楚是哪个币、什么事、怎么办", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [card()]);
    expect(msg.title).toBe("🚨 TIA 健康趋势");
    expect(msg.body).toBe("@2,369.5 · 顺势，回调进场");
  });

  it("点火卡走点火自己的说法，不套场景名", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [
      card({
        coin: "PENDLE",
        firstPrice: 1.8305,
        trigger: {
          type: "ignition",
          ignition: { direction: "up", level: 1.82, distancePct: 0.6, ignitedAt: 0, barsAgo: 0 },
        },
      }),
    ]);
    expect(msg.title).toBe("🚨 PENDLE 向上点火");
    expect(msg.body).toBe("@1.8305 · 刚突破区间，顺势跟");
  });

  it("一美元以下的币必须留够小数位——0.09 对使用者毫无意义", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [card({ coin: "XX", firstPrice: 0.094261 })]);
    expect(msg.body).toContain("@0.094261");
  });

  it("多张卡合成一条：标题报数量，正文列币种", () => {
    const msg = buildScreenerAlertMessage("zh-CN", [
      card({ coin: "PENDLE" }),
      card({ coin: "ICP" }),
      card({ coin: "SOL" }),
    ]);
    expect(msg.title).toBe("🚨 3 个新信号");
    expect(msg.body).toBe("PENDLE · ICP · SOL");
  });

  it("超过 5 个币种就折起来——通知栏一行装不下十几个", () => {
    const coins = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const msg = buildScreenerAlertMessage("zh-CN", coins.map((c) => card({ coin: c })));
    expect(msg.title).toBe("🚨 12 个新信号");
    expect(msg.body).toBe("A · B · C · D · E 等 12 个");
  });

  it("英文的折叠说的是「还有几个」而不是「一共几个」", () => {
    const coins = ["A", "B", "C", "D", "E", "F", "G"];
    const msg = buildScreenerAlertMessage("en-US", coins.map((c) => card({ coin: c })));
    expect(msg.title).toBe("🚨 7 new signals");
    expect(msg.body).toBe("A · B · C · D · E and 2 more");
  });

  it("ms-MY 的框架文案是马来语，场景名落到英文——已知的不对称", () => {
    const msg = buildScreenerAlertMessage("ms-MY", [card()]);
    expect(msg.title).toBe("🚨 TIA Healthy Trend");
    const many = buildScreenerAlertMessage("ms-MY", [card({ coin: "A" }), card({ coin: "B" })]);
    expect(many.title).toBe("🚨 2 isyarat baharu");
  });

  it("空数组不崩——调用点已经挡掉了，但这里把行为钉住", () => {
    const msg = buildScreenerAlertMessage("zh-CN", []);
    expect(msg.title).toBe("🚨 0 个新信号");
    expect(msg.body).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run src/lib/push/messages.test.ts`
Expected: FAIL —— `buildScreenerAlertMessage is not a function`（该导出还不存在）。

- [ ] **Step 3: 改写 `src/lib/push/messages.ts`**

在文件顶部加 import：

```ts
import type { AlertCardData } from "@/lib/screener/cards";
import {
  SCENARIO_LABELS,
  SCENARIO_ACTIONS,
  IGNITION_LABELS,
  fmtTriggerPrice,
  pickAlertLang,
} from "@/lib/screener/alert-copy";
```

`COPY` 要改**两处**：先是它的类型字面量（`const COPY: Record<Locale, { ... }>` 里那个内联对象类型），然后是 `zh-CN` / `en-US` / `ms-MY` 三个值块。两处都是把 `screenerTitle` 与 `screenerBody` 换成新的四个键——`alertTitle` / `alertAbove` / `alertBelow` / `contentVideoTitle` / `contentArticleTitle` 一律保留不动。

**类型字面量里**，删掉 `screenerTitle: string;` 与 `screenerBody: string;`，加上：

```ts
  screenerCount: (n: number) => string;
  /** listed = 已列出的币种串，shown = 列了几个，total = 一共几个 */
  andMore: (listed: string, shown: number, total: number) => string;
  testTitle: string;
  testBody: string;
```

**三个值块里**，各自删掉 `screenerTitle: ...` 与 `screenerBody: ...` 两行，换成：

```ts
  // "zh-CN" 那一块里：
    screenerCount: (n) => `${n} 个新信号`,
    andMore: (listed, _shown, total) => `${listed} 等 ${total} 个`,
    testTitle: "Chart-IX 测试通知",
    testBody: "推送通道正常，你会在这里收到扫描器警报。",

  // "en-US" 那一块里：
    screenerCount: (n) => `${n} new signal${n === 1 ? "" : "s"}`,
    andMore: (listed, shown, total) => `${listed} and ${total - shown} more`,
    testTitle: "Chart-IX test notification",
    testBody: "Push is working — scanner alerts will arrive here.",

  // "ms-MY" 那一块里：
    screenerCount: (n) => `${n} isyarat baharu`,
    andMore: (listed, shown, total) => `${listed} dan ${total - shown} lagi`,
    testTitle: "Pemberitahuan ujian Chart-IX",
    testBody: "Tolakan berfungsi — amaran penapis akan tiba di sini.",
```

**删除** `buildScreenerMessage` 整个函数，换成：

```ts
/**
 * 通知正文里最多列几个币种。
 *
 * 系统通知的正文在锁屏上只有一两行，列到第六个就已经被截断成省略号——
 * 那时候用户既看不全币种、也看不到「一共几个」。折起来是为了把后半句留出来。
 */
const MAX_LISTED_COINS = 5;

/**
 * 一轮扫描的全部新警报卡合成**一条**通知。
 *
 * 只有一张卡时说具体的事（哪个币、什么结构、该怎么办）——那是这条通知全部的
 * 价值所在。多张时退回汇总：一次剧烈行情能同时触发十几个币，逐张弹通知会把
 * 安卓的通知栏刷爆、在 iOS 上折成一堆，而且没有哪一条是重点。这跟 Telegram
 * 侧「多条合并成一条」是同一个判断（见 alert-push.ts 的 formatAlertMessage）。
 *
 * 场景名与操作文案走 alert-copy 的两语表，框架文案（「N 个新信号」）走本文件的
 * 三语表。ms-MY 因此会拿到「马来语标题 + 英文场景名」——已知的不对称，与
 * Telegram 侧一致。
 *
 * cards 为空时调用点已经挡掉了（screener-scan 的 newCards.length > 0），
 * 这里不为它专门造一句文案，走汇总分支得到「0 个新信号」+ 空正文。
 */
export function buildScreenerAlertMessage(
  locale: string,
  cards: AlertCardData[]
): { title: string; body: string } {
  const copy = pick(locale);

  if (cards.length === 1) {
    const card = cards[0];
    const lang = pickAlertLang(locale);
    // 直接在 trigger 上分支，不抽成布尔量——抽出来 TypeScript 就不再收窄
    // 这个联合类型，两支都会去访问对方没有的字段。
    const tr = card.trigger;
    const name =
      tr.type === "scenario"
        ? SCENARIO_LABELS[lang][tr.scenario.kind]
        : IGNITION_LABELS[lang][tr.ignition.direction];
    const action =
      tr.type === "scenario"
        ? SCENARIO_ACTIONS[lang][tr.scenario.kind]
        : IGNITION_LABELS[lang].action;
    return {
      title: `🚨 ${card.coin} ${name}`,
      body: `@${fmtTriggerPrice(card.firstPrice)} · ${action}`,
    };
  }

  const coins = cards.map((c) => c.coin);
  const shown = coins.slice(0, MAX_LISTED_COINS);
  const listed = shown.join(" · ");
  return {
    title: `🚨 ${copy.screenerCount(coins.length)}`,
    body:
      coins.length > MAX_LISTED_COINS
        ? copy.andMore(listed, shown.length, coins.length)
        : listed,
  };
}

/** 「发送测试通知」按钮推的那条。它的全部作用是证明四段链路都通。 */
export function buildTestMessage(locale: string): { title: string; body: string } {
  const copy = pick(locale);
  return { title: copy.testTitle, body: copy.testBody };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/push/messages.test.ts`
Expected: PASS（8 条全绿）。

- [ ] **Step 5: 换掉扇出的调用点**

在 `src/app/api/cron/screener-scan/route.ts`，把第 7 行的 import 改成：

```ts
import { buildScreenerAlertMessage } from "@/lib/push/messages";
```

把 web-push 扇出那一段里的 payload 构造改掉（`{ ...buildScreenerMessage(row.locale), ... }` → 下面这样），并在上方补一句注释说明为什么保留逐行发送：

```ts
      if (payload.newCards.length > 0) {
        const subscriptions = await getOptedInSubscriptions("screener");
        // 逐行发而不是一次群发：文案要按每台设备订阅时存下的 locale 生成，
        // 而推送在用户看不见页面时弹出，没法临时问客户端要语言
        await Promise.all(
          subscriptions.map((row) =>
            sendToSubscriptions([row], {
              ...buildScreenerAlertMessage(row.locale, payload.newCards),
              url: `/${row.locale}/screener`,
              tag: "screener",
            })
          )
        );
      }
```

- [ ] **Step 6: 确认全绿且类型通过**

Run: `npx tsc --noEmit`
Expected: 无错误。若报 `buildScreenerMessage` 还有别处引用，`grep -rn "buildScreenerMessage" src/` 找出来一并改掉。

Run: `npm test`
Expected: 全部 PASS（包括 `src/lib/briefing/run.test.ts`——它 mock 了 `@/lib/push/send` 而非 `messages`，不受影响）。

- [ ] **Step 7: 提交**

```bash
git add src/lib/push/messages.ts src/lib/push/messages.test.ts src/app/api/cron/screener-scan/route.ts
git commit -m "fix(push): 推送说的不再是「本轮筛选结果已更新」，而是刚发生的那件事

触发源在 T25 就从「每 4 小时一张排行榜」改成了「扫描出新警报卡就发」，
web-push 这一路的文案却没跟上，还在推一句跟内容无关的通用话——用户点开
通知才知道发生了什么，那条通知等于只起了个铃声的作用。

一张卡时说具体的（币种、结构、怎么办），多张时汇总。不逐张弹：一次剧烈
行情能同时触发十几个币，那会把通知栏刷爆且没有重点——跟 Telegram 侧
合并成一条是同一个判断。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 推送状态探测

UI 要显示的是「这台设备现在到底能不能收到」，而不是「数据库里那个布尔值」。把判定写成纯函数（可测），异步取值写成薄封装——沿用 `src/lib/pwa/platform.ts` 里 `detectPlatform` / `readPlatform` 的既有做法。

**Files:**
- Modify: `src/lib/push/client.ts`
- Test: `src/lib/push/client.test.ts`（新建）

**Interfaces:**
- Consumes: `readPlatform`、`Platform`（`@/lib/pwa/platform`）
- Produces:
  - `type PushState = { kind: "ready"; subscribed: boolean } | { kind: "ios-install-first" } | { kind: "denied" } | { kind: "unsupported" }`
  - `interface PushEnvironment { hasApis: boolean; hasActiveWorker: boolean; hasVapidKey: boolean; permission: NotificationPermission | null; isIos: boolean; isStandalone: boolean; hasSubscription: boolean }`
  - `function derivePushState(env: PushEnvironment): PushState`
  - `function readPushState(): Promise<PushState>`
- 已有、Task 5 会直接用：`subscribeToPush(locale)`、`resubscribeIfNeeded(locale)`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/push/client.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { derivePushState, type PushEnvironment } from "./client";

function env(overrides: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    hasApis: true,
    hasActiveWorker: true,
    hasVapidKey: true,
    permission: "granted",
    isIos: false,
    isStandalone: false,
    hasSubscription: true,
    ...overrides,
  };
}

describe("derivePushState", () => {
  it("一切就绪且已订阅", () => {
    expect(derivePushState(env())).toEqual({ kind: "ready", subscribed: true });
  });

  it("一切就绪但还没订阅——开关显示为关，点一下就能开", () => {
    expect(derivePushState(env({ hasSubscription: false, permission: "default" }))).toEqual({
      kind: "ready",
      subscribed: false,
    });
  });

  it("iOS 未装到主屏排在 unsupported 之前——真相是「再点两下就能用」", () => {
    // iOS 非独立模式下 Notification / PushManager 本来就不存在，
    // 若先判 hasApis，用户看到的会是「浏览器不支持」这句死路文案
    const state = derivePushState(
      env({ isIos: true, isStandalone: false, hasApis: false, permission: null })
    );
    expect(state).toEqual({ kind: "ios-install-first" });
  });

  it("iOS 装到主屏后就走正常判定", () => {
    expect(derivePushState(env({ isIos: true, isStandalone: true }))).toEqual({
      kind: "ready",
      subscribed: true,
    });
  });

  it("缺 API 时 unsupported", () => {
    expect(derivePushState(env({ hasApis: false }))).toEqual({ kind: "unsupported" });
  });

  it("没有已激活的 service worker 时 unsupported——没有 SW 就收不到推送", () => {
    expect(derivePushState(env({ hasActiveWorker: false }))).toEqual({ kind: "unsupported" });
  });

  it("VAPID 公钥缺失时 unsupported——环境变量没配，浏览器再新也订阅不了", () => {
    expect(derivePushState(env({ hasVapidKey: false }))).toEqual({ kind: "unsupported" });
  });

  it("权限被拒时 denied，且不能伪装成「未订阅」——那会让用户白点一次", () => {
    expect(derivePushState(env({ permission: "denied", hasSubscription: false }))).toEqual({
      kind: "denied",
    });
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run src/lib/push/client.test.ts`
Expected: FAIL —— `derivePushState is not a function`。

- [ ] **Step 3: 在 `src/lib/push/client.ts` 末尾追加实现**

先在文件顶部的 import 区加：

```ts
import { readPlatform } from "@/lib/pwa/platform";
```

然后在文件末尾追加：

```ts
/**
 * 这台设备现在到底能不能收到推送。
 *
 * 用判别联合而不是一堆布尔：调用方必须穷尽分支，将来加一种降级情况时
 * TypeScript 会把所有没处理的地方指出来。
 */
export type PushState =
  | { kind: "ready"; subscribed: boolean }
  | { kind: "ios-install-first" }
  | { kind: "denied" }
  | { kind: "unsupported" };

export interface PushEnvironment {
  /** serviceWorker / PushManager / Notification 三个 API 都在 */
  hasApis: boolean;
  /** 真的有一个已激活的 service worker registration，不只是 API 存在 */
  hasActiveWorker: boolean;
  hasVapidKey: boolean;
  /** null = Notification API 不存在，问不出权限 */
  permission: NotificationPermission | null;
  isIos: boolean;
  isStandalone: boolean;
  hasSubscription: boolean;
}

/**
 * 纯判定。异步取值在 readPushState 里，这里只做分支——于是它可以在 node
 * 环境下直接单测，不用 stub navigator。沿用 pwa/platform.ts 的 detectPlatform
 * / readPlatform 那一对的做法。
 *
 * **分支顺序有意义。** iOS 未装到主屏必须排在 unsupported 前面：那种情况下
 * Notification 与 PushManager 本来就不存在，hasApis 是 false，先判它的话用户
 * 看到的是「当前浏览器不支持推送通知」——一句死路文案，而真相是「再点两下
 * 就能用」。
 */
export function derivePushState(env: PushEnvironment): PushState {
  if (env.isIos && !env.isStandalone) return { kind: "ios-install-first" };
  if (!env.hasApis || !env.hasActiveWorker || !env.hasVapidKey) return { kind: "unsupported" };
  if (env.permission === "denied") return { kind: "denied" };
  return { kind: "ready", subscribed: env.hasSubscription };
}

/**
 * navigator.serviceWorker.ready 在从未注册过 SW 时**永不 resolve**——不是
 * reject，是挂起。而 ServiceWorkerRegistrar 有 `NODE_ENV !== "production"`
 * 的早退，所以 npm run dev 下压根没有 SW：不加这道超时，设置页的通知区块
 * 在本地开发中会永远停在加载态，这个功能没法被开发。
 *
 * 超时后按「没有可用的 SW」处理，落到 unsupported——那正是事实。
 */
const SW_READY_TIMEOUT_MS = 3000;

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

/** 浏览器侧的薄封装。纯函数留给单测，这里只负责取值。 */
export async function readPushState(): Promise<PushState> {
  if (typeof window === "undefined") return { kind: "unsupported" };

  const platform = readPlatform();
  const hasApis =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  let hasActiveWorker = false;
  let hasSubscription = false;
  if (hasApis) {
    const registration = await activeRegistration();
    hasActiveWorker = registration !== null;
    if (registration) {
      try {
        hasSubscription = (await registration.pushManager.getSubscription()) !== null;
      } catch {
        // 取不到订阅就按没有处理——显示为「关」，用户点一下会走完整的订阅流程
        hasSubscription = false;
      }
    }
  }

  return derivePushState({
    hasApis,
    hasActiveWorker,
    hasVapidKey: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    permission: hasApis ? Notification.permission : null,
    isIos: platform.os === "ios",
    isStandalone: platform.isStandalone,
    hasSubscription,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/push/client.test.ts`
Expected: PASS（8 条全绿）。

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/lib/push/client.ts src/lib/push/client.test.ts
git commit -m "feat(push): 探测这台设备到底能不能收到推送，四种断法各有各的话

「什么都没收到」在用户那里长得一模一样，但原因分四种：iOS 没装到主屏、
权限被拒、API 或 VAPID 公钥缺失、已就绪但还没订阅。笼统报一句「保存失败」
等于让用户自己猜。

iOS 未装主屏必须排在 unsupported 之前：那种情况下 Notification 本来就不
存在，先判 API 的话用户看到的是「浏览器不支持」这句死路文案，而真相是
再点两下就能用。

serviceWorker.ready 带 3 秒超时：它在从未注册过 SW 时永不 resolve，而
ServiceWorkerRegistrar 有 NODE_ENV 早退——不加超时，dev 下这个区块会
永远停在加载态。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 「发送测试通知」端点

推送链路有四段都可能断，而四段断在用户那里一模一样。这个端点走完整的真实链路（订阅行 → VAPID → 推送服务 → SW），收到了就证明四段全通。

**Files:**
- Create: `src/app/api/push/test/route.ts`

**Interfaces:**
- Consumes: Task 2 的 `buildTestMessage(locale)`；已有的 `sendToSubscriptions(rows, payload)` 与 `SubscriptionRow`（`@/lib/push/send`）；`createClient`（`@/lib/supabase/server`）
- Produces: `POST /api/push/test` → `200 { sent: number; removed: number }` / `400 { error: "no_subscription" }` / `401 { error: "Unauthorized" }` / `500 { error: string }`

- [ ] **Step 1: 创建路由**

创建 `src/app/api/push/test/route.ts`：

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendToSubscriptions, type SubscriptionRow } from "@/lib/push/send";
import { buildTestMessage } from "@/lib/push/messages";

// web-push 需要 node:crypto，不能跑在 Edge runtime 上
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 给自己发一条测试通知。
 *
 * 存在的理由：推送链路有四段都可能断——浏览器权限、service worker 注册、
 * 服务端的订阅行、VAPID 发送——而四段断在用户那里长得完全一样（「什么都
 * 没收到」）。这个端点走的是**完整的真实链路**，收到了就证明四段全通；
 * 没收到时服务端的具体报错会被原样带回页面上。
 *
 * 没有它，验证要等下一轮扫描真的出新卡：扫描间隔 15 分钟，而且不保证
 * 那一轮有新卡。
 *
 * 不做服务端限流：这是登录用户给**自己**发通知，滥用面就是自己吵自己。
 * 连点由前端的 30 秒冷却挡住。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale, failed_count")
    .eq("user_id", user.id);

  const rows = (data ?? []) as SubscriptionRow[];
  // 一行都没有本身就是答案：浏览器那边没订阅成功，或者订阅行已被清掉。
  // 这跟「发了但没收到」是完全不同的处置，不能混成同一个 200。
  if (rows.length === 0) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  try {
    // 逐行发：文案按每台设备订阅时存下的 locale 生成，跟 screener 扇出同一个道理
    const results = await Promise.all(
      rows.map((row) =>
        sendToSubscriptions([row], {
          ...buildTestMessage(row.locale),
          url: `/${row.locale}/settings`,
          tag: "test",
        })
      )
    );
    return NextResponse.json({
      sent: results.reduce((n, r) => n + r.sent, 0),
      removed: results.reduce((n, r) => n + r.removed, 0),
    });
  } catch (error) {
    // send.ts 的 configure() 在 VAPID 变量缺失时抛的是一条明确的中文错误
    // （只有变量名，没有值）。原样带回页面——这个按钮存在的全部意义就是让
    // 「为什么收不到」有个具体答案，在这里吞掉它等于把按钮废了。
    // 截断到 200 字符：web-push 的底层错误可能很长，通知区块放不下。
    console.error("[push/test]", error);
    const message = error instanceof Error ? error.message : "Push failed";
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
```

- [ ] **Step 2: 确认类型通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 确认路由能被构建识别**

Run: `npm run build`
Expected: 构建成功，输出的路由清单里出现 `/api/push/test`（标记为 `ƒ` 动态）。

> 若构建因为**其它**已存在的问题失败，记录下来但不要在本任务里顺手修——它跟本次改动无关。确认 `/api/push/test` 相关无报错即可继续。

- [ ] **Step 4: 提交**

```bash
git add src/app/api/push/test/route.ts
git commit -m "feat(push): 加一个走完整真实链路的测试端点

推送有四段都可能断——浏览器权限、SW 注册、服务端订阅行、VAPID 发送——
而四段断在用户那里长得一模一样。这个端点从订阅行一路发到 SW，收到了就
证明四段全通。

订阅行为 0 返回 400 而不是 200 sent:0：「没订阅」和「发了没收到」的处置
完全不同，混成一个响应等于把最有用的那点信息扔了。VAPID 缺失时的报错
原样带回页面（只有变量名没有值），在这里吞掉它等于把按钮废了。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 通知设置组件

整块 UI 自成一个组件：状态探测、开关、四种降级说明、测试按钮。设置页只负责摆放它。

**Files:**
- Create: `src/components/settings/NotificationSettings.tsx`
- Modify: `src/i18n/messages/zh-CN.json`、`src/i18n/messages/en-US.json`、`src/i18n/messages/ms-MY.json`

**Interfaces:**
- Consumes: Task 3 的 `readPushState()` / `PushState`；已有的 `subscribeToPush(locale)`、`resubscribeIfNeeded(locale)`；Task 4 的 `POST /api/push/test`；已有的 `GET`/`PUT /api/user/notification-prefs`
- Produces: `export function NotificationSettings(): JSX.Element`（无 props），Task 6 挂载它

- [ ] **Step 1: 三个语言文件的 `settings` 命名空间各加 5 个键**

在每个文件 `"settings"` 对象内、`"api_keys_desc"` 那一行**之后**插入（注意给前一行补逗号）：

`src/i18n/messages/zh-CN.json`：
```json
    "notifications": "通知",
    "notifications_scanner": "扫描器新卡片",
    "notifications_scanner_desc": "扫描器出现新的警报卡时通知你，即使 Chart-IX 没有打开。",
    "notifications_test": "发送测试通知",
    "notifications_test_sent": "已发送，几秒内应该会收到。",
    "notifications_test_stale": "这台设备的订阅已失效。请关掉开关再打开一次。"
```

`src/i18n/messages/en-US.json`：
```json
    "notifications": "Notifications",
    "notifications_scanner": "Scanner alerts",
    "notifications_scanner_desc": "Get notified when the scanner surfaces a new alert card, even when Chart-IX isn't open.",
    "notifications_test": "Send a test notification",
    "notifications_test_sent": "Sent — it should arrive within a few seconds.",
    "notifications_test_stale": "This device's subscription has expired. Turn the switch off and on again."
```

`src/i18n/messages/ms-MY.json`：
```json
    "notifications": "Pemberitahuan",
    "notifications_scanner": "Amaran penapis",
    "notifications_scanner_desc": "Dapat pemberitahuan apabila penapis menemui kad amaran baharu, walaupun Chart-IX tidak dibuka.",
    "notifications_test": "Hantar pemberitahuan ujian",
    "notifications_test_sent": "Dihantar — sepatutnya tiba dalam beberapa saat.",
    "notifications_test_stale": "Langganan peranti ini telah tamat. Tutup suis dan hidupkan semula."
```

**其余文案不新增**，直接复用 `pwa` 命名空间下已有的三语键：`push_denied`、`push_unsupported`、`push_error`、`push_ios_install_first`、`install_ios_step1/2/3`。

- [ ] **Step 2: 确认 JSON 没写坏**

Run: `node -e "['zh-CN','en-US','ms-MY'].forEach(l=>{const d=require('./src/i18n/messages/'+l+'.json');const k=['notifications','notifications_scanner','notifications_scanner_desc','notifications_test','notifications_test_sent','notifications_test_stale'];const missing=k.filter(x=>!(x in d.settings));if(missing.length)throw new Error(l+' 缺键: '+missing);console.log(l,'ok')})"`
Expected: 三行 `ok`，无异常。

- [ ] **Step 3: 创建组件**

创建 `src/components/settings/NotificationSettings.tsx`：

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  readPushState,
  resubscribeIfNeeded,
  subscribeToPush,
  type PushState,
} from "@/lib/push/client";
import { cn } from "@/lib/utils";

/** PUT 的 body 仍是三个键的完整对象——UI 只暴露 screener，但不能把另外两个抹掉 */
type Prefs = { price_alerts: boolean; screener: boolean; new_content: boolean };
type Notice = { tone: "ok" | "bad"; text: string } | null;

/** 点一次测试之后按钮禁用多久。够用户看一眼通知栏，也挡住连点。 */
const TEST_COOLDOWN_MS = 30_000;

/**
 * 设置页的通知区块。
 *
 * 这里的核心规则是把**设备级的浏览器订阅**和**用户级的通知偏好**分开对待：
 *
 * - 开：必须先真的拿到浏览器订阅，成功了才写偏好。顺序反过来就是这个功能
 *   一直以来的 bug——数据库说「已开启」而浏览器根本没订阅过，用户永远收不到，
 *   而页面上没有任何东西提示这件事。
 * - 关：只写偏好，**不退订**。push_subscriptions 是一台设备一行、三类通知
 *   共用，退订会连带把到价提醒也废掉。留着一行 screener=false 的订阅成本是
 *   零——getOptedInSubscriptions 先按偏好表筛 user_id，这个用户根本不在结果集里。
 *
 * 显示态也不直接用数据库那个布尔值：偏好开着但权限被撤/订阅丢了的时候，
 * 「显示为开」就是在骗人。三段全通才算开。
 */
export function NotificationSettings() {
  const t = useTranslations("settings");
  const tPwa = useTranslations("pwa");
  const locale = useLocale();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [cooling, setCooling] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/user/notification-prefs").catch(() => null);
      const json = res?.ok ? ((await res.json().catch(() => null)) as { prefs: Prefs } | null) : null;
      // iOS 清了存储之后浏览器订阅会消失而权限还在。先静默补回来再读状态，
      // 否则开关会显示成「关」，而用户从来没关过它。
      await resubscribeIfNeeded(locale);
      const next = await readPushState();
      if (!alive) return;
      if (json?.prefs) setPrefs(json.prefs);
      setState(next);
    })();
    return () => {
      alive = false;
    };
  }, [locale]);

  useEffect(() => {
    if (!cooling) return;
    const id = setTimeout(() => setCooling(false), TEST_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [cooling]);

  // 三段全通才算开。偏好开着但权限被撤或订阅丢了，显示为开就是在骗人。
  const on = Boolean(prefs?.screener) && state?.kind === "ready" && state.subscribed;
  const interactive = state?.kind === "ready" && prefs !== null;

  const toggle = useCallback(async () => {
    if (!prefs || state?.kind !== "ready" || busy) return;
    setBusy(true);
    setNotice(null);

    if (!on) {
      // subscribeToPush 是幂等的：已有订阅就复用，无论如何都会 POST 给服务端。
      // 必须先它成功，再写偏好。
      const result = await subscribeToPush(locale);
      if (result !== "ok") {
        setNotice({
          tone: "bad",
          text:
            result === "denied"
              ? tPwa("push_denied")
              : result === "unsupported"
                ? tPwa("push_unsupported")
                : tPwa("push_error"),
        });
        setState(await readPushState());
        setBusy(false);
        return;
      }
    }

    const next: Prefs = { ...prefs, screener: !on };
    const res = await fetch("/api/user/notification-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);

    if (!res?.ok) {
      // PUT 失败不能让 UI 和数据库悄悄分叉——保持原样并说出来
      setNotice({ tone: "bad", text: tPwa("push_error") });
      setBusy(false);
      return;
    }

    setPrefs(next);
    setState(await readPushState());
    setBusy(false);
  }, [prefs, state, busy, on, locale, tPwa]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    const json = res
      ? ((await res.json().catch(() => null)) as { sent?: number; error?: string } | null)
      : null;

    if (res?.ok) {
      // sent === 0 说明 send.ts 刚按 404/410 把失效端点删掉了。关掉再打开
      // 会走完整的重新订阅，这是用户自己能做的修复。
      setNotice(
        (json?.sent ?? 0) > 0
          ? { tone: "ok", text: t("notifications_test_sent") }
          : { tone: "bad", text: t("notifications_test_stale") }
      );
    } else if (json?.error === "no_subscription") {
      setNotice({ tone: "bad", text: t("notifications_test_stale") });
    } else {
      setNotice({ tone: "bad", text: json?.error ?? tPwa("push_error") });
    }

    setBusy(false);
    setCooling(true);
  }, [t, tPwa]);

  return (
    <Card className="mt-6" padding="lg">
      <h2 className="font-display text-lg font-semibold tracking-tight text-text-primary">
        {t("notifications")}
      </h2>

      <div className="mt-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-text-primary">{t("notifications_scanner")}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              {t("notifications_scanner_desc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggle()}
            role="switch"
            aria-checked={on}
            aria-label={t("notifications_scanner")}
            disabled={!interactive || busy}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-40",
              on ? "bg-gold" : "bg-bg-hover"
            )}
          >
            <span
              className={cn(
                "absolute top-1 h-5 w-5 rounded-full bg-bg-primary transition-transform",
                on ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>

        {/* iOS 上没装到主屏时 Notification API 压根不存在。给死路文案不如给出路。 */}
        {state?.kind === "ios-install-first" && (
          <div className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            <p>{tPwa("push_ios_install_first")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>{tPwa("install_ios_step1")}</li>
              <li>{tPwa("install_ios_step2")}</li>
              <li>{tPwa("install_ios_step3")}</li>
            </ol>
          </div>
        )}

        {state?.kind === "denied" && (
          <p className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            {tPwa("push_denied")}
          </p>
        )}

        {state?.kind === "unsupported" && (
          <p className="text-xs leading-relaxed text-text-muted">{tPwa("push_unsupported")}</p>
        )}

        {notice && (
          <p
            className={cn(
              "rounded-xs border px-3 py-2 text-xs leading-relaxed",
              notice.tone === "ok"
                ? "border-success/30 bg-success-bg text-success"
                : "border-danger/30 bg-danger-bg text-danger"
            )}
          >
            {notice.text}
          </p>
        )}

        {/* 只在真的订阅上了才显示——开关是关的时候，这个按钮必然报错 */}
        {on && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sendTest()}
            loading={busy}
            disabled={cooling}
            className="w-full sm:w-auto"
          >
            {t("notifications_test")}
          </Button>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: 确认类型与 lint 通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npm run lint`
Expected: 无 error（既有的 warning 不必处理）。

- [ ] **Step 5: 提交**

```bash
git add src/components/settings/NotificationSettings.tsx src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(settings): 通知开关——先拿到浏览器订阅才写偏好，关掉时不退订

开关此前是「愿望」不是「事实」：数据库那个布尔值开着，浏览器可能从没订阅
过（旧页面的 hadAny 判断让 subscribeToPush 压根没被调用），用户看到「已开启」
却永远收不到。现在三段全通才显示为开——偏好、权限、真实存在的订阅。

关掉只写偏好、不调 unsubscribeFromPush：push_subscriptions 一台设备一行、
三类通知共用，退订会连带把到价提醒废掉。留一行 screener=false 的订阅成本
是零，getOptedInSubscriptions 先按偏好表筛人。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 挂进设置页，删掉旧的通知页

**Files:**
- Modify: `src/app/[locale]/(app)/settings/page.tsx`
- Delete: `src/app/[locale]/(app)/more/notifications/page.tsx`
- Delete: `src/app/[locale]/(app)/more/notifications/loading.tsx`
- Modify: `src/i18n/messages/{zh-CN,en-US,ms-MY}.json`（删 `nav.more_notifications`）
- Modify: `src/lib/nav/tabs.test.ts`（删一行引用已删路由的断言）

**Interfaces:**
- Consumes: Task 5 的 `NotificationSettings`

- [ ] **Step 1: 挂载组件**

在 `src/app/[locale]/(app)/settings/page.tsx` 的 import 区加：

```ts
import { NotificationSettings } from "@/components/settings/NotificationSettings";
```

在 return 的 JSX 里，**API Keys 那个 `</Card>` 之后、最外层 `</div>` 之前**插入：

```tsx
      <NotificationSettings />
```

（组件自带 `<Card className="mt-6">`，不需要再包一层。）

- [ ] **Step 2: 确认没有别处引用旧页面**

Run: `grep -rn "more/notifications\|more_notifications" src/`
Expected: 只出现在这四处 —— `more/notifications/page.tsx` 自身、三个 i18n 文件的 `more_notifications` 键、以及 `src/lib/nav/tabs.test.ts:271`。若出现其它引用，**停下来汇报**，不要硬删。

- [ ] **Step 3: 删除旧页面**

```bash
git rm src/app/[locale]/\(app\)/more/notifications/page.tsx src/app/[locale]/\(app\)/more/notifications/loading.tsx
```

（若 shell 对括号转义处理有问题，直接删掉整个 `src/app/[locale]/(app)/more/notifications/` 目录，然后 `git add -A`。）

- [ ] **Step 4: 清掉三个语言文件里没人用的 `nav.more_notifications` 键**

三个文件的 `"nav"` 对象里各删掉一行 `"more_notifications": ...`（zh-CN 是 `"通知设置"`，en-US 是 `"Notifications"`，ms-MY 是 `"Pemberitahuan"`）。**注意保留相邻行的 JSON 逗号结构正确。**

> `buildMoreEntries` 从不产出 `notifications` 这个 key（`MoreEntry.key` 是 `string`，不是联合类型），所以删掉这个 i18n 键不会引起类型错误，也不影响「更多」列表的渲染。

- [ ] **Step 5: 删掉 `tabs.test.ts` 里指向已删路由的那一行**

在 `src/lib/nav/tabs.test.ts` 的 `it("更多 tab 收编的页面都退回更多", ...)` 里删掉这一行：

```ts
    expect(resolveBackTarget("/zh-CN/more/notifications", "zh-CN")).toBe("/zh-CN/more");
```

同一个 `it` 里紧邻的 `/zh-CN/more/alerts` 已经覆盖了完全相同的规则（`case "more"` 分支），所以这条规则仍有测试保护；删的只是一个指向不存在路由的例子。

**不要动** 同文件 `:202` 的 `expect(keys).not.toContain("notifications")` —— 那条断言现在更该成立。

- [ ] **Step 6: 全量验证**

Run: `node -e "['zh-CN','en-US','ms-MY'].forEach(l=>{const d=require('./src/i18n/messages/'+l+'.json');if('more_notifications' in d.nav)throw new Error(l+' 还留着 more_notifications');console.log(l,'ok')})"`
Expected: 三行 `ok`。

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npm test`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 构建成功，路由清单里**没有** `/[locale]/more/notifications`，**有** `/api/push/test`。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(settings): 通知开关落到设置页，删掉那个没有入口的旧通知页

旧页面在 2026-08-10 的导航整理里被从「更多」列表移除后就没有任何入口，
线上等于不存在，而且带着「显示已开启却从没订阅」的 bug。留着它只会让
同一件事有两份会分叉的实现。

它管的 price_alerts / new_content 两个偏好因此失去 UI——但它们现在也没有
（同一次整理关掉的），所以这不是回退，两列仍在表里照常生效。

tabs.test 里那条 resolveBackTarget(\"/more/notifications\") 一并删掉：同一个
it 里紧邻的 /more/alerts 已经覆盖同一条规则，删的只是一个指向不存在路由
的例子。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 真机验收（实现者无法代劳，必须人工执行）

自动化测试覆盖的是纯函数。推送能不能真的到达手机，只有真机能证明。

**前置：确认 Vercel 上四个 VAPID 变量都有值** —— `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`NEXT_PUBLIC_VAPID_PUBLIC_KEY`。其中 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 缺失时页面会显示「当前浏览器不支持推送通知」——**看起来像浏览器的问题，实际是配置的问题**，这是本次功能最容易误诊的一条。另外三个缺失会由测试按钮的服务端报错暴露。

部署到 Vercel 之后（**本地 `npm run dev` 不注册 service worker，通知区块会显示 unsupported，这是预期行为，不是 bug**）：

- [ ] **A. 安卓 Chrome：** 装 PWA 到桌面 → 打开 → 设置 → 通知区块 → 开开关（应弹系统权限请求）→ 点「发送测试通知」→ 收到通知 → 点通知，应打开/切到 App 并落在 `/screener`
- [ ] **B. iPhone Safari，未添加到主屏：** 直接在 Safari 打开设置页 → 开关应**置灰**，下方是「先添加到主屏幕」+ 三步编号引导
- [ ] **C. iPhone，添加到主屏后：** 从主屏图标打开 → 设置 → 开关应可点 → 开 → 点测试 → 收到通知
- [ ] **D. 不误退订：** 在 A 或 C 的设备上，先建一个价格提醒，然后**关掉**扫描器开关 → 等价格提醒触发 → 仍应收到到价提醒（证明关开关没有退订整台设备）
- [ ] **E. 真实触发：** 保持开关打开，等一轮扫描出新卡 → 收到的通知标题应是具体的币种与结构（如「🚨 PENDLE 向上点火」）或「🚨 N 个新信号」，**不应**再出现「新的选币榜单」

任一项失败：先点测试按钮看它报什么。它是唯一能区分四段链路在哪一段断掉的工具。

## 已知不做的事（不是遗漏）

- **`ms-MY` 的场景名是英文。** 场景名与操作文案只有 zh/en 两语，与 Telegram 通道一致。扩三语要连 brief 的六场景速查表一起扩，是独立的一件事。
- **`price_alerts` / `new_content` 没有 UI。** 两列仍在表里照常生效。它们在本次改动之前就没有 UI。
- **通知不能定位到具体卡片。** `url` 一律 `/{locale}/screener`。screener 页目前没有按 `card.key` 定位的锚点，不为一条通知新造一个。
- **iOS 16.4 以下会显示「不支持」。** 前端检测不出精确的 iOS 版本，文案不精确但结论正确。
- **组件本身没有自动化测试。** vitest 配置的 `include` 只有 `src/lib/**` 与 `src/stores/**`，且 `environment: "node"`（无 DOM）。为一个组件引入 jsdom 与 testing-library 是独立的基建决定，不塞进这次改造——判定逻辑已经被抽成 `derivePushState` 并有 8 条单测覆盖。
