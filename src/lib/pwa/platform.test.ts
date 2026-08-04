import { describe, it, expect } from "vitest";
import { detectPlatform } from "./platform";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1",
  iosInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  wechat:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42",
  line:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36 Line/14.2.0",
  facebook:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/450.0]",
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const base = { hasTelegramProxy: false, standalone: false, displayModeStandalone: false };

describe("detectPlatform", () => {
  it("识别 iOS Safari，可以走安装引导", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosSafari });
    expect(p.os).toBe("ios");
    expect(p.inAppBrowser).toBeNull();
    expect(p.canPromptInstall).toBe(true);
  });

  it("识别 Android Chrome", () => {
    const p = detectPlatform({ ...base, userAgent: UA.androidChrome });
    expect(p.os).toBe("android");
    expect(p.inAppBrowser).toBeNull();
    expect(p.canPromptInstall).toBe(true);
  });

  it("Telegram 内置浏览器靠注入的 proxy 对象识别", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosSafari, hasTelegramProxy: true });
    expect(p.inAppBrowser).toBe("telegram");
    expect(p.canPromptInstall).toBe(false);
  });

  it("识别微信内置浏览器", () => {
    expect(detectPlatform({ ...base, userAgent: UA.wechat }).inAppBrowser).toBe("wechat");
  });

  it("识别 Line 内置浏览器", () => {
    expect(detectPlatform({ ...base, userAgent: UA.line }).inAppBrowser).toBe("line");
  });

  it("识别 Facebook 内置浏览器", () => {
    expect(detectPlatform({ ...base, userAgent: UA.facebook }).inAppBrowser).toBe("facebook");
  });

  it("iOS 上缺少 Safari 标识的按通用内置浏览器处理", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosInApp });
    expect(p.inAppBrowser).toBe("generic");
    expect(p.canPromptInstall).toBe(false);
  });

  it("iOS Chrome 不是内置浏览器，但 iOS 上只有 Safari 能安装", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosChrome });
    expect(p.inAppBrowser).toBeNull();
    expect(p.canPromptInstall).toBe(false);
  });

  it("navigator.standalone 为真时判定已安装", () => {
    const p = detectPlatform({ ...base, userAgent: UA.iosSafari, standalone: true });
    expect(p.isStandalone).toBe(true);
    expect(p.canPromptInstall).toBe(false);
  });

  it("display-mode: standalone 为真时同样判定已安装", () => {
    const p = detectPlatform({ ...base, userAgent: UA.androidChrome, displayModeStandalone: true });
    expect(p.isStandalone).toBe(true);
  });

  it("桌面浏览器不做移动安装引导", () => {
    const p = detectPlatform({ ...base, userAgent: UA.desktop });
    expect(p.os).toBe("other");
    expect(p.canPromptInstall).toBe(false);
  });
});
