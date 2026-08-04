import { describe, it, expect } from "vitest";
import { MOBILE_TABS, resolveActiveTab, buildMoreEntries } from "./tabs";

describe("MOBILE_TABS", () => {
  it("共 5 个位置，交易在正中间且标记为凸起", () => {
    expect(MOBILE_TABS).toHaveLength(5);
    expect(MOBILE_TABS[2].key).toBe("trade");
    expect(MOBILE_TABS[2].center).toBe(true);
    expect(MOBILE_TABS.filter((t) => t.center)).toHaveLength(1);
  });

  it("链接带上语言前缀", () => {
    expect(MOBILE_TABS.map((t) => t.href("ms-MY"))).toEqual([
      "/ms-MY/dashboard",
      "/ms-MY/learn",
      "/ms-MY/trade",
      "/ms-MY/screener",
      "/ms-MY/more",
    ]);
  });
});

describe("resolveActiveTab", () => {
  it("精确匹配 tab 自身的路由", () => {
    expect(resolveActiveTab("/zh-CN/trade", "zh-CN")).toBe("trade");
    expect(resolveActiveTab("/zh-CN/screener", "zh-CN")).toBe("screener");
  });

  it("子路由归属于父 tab", () => {
    expect(resolveActiveTab("/zh-CN/learn/basics", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/en-US/more/alerts", "en-US")).toBe("more");
  });

  it("学习 tab 收编视频与文章", () => {
    expect(resolveActiveTab("/zh-CN/videos", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/videos/abc-123", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/articles/hello", "zh-CN")).toBe("learn");
  });

  it("更多 tab 收编资讯、订单、设置、升级", () => {
    expect(resolveActiveTab("/zh-CN/news", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/orders", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/settings", "zh-CN")).toBe("more");
    expect(resolveActiveTab("/zh-CN/upgrade", "zh-CN")).toBe("more");
  });

  it("语言首页和未收编的路由不点亮任何 tab", () => {
    expect(resolveActiveTab("/zh-CN", "zh-CN")).toBeNull();
    expect(resolveActiveTab("/zh-CN/login", "zh-CN")).toBeNull();
    expect(resolveActiveTab("/zh-CN/offline", "zh-CN")).toBeNull();
  });

  it("路径的语言前缀与当前语言不一致时不做匹配", () => {
    expect(resolveActiveTab("/en-US/trade", "zh-CN")).toBeNull();
  });

  it("能容忍结尾的斜杠", () => {
    expect(resolveActiveTab("/zh-CN/trade/", "zh-CN")).toBe("trade");
  });
});

describe("buildMoreEntries", () => {
  const base = { locale: "zh-CN", tier: "free", role: "user", userId: "u1" };

  it("免费用户能看到升级入口", () => {
    const keys = buildMoreEntries(base).map((e) => e.key);
    expect(keys).toContain("upgrade");
  });

  it("Pro 用户不显示升级入口", () => {
    const keys = buildMoreEntries({ ...base, tier: "pro" }).map((e) => e.key);
    expect(keys).not.toContain("upgrade");
  });

  it("非管理员看不到后台入口", () => {
    expect(buildMoreEntries(base).map((e) => e.key)).not.toContain("admin");
  });

  it("管理员能看到后台入口，且不带语言前缀", () => {
    const entries = buildMoreEntries({ ...base, role: "admin" });
    const admin = entries.find((e) => e.key === "admin");
    expect(admin).toBeDefined();
    expect(admin?.href).toBe("/admin");
  });

  it("常规入口按既定顺序排列并带语言前缀", () => {
    const entries = buildMoreEntries({ locale: "ms-MY", tier: "pro", role: "user", userId: "u1" });
    expect(entries.map((e) => e.key)).toEqual([
      "news",
      "orders",
      "alerts",
      "settings",
      "notifications",
    ]);
    expect(entries[0].href).toBe("/ms-MY/news");
  });

  it("auth 尚未加载完成时（tier 为 null）不显示升级入口，避免闪现", () => {
    const keys = buildMoreEntries({ ...base, tier: null }).map((e) => e.key);
    expect(keys).not.toContain("upgrade");
  });

  it("未登录（或 auth 未加载完）时不显示 alerts/notifications 入口，避免访问后拿到 401 出现假的服务异常提示", () => {
    const loggedOutKeys = buildMoreEntries({ ...base, userId: null }).map((e) => e.key);
    expect(loggedOutKeys).not.toContain("alerts");
    expect(loggedOutKeys).not.toContain("notifications");

    const loggedInKeys = buildMoreEntries(base).map((e) => e.key);
    expect(loggedInKeys).toContain("alerts");
    expect(loggedInKeys).toContain("notifications");
  });
});
