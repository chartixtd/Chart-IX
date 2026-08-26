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
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
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
