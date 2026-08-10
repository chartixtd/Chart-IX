import { describe, it, expect, beforeEach } from "vitest";
import { recordPath, hasInAppHistory, resetInAppHistoryForTests, recordSyntheticBack } from "./history";

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

  it("返回按钮自己发起的退到上级，不算用户的站内浏览——否则下次按返回会弹回刚离开的页面", () => {
    recordPath("/zh-CN/articles/some-slug"); // 外部链接直入
    expect(hasInAppHistory()).toBe(false);

    // 按下返回：没有站内历史，push 到上级
    recordSyntheticBack("/zh-CN/articles");
    recordPath("/zh-CN/articles"); // 路由变化后 effect 照常触发

    expect(hasInAppHistory()).toBe(false);
  });

  it("连按两次返回能继续往上走，不会在两页之间打转", () => {
    recordPath("/zh-CN/articles/some-slug");

    recordSyntheticBack("/zh-CN/articles");
    recordPath("/zh-CN/articles");
    expect(hasInAppHistory()).toBe(false); // 第二次仍走 push 分支

    recordSyntheticBack("/zh-CN/learn");
    recordPath("/zh-CN/learn");
    expect(hasInAppHistory()).toBe(false);
  });

  it("合成跳转之后，用户真正的站内跳转仍然正常计数", () => {
    recordPath("/zh-CN/articles/some-slug");
    recordSyntheticBack("/zh-CN/articles");
    recordPath("/zh-CN/articles");

    // 用户自己点了一个链接
    recordPath("/zh-CN/articles/another-slug");
    expect(hasInAppHistory()).toBe(true);
  });
});
