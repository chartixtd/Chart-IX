# 扫描器新卡片推送通知设计文档

日期：2026-08-26
状态：已获用户批准

## 背景与问题

用户要的东西一句话：**手机 PWA 上，「更多 → 设置」里有个开关，打开就能在扫描器
出新警报卡时收到系统推送，安卓和 iOS 都要真的能收到。**

摸底之后发现这个功能**已经存在大半**，只是从来没人能用上。三个真实缺口：

### 1. 入口在四个月前被显式关掉了

`src/lib/nav/tabs.ts` 的 `buildMoreEntries` 里躺着这句注释：

> 资讯已移入「学习」；价格提醒与通知设置暂时隐藏（路由与页面都保留，
> 想开回来把条目加回这里即可）。

来源是 `2026-08-10-mobile-nav-cleanup-design.md`——当时用户说的是「暂时不想露出」。
于是 `/more/notifications` 这个页面在线上等于不存在：它没有任何入口，铃铛也一并
移除了。

### 2. 那个页面即使露出来也是坏的

`src/app/[locale]/(app)/more/notifications/page.tsx` 的 `toggle()` 里：

```ts
const hadAny = KEYS.some((k) => prev[k]);
const hasAny = KEYS.some((k) => next[k]);
if (!hadAny && hasAny) { await subscribeToPush(locale); ... }
if (hadAny && !hasAny) await unsubscribeFromPush();
```

而 `GET /api/user/notification-prefs` 对没有偏好行的用户返回的默认值是
`{ price_alerts: true, screener: false, new_content: true }`。

于是新用户打开页面 → `prev.price_alerts` 已经是 `true` → `hadAny` 恒为真 →
**点开 screener 开关时 `subscribeToPush()` 根本不会被调用**。`PUT` 成功，UI 翻成
「已开启」，浏览器层面从没订阅过，服务端 `push_subscriptions` 里一行都没有。
用户永远收不到，而页面上没有任何东西提示这件事。

这正好是本次要开的那个开关会踩中的路径。

同一段里还埋着第二个陷阱。`unsubscribeFromPush()` 删的是**整台设备**的订阅行，
而它的触发条件是「偏好全关」。在三个开关的旧 UI 里这勉强说得通；一旦按本次设计
只暴露 screener 一个开关，「关掉它」和「偏好全关」在实现上极容易被写成同一件事，
于是关掉扫描器通知会顺手把到价提醒的订阅也废掉。

这不该靠「小心别写错」来防。下面 A 节把设备级订阅和用户级偏好在结构上拆开，
让这个错误无处可写。

### 3. 推送文案说的不是正在发生的事

`src/lib/push/messages.ts` 里 screener 的文案是：

- zh：「新的选币榜单」/「本轮筛选结果已更新，点击查看做多与做空候选。」
- en：「New screener results」/「This round's candidates are ready…」

但触发源早在 T25 就改成了「扫描出**新警报卡**就发」（见
`054_alert_push_event_driven.sql` 与 `alert-push.ts` 的长注释）。Telegram 那一路已经
有完整的分组卡片格式（币种 / 触发价 / 因子 / 场景 / 操作），web-push 这一路却还
在发一句跟内容无关的通用话。

## 已确认的现状事实（2026-08-26 核实）

**能用、不动的部分：**

| 层 | 位置 | 状态 |
|---|---|---|
| 数据表 | `push_subscriptions` / `notification_prefs`（迁移 `026_push_and_alerts.sql`） | 完好 |
| Service Worker | `public/sw.js:162` 的 `push`、`:191` 的 `notificationclick` | 完好 |
| 浏览器订阅 | `src/lib/push/client.ts` 的 `subscribeToPush` / `unsubscribeFromPush` / `resubscribeIfNeeded` | 完好 |
| API | `/api/push/subscribe`、`/api/push/unsubscribe`、`/api/user/notification-prefs` | 完好 |
| 服务端发送 | `src/lib/push/send.ts` 的 `sendToSubscriptions` / `sendToUser` / `getOptedInSubscriptions` | 完好 |
| 扇出触发点 | `src/app/api/cron/screener-scan/route.ts:75`，`newCards.length > 0` 时给勾了 screener 的订阅者发 | 完好 |
| iOS 平台探测 | `src/lib/pwa/platform.ts` 的 `detectPlatform` / `readPlatform` | 完好 |

**已有但用错地方的：** `src/components/pwa/PushOptIn.tsx` 里有
`needsInstallFirst = platform?.os === "ios" && !platform.isStandalone` 的判断和
`push_ios_install_first` 文案——但它只挂在 `/trade` 页的一个弹窗上，通知设置页
里没有任何 iOS 处理。

**i18n 现有可复用的键**（`pwa` 命名空间，三语齐全）：
`push_title`、`push_body`、`push_enable`、`push_later`、`push_denied`、
`push_ios_install_first`、`push_unsupported`、`push_error`、
`install_ios_step1/2/3`。

**settings 页结构：** `src/app/[locale]/(app)/settings/page.tsx` 是
`"use client"`，用 `useTranslations("settings")`，未登录直接返回 `please_login`，
主体是三个 `<Card padding="lg">`（Profile / Language / API Keys）依次堆叠。

**`AlertCardData` 形状**（`src/lib/screener/cards.ts:58`）：
`key` / `symbol` / `coin` / `trigger`（`{type:"scenario"|"ignition"}` 联合）/
`direction` / `factors` / `total` / `firstSeenAt` / `firstPrice` / `peakPct` /
`invalidation`。

## 用户已确认的四个决定

1. **入口并进 `/settings` 页**，在现有三个 Card 之后加第四个「通知」Card。
   不在「更多」列表里单开一行。
2. **只放 scanner 一个开关。** `price_alerts` 与 `new_content` 两列保留在表里、
   仍照常生效，只是 UI 不暴露。
3. **一轮扫描永远只弹一条系统通知**，内容按卡片数自适应。
4. **iOS 非独立模式下开关置灰 + 内联三步引导**，不等用户撞一次失败。

补充确认（用户："我要出来的结果是干净可用的就行"）：
**旧的 `/more/notifications` 页面整个删除**，不留两套会分叉的代码。

## 设计

### A. 订阅生命周期 —— 把「设备级订阅」和「用户级偏好」拆开

这是本次改造的核心，两个 bug 都源于它们被搅在一起。

```
开 screener:
  1. await ensurePushSubscription(locale)
       └─ 权限请求 → pushManager.subscribe → POST /api/push/subscribe（幂等）
  2. 失败 → 回滚 UI 开关，显示**这一段**的具体原因，不写 DB
  3. 成功 → PUT /api/user/notification-prefs { screener: true }

关 screener:
  只 PUT { screener: false }。**不调用 unsubscribeFromPush()。**
```

**为什么关掉时不退订：** `push_subscriptions` 是一台设备一行，三类通知共用同一行。
留着一行 `screener=false` 的订阅，成本是零——`getOptedInSubscriptions("screener")`
先查 `notification_prefs` 拿 user_id，这个用户根本不在结果集里。而误退订的成本是
到价提醒在这台设备上静默死掉，用户不会知道。真正的「这台设备什么都别推了」是另一
个动作，我们不暴露它，也就不需要在这里实现它。

`PUT` 的请求体仍是三个键的完整对象（沿用现有 zod schema，不改 API）：读回来的
prefs 存在 state 里，只覆写 `screener` 那一个键再发回去。这样 UI 只暴露一个开关，
也不会把另外两个偏好抹掉。

### B. 开关显示的是事实，不是愿望

组件挂载时的顺序：

1. `GET /api/user/notification-prefs` 拿 `prefs`
2. `await resubscribeIfNeeded(locale)` —— iOS 清存储后静默自愈（已有函数，
   权限还在时不打扰用户）
3. 探测一次 `readPushState()`

```
显示为开 = prefs.screener
         ∧ Notification.permission === "granted"
         ∧ (await registration.pushManager.getSubscription()) !== null
```

三段任一断掉就显示为关，并渲染对应那一段的说明——而不是笼统的「保存失败」。
四种降级各有各的话：

| 情况 | 开关 | 说明 |
|---|---|---|
| iOS 且 `!isStandalone` | 置灰 | `push_ios_install_first` + `install_ios_step1/2/3` 三步列表 |
| `Notification.permission === "denied"` | 置灰 | `push_denied`（去浏览器/系统设置里重新允许） |
| 无 `serviceWorker` / `PushManager`，或 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 缺失 | 置灰 | `push_unsupported` |
| 其余 | 可点 | —— |

只在挂载时探测一次，**不轮询**。权限是用户在浏览器 UI 里改的，改完必然重新进页面。

`readPushState()` 是 `client.ts` 里的新函数，返回一个判别联合：

```ts
type PushState =
  | { kind: "ready"; subscribed: boolean }
  | { kind: "ios-install-first" }
  | { kind: "denied" }
  | { kind: "unsupported" };
```

判别联合而不是一堆布尔：调用方必须穷尽分支，加一种降级情况时 TypeScript 会指出
所有没处理的地方。

### C. 推送内容

`buildScreenerMessage(locale)` → `buildScreenerAlertMessage(locale, cards)`：

```
1 张卡：  🚨 PENDLE 向上点火
          @1.8305 · 刚突破区间，顺势跟

N 张卡：  🚨 3 个新信号
          PENDLE · ICP · SOL

>5 张：   🚨 12 个新信号
          PENDLE · ICP · SOL 等 12 个
```

**场景名与操作文案直接复用 Telegram 那一路已有的表**，不重新措辞——否则同一个
事件，Telegram 说一套、系统推送说另一套。把
`src/lib/screener/alert-push.ts` 里的 `SCENARIO_LABELS`、`SCENARIO_ACTIONS`、
`IGNITION_LABELS`、`fmtTriggerPrice` 抽到新文件 `src/lib/screener/alert-copy.ts`，
两个通道共用。`alert-push.ts` 改成 import，行为不变。

**已知的语言不对称，本次不修：** 那三张表只有 `zh` / `en` 两语（类型是
`TelegramMessageLang`），而推送订阅的 locale 有 `ms-MY`。**ms-MY 的场景名与操作
文案会落到英文**，通知的框架文案（「N 个新信号」）仍走 `messages.ts` 的三语。
这是现状（Telegram 侧同样），扩三语是独立的一件事，不塞进这次改造。

`fmtTriggerPrice` 的小数位规则（1 美元以下留 6 位）原样带过来——`0.09` 对使用者
毫无意义这件事，在推送通知里同样成立。

其他字段：
- `tag`: 固定 `"screener"`。新的覆盖旧的，通知栏永远只有一条，不堆屏。
- `url`: 一律 `/${locale}/screener`。screener 页目前没有按 `card.key` 定位的锚点，
  不为一条通知新造一个。

**扇出的调用点改动**（`screener-scan/route.ts`）：保持现有的逐行发送结构不变
（那是为了按 `row.locale` 生成文案），只把 payload 构造从
`buildScreenerMessage(row.locale)` 换成
`buildScreenerAlertMessage(row.locale, payload.newCards)`。

### D. 测试通知按钮

新路由 `POST /api/push/test`，`runtime = "nodejs"`（`web-push` 要 `node:crypto`）：

1. `getUser()` 鉴权，未登录 401
2. 查该用户的 `push_subscriptions` 行数；0 行 → `400 { error: "no_subscription" }`
3. `sendToUser(user.id, { title, body, url: "/{locale}/settings", tag: "test" })`
4. 返回 `{ sent, removed }`

**为什么要有它：** 推送链路有四段都可能断——浏览器权限、SW 注册、服务端订阅行、
VAPID 发送——而四段断在用户那里长得一模一样（「什么都没收到」）。这个按钮走完整
的真实链路，收到了就证明四段全通；服务端报错直接回显到页面上。没有它，验证要等
下一轮扫描真的出新卡（扫描间隔 15 分钟，且不保证有新卡）。

前端只在开关为「开」时显示。三种结果：

- `sent > 0` → 「已发送，几秒内应该会收到」
- `sent === 0` → 「订阅已失效，请关掉开关再打开一次」（这正是
  `sendToSubscriptions` 刚刚按 404/410 删掉失效行的情况，重新订阅能自愈）
- HTTP 错误 → 回显服务端的 message

**不加服务端限流。** 这是登录用户给自己发通知，滥用面就是自己吵自己。前端按钮
点击后禁用 30 秒即可。

### E. 文件清单

**新增**

- `src/components/settings/NotificationSettings.tsx` —— 整块通知 Card，自带状态
  探测、开关、降级说明、测试按钮。settings 页只负责摆放它。
- `src/app/api/push/test/route.ts`
- `src/lib/screener/alert-copy.ts` —— 从 `alert-push.ts` 抽出的共用文案表

**修改**

- `src/lib/push/client.ts` —— 新增 `ensurePushSubscription()`、`readPushState()`。
  `subscribeToPush` 保留（`PushOptIn.tsx` 还在用）。
- `src/lib/push/messages.ts` —— `buildScreenerMessage` → `buildScreenerAlertMessage`
- `src/app/[locale]/(app)/settings/page.tsx` —— 在 API Keys Card 之后插入
  `<NotificationSettings />`
- `src/app/api/cron/screener-scan/route.ts` —— 传 `payload.newCards` 进文案
- `src/lib/screener/alert-push.ts` —— 改成 import `alert-copy.ts`
- `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` —— `settings` 命名空间下新增
  通知区块的键

**删除**

- `src/app/[locale]/(app)/more/notifications/page.tsx`
- `src/app/[locale]/(app)/more/notifications/loading.tsx`

删除的影响面已核实：该目录没有任何入口（`buildMoreEntries` 不含 `notifications`），
`grep` 确认没有其他文件 import 它。`nav.more_notifications` 这个 i18n 键在删除后
无人引用，一并清掉三语。`price_alerts` / `new_content` 两个偏好因此失去 UI——但
它们**现在也没有 UI**（同一次 nav-cleanup 关掉的），所以这不是回退。

### F. 测试

**纯函数单测**（`src/lib/push/messages.test.ts` 新建）：

- `buildScreenerAlertMessage`：1 张卡（场景触发）、1 张卡（点火触发）、3 张卡、
  12 张卡（>5 截断）、`ms-MY` 落到英文场景名、`firstPrice < 1` 时小数位为 6

**分支单测**（`src/lib/push/client.test.ts` 新建）：

`readPushState()` 的四个分支各一条——无 `PushManager`、iOS 非 standalone、
`permission === "denied"`、`granted` 且有/无订阅。需要 stub `navigator` 与
`window.matchMedia`，沿用 `src/lib/pwa/manifest.test.ts` 里已有的做法。

**手工验收**（必须在真机上跑，实现者无法代劳）：

1. Android Chrome：装 PWA → 设置页 → 开开关 → 点测试 → 收到通知 → 点通知跳到
   `/screener`
2. iPhone Safari **未**添加到主屏：设置页 → 开关应为置灰 + 三步引导
3. iPhone 添加到主屏后打开：开开关 → 点测试 → 收到通知
4. 关掉开关后，到价提醒仍能收到（验证不误退订）

## 前提与风险

- **Vercel 上必须配齐四个 VAPID 环境变量**：`VAPID_PUBLIC_KEY`、
  `VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`NEXT_PUBLIC_VAPID_PUBLIC_KEY`。
  其中 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 缺失时 `client.ts` 直接返回
  `"unsupported"`，功能在生产上会**看起来像「浏览器不支持」而不是像配置缺失**。
  另外三个缺失由测试按钮的服务端报错暴露（`send.ts` 的 `configure()` 会 throw
  一条明确的中文错误）。这一项在本地无法验证——跟 `COINGLASS_API_KEY` 一样只在
  Vercel 上有值。**上线前必须先确认这四个变量都在。**
- **iOS 16.4 以下没有 Web Push**，即使添加到主屏也没有，且前端检测不出精确的 iOS
  版本。这类设备会落到「当前浏览器不支持」——文案不精确但结论正确。
- **iOS 的推送送达由系统按用量节流**，不保证实时。这是平台行为，不是缺陷。
- **不改 `public/sw.js`**，所以不涉及 bump `VERSION`、也不涉及老客户端拿不到新
  service worker 的问题。
