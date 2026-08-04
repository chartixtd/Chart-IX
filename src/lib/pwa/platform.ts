export type InAppBrowser = "telegram" | "wechat" | "line" | "facebook" | "generic";

export interface PlatformInput {
  userAgent: string;
  /** Telegram 会往 window 上注入 proxy 对象，这是比 UA 更可靠的信号 */
  hasTelegramProxy: boolean;
  /** iOS 专属的 navigator.standalone */
  standalone: boolean;
  /** matchMedia("(display-mode: standalone)").matches */
  displayModeStandalone: boolean;
}

export interface Platform {
  os: "ios" | "android" | "other";
  inAppBrowser: InAppBrowser | null;
  isStandalone: boolean;
  /** 当前环境是否值得显示安装引导 */
  canPromptInstall: boolean;
}

export function detectPlatform(input: PlatformInput): Platform {
  const ua = input.userAgent;
  const os: Platform["os"] = /iPhone|iPad|iPod/.test(ua)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : "other";

  const inAppBrowser = detectInAppBrowser(ua, input.hasTelegramProxy, os);
  const isStandalone = input.standalone || input.displayModeStandalone;

  // iOS 上只有 Safari 能「添加到主屏幕」——Chrome for iOS 等同样装不上。
  // 判断不确定时按能装处理（fail-open）：给装不上的人显示引导只是一次无效
  // 点击，把真能装的人挡在门外则是永久流失。
  const iosCanInstall = os === "ios" && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const canPromptInstall =
    !isStandalone &&
    inAppBrowser === null &&
    (os === "android" || iosCanInstall);

  return { os, inAppBrowser, isStandalone, canPromptInstall };
}

function detectInAppBrowser(
  ua: string,
  hasTelegramProxy: boolean,
  os: Platform["os"]
): InAppBrowser | null {
  if (hasTelegramProxy) return "telegram";
  if (/MicroMessenger/.test(ua)) return "wechat";
  if (/\bLine\//.test(ua)) return "line";
  if (/FBAN|FBAV/.test(ua)) return "facebook";
  // iOS 的 WKWebView 内置浏览器不会带 Safari 标识；但 Chrome/Firefox for iOS
  // 会带，所以这条只在没有任何已知浏览器标识时才触发
  if (os === "ios" && !/Safari/.test(ua)) return "generic";
  return null;
}

/** 浏览器侧的薄封装。纯函数留给单测，这里只负责取值。 */
export function readPlatform(): Platform {
  if (typeof window === "undefined") {
    return { os: "other", inAppBrowser: null, isStandalone: false, canPromptInstall: false };
  }
  const w = window as Window & {
    TelegramWebviewProxy?: unknown;
    TelegramWebview?: unknown;
  };
  return detectPlatform({
    userAgent: navigator.userAgent,
    hasTelegramProxy: Boolean(w.TelegramWebviewProxy || w.TelegramWebview),
    standalone: Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  });
}
