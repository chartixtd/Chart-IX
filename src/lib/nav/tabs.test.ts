import { describe, it, expect } from "vitest";
import {
  MOBILE_TABS,
  GUEST_MOBILE_TABS,
  resolveActiveTab,
  resolveActiveGuestTab,
  buildMoreEntries,
  shouldShowBackButton,
  resolveBackTarget,
} from "./tabs";

describe("MOBILE_TABS", () => {
  it("共 5 个位置，选币在正中间且标记为凸起", () => {
    expect(MOBILE_TABS).toHaveLength(5);
    expect(MOBILE_TABS[2].key).toBe("screener");
    expect(MOBILE_TABS[2].center).toBe(true);
    expect(MOBILE_TABS.filter((t) => t.center)).toHaveLength(1);
  });

  it("交易退到第 4 格，仍然一步可达", () => {
    expect(MOBILE_TABS[3].key).toBe("trade");
    expect(MOBILE_TABS[3].center).toBe(false);
  });

  it("链接带上语言前缀", () => {
    expect(MOBILE_TABS.map((t) => t.href("ms-MY"))).toEqual([
      "/ms-MY/dashboard",
      "/ms-MY/learn",
      "/ms-MY/screener",
      "/ms-MY/trade",
      "/ms-MY/more",
    ]);
  });
});

describe("GUEST_MOBILE_TABS", () => {
  it("门槛与桌面访客顶栏一致：只有首页、计算器、更多，没有凸起圆盘", () => {
    expect(GUEST_MOBILE_TABS.map((t) => t.key)).toEqual(["home", "tools", "more"]);
    expect(GUEST_MOBILE_TABS.some((t) => t.center)).toBe(false);
  });

  it("不放开桌面对访客也不开放的产品页", () => {
    const keys = GUEST_MOBILE_TABS.map((t) => t.key);
    for (const gated of ["dashboard", "trade", "screener", "learn"]) {
      expect(keys).not.toContain(gated);
    }
  });

  it("链接带上语言前缀，首页就是语言根路径", () => {
    expect(GUEST_MOBILE_TABS.map((t) => t.href("en-US"))).toEqual([
      "/en-US",
      "/en-US/tools/position-size",
      "/en-US/more",
    ]);
  });
});

describe("resolveActiveGuestTab", () => {
  it("语言首页点亮首页", () => {
    expect(resolveActiveGuestTab("/zh-CN", "zh-CN")).toBe("home");
    expect(resolveActiveGuestTab("/zh-CN/", "zh-CN")).toBe("home");
  });

  it("计算器点亮工具——不能套用已登录那套把它算给「更多」", () => {
    expect(resolveActiveGuestTab("/zh-CN/tools/position-size", "zh-CN")).toBe("tools");
    expect(resolveActiveTab("/zh-CN/tools/position-size", "zh-CN")).toBe("more");
  });

  it("更多点亮更多", () => {
    expect(resolveActiveGuestTab("/ms-MY/more", "ms-MY")).toBe("more");
  });

  it("访客底栏上没有的页面不点亮任何一格", () => {
    for (const p of ["/zh-CN/articles", "/zh-CN/trade", "/zh-CN/screener", "/zh-CN/login"]) {
      expect(resolveActiveGuestTab(p, "zh-CN")).toBeNull();
    }
  });

  it("语言前缀不一致时不做匹配", () => {
    expect(resolveActiveGuestTab("/en-US/more", "zh-CN")).toBeNull();
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

  it("学习 tab 收编视频、文章与行业资讯", () => {
    expect(resolveActiveTab("/zh-CN/videos", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/videos/abc-123", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/articles/hello", "zh-CN")).toBe("learn");
    expect(resolveActiveTab("/zh-CN/news", "zh-CN")).toBe("learn");
  });

  it("更多 tab 收编订单、设置、升级——资讯已改归学习", () => {
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

  it("工具页归「更多」tab——计算器就列在那一页上", () => {
    expect(resolveActiveTab("/zh-CN/tools/position-size", "zh-CN")).toBe("more");
  });
});

describe("buildMoreEntries", () => {
  const base = { locale: "zh-CN", tier: "free", role: "user" };

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
    const entries = buildMoreEntries({ locale: "ms-MY", tier: "pro", role: "user" });
    expect(entries.map((e) => e.key)).toEqual(["tools", "orders", "settings"]);
    expect(entries[1].href).toBe("/ms-MY/orders");
  });

  it("auth 尚未加载完成时（tier 为 null）不显示升级入口，避免闪现", () => {
    const keys = buildMoreEntries({ ...base, tier: null }).map((e) => e.key);
    expect(keys).not.toContain("upgrade");
  });

  it("确认未登录的访客拿到的是升级，而不是订单/设置两堵登录墙", () => {
    const entries = buildMoreEntries({ ...base, tier: null, role: null, signedOut: true });
    expect(entries.map((e) => e.key)).toEqual(["upgrade"]);
  });

  it("访客这里不重复列计算器——他们底栏上已经有独立的工具格", () => {
    const keys = buildMoreEntries({ ...base, signedOut: true }).map((e) => e.key);
    expect(keys).not.toContain("tools");
  });

  it("已登录用户能在「更多」里找到计算器，且排在最前", () => {
    const entries = buildMoreEntries(base);
    expect(entries[0].key).toBe("tools");
    expect(entries[0].href).toBe("/zh-CN/tools/position-size");
  });

  it("访客即使 role 是 admin（不可能，但别让它漏）也不给后台入口", () => {
    const keys = buildMoreEntries({ ...base, role: "admin", signedOut: true }).map((e) => e.key);
    expect(keys).not.toContain("admin");
  });

  it("signedOut 未传时按既定顺序给出全部入口", () => {
    expect(buildMoreEntries(base).map((e) => e.key)).toEqual([
      "tools",
      "orders",
      "settings",
      "upgrade",
    ]);
  });

  it("资讯、价格提醒、通知设置都不再出现在更多里", () => {
    for (const input of [
      base,
      { ...base, tier: "pro" },
      { ...base, role: "admin" },
      { ...base, tier: null },
    ]) {
      const keys = buildMoreEntries(input).map((e) => e.key);
      expect(keys).not.toContain("news");
      expect(keys).not.toContain("alerts");
      expect(keys).not.toContain("notifications");
    }
  });
});

describe("shouldShowBackButton", () => {
  it("语言首页不显示返回——它是导航终点", () => {
    expect(shouldShowBackButton("/zh-CN", "zh-CN")).toBe(false);
  });

  it("5 个 tab 根页都不显示返回", () => {
    for (const seg of ["dashboard", "learn", "trade", "screener", "more"]) {
      expect(shouldShowBackButton(`/zh-CN/${seg}`, "zh-CN")).toBe(false);
    }
  });

  it("tab 根页的子路由要显示返回", () => {
    expect(shouldShowBackButton("/zh-CN/more/alerts", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/articles/hello", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/settings/api-keys", "zh-CN")).toBe(true);
  });

  it("归属于某个 tab 但不是 tab 落地页的页面要显示返回", () => {
    // learn tab 收编 articles/videos，但 tab 本身跳的是 /learn
    expect(shouldShowBackButton("/zh-CN/articles", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/videos", "zh-CN")).toBe(true);
    expect(shouldShowBackButton("/zh-CN/settings", "zh-CN")).toBe(true);
  });

  it("不属于任何 tab 的页面也要显示返回", () => {
    expect(shouldShowBackButton("/zh-CN/login", "zh-CN")).toBe(true);
  });

  it("能容忍结尾的斜杠", () => {
    expect(shouldShowBackButton("/zh-CN/trade/", "zh-CN")).toBe(false);
  });

  it("路径的语言前缀与当前语言不一致时不显示——与 resolveActiveTab 的保守处理一致", () => {
    expect(shouldShowBackButton("/en-US/settings", "zh-CN")).toBe(false);
  });

  it("工具页要显示返回——它不是 tab 落地页", () => {
    expect(shouldShowBackButton("/zh-CN/tools/position-size", "zh-CN")).toBe(true);
  });
});

describe("resolveBackTarget", () => {
  it("详情页退回各自的列表页", () => {
    expect(resolveBackTarget("/zh-CN/articles/hello", "zh-CN")).toBe("/zh-CN/articles");
    expect(resolveBackTarget("/zh-CN/videos/abc", "zh-CN")).toBe("/zh-CN/videos");
    expect(resolveBackTarget("/zh-CN/learn/basics", "zh-CN")).toBe("/zh-CN/learn");
  });

  it("文章/视频列表页退回学习 hub——learn tab 收编了它们", () => {
    expect(resolveBackTarget("/zh-CN/articles", "zh-CN")).toBe("/zh-CN/learn");
    expect(resolveBackTarget("/zh-CN/videos", "zh-CN")).toBe("/zh-CN/learn");
  });

  it("社区帖子退回社区列表（带 tab 参数）", () => {
    expect(resolveBackTarget("/zh-CN/community/42", "zh-CN")).toBe("/zh-CN/articles?tab=community");
  });

  it("设置子页退回设置，设置本身退回更多", () => {
    expect(resolveBackTarget("/zh-CN/settings/api-keys", "zh-CN")).toBe("/zh-CN/settings");
    expect(resolveBackTarget("/zh-CN/settings", "zh-CN")).toBe("/zh-CN/more");
  });

  it("更多 tab 收编的页面都退回更多", () => {
    expect(resolveBackTarget("/zh-CN/more/alerts", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/more/notifications", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/orders", "zh-CN")).toBe("/zh-CN/more");
    expect(resolveBackTarget("/zh-CN/upgrade", "zh-CN")).toBe("/zh-CN/more");
  });

  it("行业资讯退回学习中心——它已从「更多」改归「学习」", () => {
    expect(resolveBackTarget("/zh-CN/news", "zh-CN")).toBe("/zh-CN/learn");
  });

  it("未收编的页面兜底到语言首页，而不是 dashboard——后者对未登录用户是登录墙", () => {
    expect(resolveBackTarget("/zh-CN/login", "zh-CN")).toBe("/zh-CN");
    expect(resolveBackTarget("/zh-CN/register", "zh-CN")).toBe("/zh-CN");
    expect(resolveBackTarget("/zh-CN/offline", "zh-CN")).toBe("/zh-CN");
  });

  it("语言前缀不匹配时兜底到当前语言的首页", () => {
    expect(resolveBackTarget("/en-US/settings", "zh-CN")).toBe("/zh-CN");
  });

  it("目标带上正确的语言前缀", () => {
    expect(resolveBackTarget("/ms-MY/articles/x", "ms-MY")).toBe("/ms-MY/articles");
  });

  it("工具页退回「更多」——计算器现在列在那一页上", () => {
    expect(resolveBackTarget("/zh-CN/tools/position-size", "zh-CN")).toBe("/zh-CN/more");
  });
});
