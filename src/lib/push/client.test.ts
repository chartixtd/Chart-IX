import { describe, it, expect } from "vitest";
import { derivePushState, deriveSwitchState, type PushEnvironment } from "./client";

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

  it("浏览器真的缺 API 时才叫 unsupported", () => {
    expect(derivePushState(env({ hasApis: false }))).toEqual({ kind: "unsupported" });
  });

  it("VAPID 公钥缺失时是 no-vapid-key，不是 unsupported——这是运维问题不是浏览器问题", () => {
    expect(derivePushState(env({ hasVapidKey: false }))).toEqual({ kind: "no-vapid-key" });
  });

  it("没有已激活的 service worker 时是 no-service-worker——刷新或改用生产构建能修", () => {
    expect(derivePushState(env({ hasActiveWorker: false }))).toEqual({
      kind: "no-service-worker",
    });
  });

  it("三种「用不了」互不冒名顶替：浏览器能力排最前，其后才是两种环境问题", () => {
    // 一个连 API 都没有的浏览器上报「服务端没配置」，只会把人引向错误的方向
    expect(
      derivePushState(env({ hasApis: false, hasVapidKey: false, hasActiveWorker: false }))
    ).toEqual({ kind: "unsupported" });
    // 反过来：浏览器完全够用，两个环境条件都缺时，先报更根本的那个（没公钥
    // 的话，就算 SW 装好了也订阅不了）
    expect(derivePushState(env({ hasVapidKey: false, hasActiveWorker: false }))).toEqual({
      kind: "no-vapid-key",
    });
  });

  it("权限被拒时 denied，且不能伪装成「未订阅」——那会让用户白点一次", () => {
    expect(derivePushState(env({ permission: "denied", hasSubscription: false }))).toEqual({
      kind: "denied",
    });
  });
});

describe("deriveSwitchState", () => {
  const READY_SUBBED = { kind: "ready", subscribed: true } as const;
  const READY_UNSUBBED = { kind: "ready", subscribed: false } as const;
  const DENIED = { kind: "denied" } as const;

  it("开关位置照抄偏好，不掺设备能力", () => {
    expect(deriveSwitchState(true, READY_SUBBED, true).on).toBe(true);
    expect(deriveSwitchState(false, READY_SUBBED, true).on).toBe(false);
    // 权限被拒不改变「用户想要」这件事，只改变「送不送得到」
    expect(deriveSwitchState(true, DENIED, true).on).toBe(true);
  });

  it("权限被拒时仍然点得动——这是线上那个死结的回归测试", () => {
    // 旧逻辑在这里同时把 on 判成 false、把开关禁用，用户看到一个已经是「关」
    // 的开关却点不动，偏好永远卡在 true，权限一恢复推送就自己复活
    const s = deriveSwitchState(true, DENIED, true);
    expect(s.on).toBe(true);
    expect(s.interactive).toBe(true);
    expect(s.deliverable).toBe(false);
  });

  it("关掉不需要任何设备能力，四种降级下都点得动", () => {
    const degraded = [
      DENIED,
      { kind: "no-vapid-key" },
      { kind: "no-service-worker" },
      { kind: "unsupported" },
    ] as const;
    for (const push of degraded) {
      expect(deriveSwitchState(true, push, true).interactive).toBe(true);
    }
  });

  it("打开需要设备就绪——降级状态下不能点开，否则必然写出一个收不到的 true", () => {
    const degraded = [
      DENIED,
      { kind: "no-vapid-key" },
      { kind: "no-service-worker" },
      { kind: "unsupported" },
      { kind: "ios-install-first" },
    ] as const;
    for (const push of degraded) {
      expect(deriveSwitchState(false, push, true).interactive).toBe(false);
    }
    expect(deriveSwitchState(false, READY_SUBBED, true).interactive).toBe(true);
  });

  it("偏好还没加载完时两个方向都不能点——不知道当前值就写会覆盖掉用户没碰过的键", () => {
    expect(deriveSwitchState(true, READY_SUBBED, false).interactive).toBe(false);
    expect(deriveSwitchState(false, READY_SUBBED, false).interactive).toBe(false);
  });

  it("deliverable 要求就绪**且**真的有订阅——就绪但没订阅等于开着却什么都不会来", () => {
    expect(deriveSwitchState(true, READY_SUBBED, true).deliverable).toBe(true);
    expect(deriveSwitchState(true, READY_UNSUBBED, true).deliverable).toBe(false);
  });

  it("push 状态还没探测出来（null）时不能点，也不算送得到", () => {
    const s = deriveSwitchState(false, null, true);
    expect(s.interactive).toBe(false);
    expect(s.deliverable).toBe(false);
  });
});
