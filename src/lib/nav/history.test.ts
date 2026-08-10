import { describe, it, expect, beforeEach } from "vitest";
import { recordPath, hasInAppHistory, resetInAppHistoryForTests } from "./history";

describe("站内导航记录器", () => {
  beforeEach(() => {
    resetInAppHistoryForTests();
  });

  it("整页加载后的第一次记录不算站内跳转——此时按返回会把用户踢出站点", () => {
    recordPath("/zh-CN/articles/hello");
    expect(hasInAppHistory()).toBe(false);
  });

  it("什么都没记录时也是无站内历史", () => {
    expect(hasInAppHistory()).toBe(false);
  });

  it("路径真的变了才算一次站内跳转", () => {
    recordPath("/zh-CN/articles/hello");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(true);
  });

  it("同一路径重复记录不计数——effect 重跑、StrictMode 双调用都不该污染判断", () => {
    recordPath("/zh-CN/articles/hello");
    recordPath("/zh-CN/articles/hello");
    recordPath("/zh-CN/articles/hello");
    expect(hasInAppHistory()).toBe(false);
  });

  it("跨路由组导航时组件会重新挂载，但记录器活着，仍算站内跳转", () => {
    // /dashboard 在 (app) 组、/articles 在 (static) 组，chrome 子树会重挂载
    recordPath("/zh-CN/dashboard");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(true);
  });

  it("一旦有过站内跳转就一直为真，后续回到同一路径也不清零", () => {
    recordPath("/zh-CN/dashboard");
    recordPath("/zh-CN/articles");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(true);
  });
});
