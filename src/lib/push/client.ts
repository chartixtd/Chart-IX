"use client";

import { readPlatform } from "@/lib/pwa/platform";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** 把一个已经拿到的浏览器订阅 POST 给服务端。幂等（onConflict: "endpoint"），
 * subscribeToPush 和 resubscribeIfNeeded 共用，避免两处各写一遍失败判断逻辑 */
async function postSubscription(
  subscription: PushSubscription,
  locale: string
): Promise<"ok" | "error"> {
  const json = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  try {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, locale }),
    });

    if (!response.ok) {
      // 服务端没记录订阅——浏览器层面已经订阅了但服务端不知道，
      // 提醒会静默失效，必须让调用方知道这不是真正的成功
      return "error";
    }
  } catch {
    // 网络错误同样意味着服务端没有记录到订阅
    return "error";
  }

  return "ok";
}

/**
 * 这里**故意不实现** `pushsubscriptionchange`。
 *
 * 浏览器轮换 endpoint 之后自愈闭环已经是完整的：旧端点下一次发送会返回 410，
 * send.ts 按 404/410 把那一行删掉；用户下次打开 app 时 NotificationSettings
 * 的挂载效果调 resubscribeIfNeeded，拿到新订阅并 POST 建新行。
 *
 * 实现 handler 能缩短的只是「轮换 → 用户下次打开」这一个空窗期，代价是：
 * SW 里没有会话，拿不到 user_id，必须新开一条能凭 endpoint 认领订阅的服务端
 * 路径——那正是 I2 里那个抢占面的放大版，而且它在真机之外没法测（jsdom 里
 * 没有 pushsubscriptionchange 事件，本地开发根本不注册 SW）。
 * 为一个能自愈的空窗期引入一条测不了的写路径，不划算。
 */
export async function subscribeToPush(
  locale: string
): Promise<"ok" | "denied" | "unsupported" | "error"> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "unsupported";

  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return "unsupported";

  // 这一整段都要兜住异常。requestPermission / getSubscription / subscribe
  // 三个都会 reject，而且都是真会发生的事：权限提示被用户手势规则拒掉、
  // applicationServerKey 与既有订阅不匹配（换过 VAPID 密钥的部署）、
  // 推送服务不可达。抛出去的话调用方（PushOptIn.enable、
  // NotificationSettings.toggle）全都没接——unhandled rejection，
  // busy 永远停在 true，按钮转着圈死在那里，一句错误文案都没有。
  // 归一成 "error"：调用方本来就有这一支，会显示 push_error。
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    // 必须走 activeRegistration()，不能裸 await navigator.serviceWorker.ready：
    // 从未注册过 SW 时它永不 resolve（不是 reject，是挂起），拖累的不只是
    // 这一个函数——resubscribeIfNeeded 在没有既有订阅时会回落到这里，
    // NotificationSettings 挂载效果里 resubscribeIfNeeded 又排在 readPushState
    // 前面，一挂就没人能再往下走。null 时诚实返回 unsupported。
    const registration = await activeRegistration();
    if (!registration) return "unsupported";
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // 必须为 true：收到推送却不显示，浏览器会撤销权限
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));

    return postSubscription(subscription, locale);
  } catch {
    return "error";
  }
}

/**
 * 登出前调它退订。
 *
 * 共用设备上这跟 purgePageCache 是同一类隐私问题，而且更刺眼：缓存里的旧
 * HTML 至少要主动去翻才看得到，而前一个人的到价提醒会**主动弹到锁屏上**，
 * 带着币种和价格，弹给现在拿着这台手机的另一个人。行留在库里的话，
 * 下一轮 cron 照发不误——登出并不会让 push_subscriptions 那一行消失。
 *
 * 必须在 signOut() **之前**调用：/api/push/unsubscribe 要鉴权，会话没了就
 * 401，行删不掉。
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  // 同样不能裸 await navigator.serviceWorker.ready——它在从未注册过 SW 时
  // 永不 resolve。这个函数原先没有调用方，那个挂起没人碰得到；现在登出
  // 会 await 它，一挂就是整个登出流程卡死在原地。
  const registration = await activeRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

/**
 * iOS 清了存储之后登录态和订阅会一起丢。若偏好说开着但本地已无订阅，
 * 静默重新订阅——不打扰用户，也不需要再要一次权限（权限还在）。
 *
 * 浏览器已有订阅时也必须照样 POST 给服务端，不能直接 return：如果上一次
 * subscribeToPush 拿到了浏览器订阅、但服务端那次 POST 失败了（网络抖动/
 * 服务端当时出错），"existing" 在这里会永远是真值，函数会永远提前退出，
 * 用户就永久停留在"浏览器订阅了但服务端不知道"的状态。POST 是幂等的
 * （服务端按 endpoint upsert），重复调用无副作用，所以安全默认是每次都发。
 */
export async function resubscribeIfNeeded(locale: string): Promise<void> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return;
  if (Notification.permission !== "granted") return;

  // 整段套 try/catch 并静默吞掉：这个函数是尽力而为的后台修复，它唯一的
  // 调用点是 NotificationSettings 的挂载效果，排在 readPushState **前面**。
  // getSubscription() 一 reject，整个效果就断在这里——setPrefs 和 setState
  // 都不会执行，prefs 永远停在 null，开关永久是骨架屏。补不回订阅没关系，
  // 后面 readPushState 会如实报出「没有订阅」，用户关一下再开就能自己修。
  try {
    // 同样必须走 activeRegistration()——见上面 subscribeToPush 里的注释。
    // 没有可用的 SW 就没什么可续订的，直接返回。
    const registration = await activeRegistration();
    if (!registration) return;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await postSubscription(existing, locale);
      return;
    }
    await subscribeToPush(locale);
  } catch {
    // 见上
  }
}

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
  /** 服务端没配 VAPID 公钥。跟浏览器无关，用户什么都做不了，但运维能修 */
  | { kind: "no-vapid-key" }
  /** 浏览器支持推送，但这个页面没有已激活的 service worker */
  | { kind: "no-service-worker" }
  /** 浏览器真的没有这些 API */
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
 *
 * **三种「用不了」必须分开说，不能合成一句「不支持」。** 早先的版本把
 * `!hasApis || !hasActiveWorker || !hasVapidKey` 合成一个 unsupported 分支，
 * 于是三件处置完全不同的事对着同一句话：
 *
 *   - 浏览器真的没有这些 API   → 用户换个浏览器，或在 iOS 上装到主屏
 *   - 没配 VAPID 公钥          → 运维去补环境变量，用户做什么都没用
 *   - 没有已激活的 service worker → 刷新，或（开发时）改用生产构建
 *
 * 合并的代价是真实发生过的：漏配 NEXT_PUBLIC_VAPID_PUBLIC_KEY 时页面显示
 * 「当前浏览器不支持推送通知」，看起来像浏览器的问题，实际是构建配置的问题，
 * 而这是这个功能最容易误诊的一条。分开之后页面自己就把原因说出来了。
 */
export function derivePushState(env: PushEnvironment): PushState {
  if (env.isIos && !env.isStandalone) return { kind: "ios-install-first" };
  // 浏览器本身的能力排在最前：另外两个是环境问题，而在一个连 API 都没有的
  // 浏览器上报「服务端没配置」只会把人引向错误的方向
  if (!env.hasApis) return { kind: "unsupported" };
  if (!env.hasVapidKey) return { kind: "no-vapid-key" };
  if (!env.hasActiveWorker) return { kind: "no-service-worker" };
  if (env.permission === "denied") return { kind: "denied" };
  return { kind: "ready", subscribed: env.hasSubscription };
}

/**
 * navigator.serviceWorker.ready 在从未注册过 SW 时**永不 resolve**——不是
 * reject，是挂起。而 ServiceWorkerRegistrar 有 `NODE_ENV !== "production"`
 * 的早退，所以 npm run dev 下压根没有 SW：不加这道超时，设置页的通知区块
 * 在本地开发中会永远停在加载态，这个功能没法被开发。
 *
 * 超时后按「没有可用的 SW」处理，落到 no-service-worker——那正是事实，而且
 * 那个分支的文案会明说「本地开发不注册 SW，请用生产构建测试」，不再让人以为
 * 是浏览器的问题。
 */
const SW_READY_TIMEOUT_MS = 3000;

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const raced = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
    ]);
    if (raced) return raced;

    // 超时不等于「没有 SW」，它也可能只是「还没装完」。首访 + 慢网正是后者：
    // install 的 waitUntil 要预缓存 5 个 URL（3 个 offline 页 + 2 个图标），
    // 东南亚移动网络下超过 3 秒是常态。误报的代价是设置页显示
    // 「本地开发不注册 SW，请用生产构建测试」——对着一个生产环境的真实用户，
    // 而且开关会一直点不动，直到他想起来刷新页面。
    //
    // getRegistration() 立即 resolve（不等 active），拿它复核一次：有 registration
    // 就说明 SW 正在装，只是还没好。直接返回它——调用方只用 registration.pushManager，
    // 而 pushManager 挂在 registration 上，installing 阶段就已经可用，
    // 不需要等到 active 才能 getSubscription/subscribe。
    return (await navigator.serviceWorker.getRegistration()) ?? null;
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

/** 通知开关此刻该长什么样。见 deriveSwitchState。 */
export interface SwitchState {
  /** 开关的位置。**反映用户意愿，不反映设备能力** */
  on: boolean;
  /** 这一下点得动吗 */
  interactive: boolean;
  /** 意愿之外的另一半：这台设备现在真的送得到吗 */
  deliverable: boolean;
}

/**
 * 把「用户想不想要」和「这台设备能不能收到」分开。
 *
 * 这两件事此前在组件里被揉成一个布尔（`pref && ready && subscribed`），代价是
 * 线上真实发生过的一个死结：用户在系统里拒了通知权限之后，push 状态变成 denied，
 * 于是开关**同时**显示成关、又被禁用——他看到一个已经是「关」的开关，点它想
 * 确认关掉，而它根本不响应。偏好永远卡在 true，哪天权限恢复推送就自己复活。
 *
 * 拆开之后的规则只有两条：
 *
 *   - 开关位置 = 偏好。设备送不送得到是另一件事，由 deliverable 单独说，
 *     配合上层的原因文案（denied / no-vapid-key / no-service-worker / …）。
 *   - **关掉永远点得动**，它只是一次偏好写入，不需要任何浏览器能力；
 *     只有**打开**需要 kind === "ready"，因为那一步真的要去拿浏览器订阅。
 *
 * prefs 还没加载完（prefsLoaded=false）时两个方向都不能点——不知道当前偏好是
 * 什么就去写，会把用户没碰过的值覆盖掉。
 */
export function deriveSwitchState(
  prefEnabled: boolean,
  push: PushState | null,
  prefsLoaded: boolean
): SwitchState {
  const ready = push?.kind === "ready";
  return {
    on: prefEnabled,
    interactive: prefsLoaded && (prefEnabled || ready),
    deliverable: push?.kind === "ready" && push.subscribed,
  };
}
