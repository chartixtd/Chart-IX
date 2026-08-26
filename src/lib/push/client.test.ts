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
