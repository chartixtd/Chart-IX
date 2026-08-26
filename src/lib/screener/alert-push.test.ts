import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatAlertMessage,
  pushNewAlerts,
  pushActiveAlertsNow,
  MAX_ALERTS_PER_MESSAGE,
} from "./alert-push";
import {
  getTelegramPushSettings,
  listTargetsFor,
  deliverToTargets,
  markPushAttempt,
} from "@/lib/telegram-push";
import type { AlertCardData } from "./cards";
import type { Scenario } from "./factors/scenario";

// pushNewAlerts 的编排逻辑要靠 mock 掉外部依赖来测——真实实现会打 Supabase
// 和 Telegram API。
vi.mock("@/lib/telegram-push", () => ({
  getTelegramPushSettings: vi.fn(),
  listTargetsFor: vi.fn(),
  deliverToTargets: vi.fn(),
  markPushAttempt: vi.fn(async () => null),
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));

/**
 * admin_settings 的内存替身，只认 pending 那一行。
 *
 * 没发成的卡片 key 存在这里，而「发不出去也不丢」正是这条路径的要点——
 * 用一个只读的固定桩替代它，就只能验到「这一轮没发」，验不到「下一轮重试」。
 */
const store = { pending: null as unknown };
vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { value: store.pending } }) }),
      }),
      upsert: async (row: { value: unknown }) => {
        store.pending = row.value;
        return { error: null };
      },
    }),
  }),
}));

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    kind: "healthy_trend",
    direction: "long",
    trap: false,
    swingPrev: 0.28,
    swingNow: 0.2961,
    swingNowAt: 0,
    cvdPct: 3.1,
    oiPct: 2.4,
    side: "high",
    ...overrides,
  };
}

const alert: AlertCardData = {
  key: "TIA-USDT|healthy_trend|long|high|0.31",
  symbol: "TIA-USDT",
  coin: "TIA",
  trigger: { type: "scenario", scenario: scenario() },
  direction: "long",
  factors: { oi: 26, cvd: 13 },
  total: 39,
  firstSeenAt: "2026-08-20T00:00:00.000Z",
  firstPrice: 0.2961,
  peakPct: 0,
  invalidation: { price: 0.28, breach: "below" },
};

describe("formatAlertMessage", () => {
  const ignition = (direction: "up" | "down"): AlertCardData["trigger"] => ({
    type: "ignition",
    ignition: { direction, level: 1, distancePct: 1.2, ignitedAt: 1, barsAgo: 0 },
  });

  it("带上触发价——这是整条警报的基准，缺了它后续的累计涨跌无从谈起", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("0.2961");
  });

  it("带上两因子构成", () => {
    expect(formatAlertMessage([alert], "en")).toMatch(/OI26.*CVD13/);
  });

  it("方向、场景名与操作文案都在分组标题上", () => {
    const head = formatAlertMessage([alert], "zh").split(/\r?\n/)[2];
    expect(head).toContain("做多");
    expect(head).toContain("健康趋势");
    expect(head).toContain("顺势，回调进场");
  });

  it("manage 场景显示为「观望」而不是做多/做空", () => {
    const manageAlert: AlertCardData = {
      ...alert,
      trigger: { type: "scenario", scenario: scenario({ kind: "inventory_flush", direction: "manage" }) },
      direction: "manage",
    };
    expect(formatAlertMessage([manageAlert], "zh")).toContain("观望");
  });

  it("转义 HTML", () => {
    expect(formatAlertMessage([{ ...alert, symbol: "<i>-USDT" }], "en")).toContain("&lt;i&gt;");
  });

  /* ── 分组：这条消息可读性的全部 ── */

  // 线上真实的一条：15 张点火卡各占一行，"Ignition Up · Just broke range —
  // follow it" 印了 15 遍，每行都因此折行，真正有区别的三样东西被挤到换行之后。
  it("同一种触发的重复文案只印一次，不再每行一遍", () => {
    const cards = ["A", "B", "C"].map((c) => ({
      ...alert,
      key: c,
      symbol: `${c}-USDT`,
      trigger: ignition("up"),
      direction: "long" as const,
    }));

    const msg = formatAlertMessage(cards, "en");

    expect(msg.match(/Just broke range/g)).toHaveLength(1);
    expect(msg.match(/Ignition Up/g)).toHaveLength(1);
  });

  it("每张卡仍然各占一行，只留自己独有的信息", () => {
    const cards = ["A", "B"].map((c, i) => ({
      ...alert,
      key: c,
      symbol: `${c}-USDT`,
      firstPrice: 1 + i,
      trigger: ignition("up"),
      direction: "long" as const,
    }));

    const rows = formatAlertMessage(cards, "en")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("<b>"));

    expect(rows).toEqual(["<b>A</b> @1 · OI26/CVD13", "<b>B</b> @2 · OI26/CVD13"]);
  });

  it("不同触发分成不同组，各自带自己的标题", () => {
    const up = { ...alert, key: "U", symbol: "U-USDT", trigger: ignition("up"), direction: "long" as const };
    const down = { ...alert, key: "D", symbol: "D-USDT", trigger: ignition("down"), direction: "short" as const };

    const msg = formatAlertMessage([up, down], "zh");

    expect(msg).toContain("向上点火");
    expect(msg).toContain("向下点火");
  });

  // healthy_trend 既可能 long 也可能 short，合成一组的话标题上那个方向就是错的
  it("同一场景不同方向不合并——否则标题上的方向会指错", () => {
    const long = { ...alert, key: "L", symbol: "L-USDT" };
    const short: AlertCardData = {
      ...alert,
      key: "S",
      symbol: "S-USDT",
      trigger: { type: "scenario", scenario: scenario({ direction: "short", side: "low" }) },
      direction: "short",
    };

    const msg = formatAlertMessage([long, short], "zh");

    expect(msg.match(/健康趋势/g)).toHaveLength(2);
    expect(msg).toContain("做多");
    expect(msg).toContain("做空");
  });

  it("组的先后跟随入参的总分降序——最强的一组排在最前面", () => {
    const weakIgnition = { ...alert, key: "W", symbol: "W-USDT", trigger: ignition("up"), direction: "long" as const };

    const msg = formatAlertMessage([alert, weakIgnition], "zh");

    expect(msg.indexOf("健康趋势")).toBeLessThan(msg.indexOf("向上点火"));
  });

  it("陷阱场景用 ⚠️ 顶掉方向圆点，非陷阱场景用圆点", () => {
    const trapAlert: AlertCardData = {
      ...alert,
      trigger: { type: "scenario", scenario: scenario({ kind: "false_top_div", trap: true, direction: "long" }) },
    };
    const trapHead = formatAlertMessage([trapAlert], "zh").split(/\r?\n/)[2];

    expect(trapHead.startsWith("⚠️")).toBe(true);
    // 方向没有因此丢掉——它就在紧接着那一格
    expect(trapHead).toContain("做多");
    expect(formatAlertMessage([alert], "zh").split(/\r?\n/)[2].startsWith("🟢")).toBe(true);
  });

  it("标题带上信号总数", () => {
    const two = [alert, { ...alert, key: "X", symbol: "X-USDT" }];
    expect(formatAlertMessage(two, "zh").split(/\r?\n/)[0]).toContain("2 个信号");
    expect(formatAlertMessage([alert], "en").split(/\r?\n/)[0]).toContain("1 signal");
  });

  // 2369 读起来像编号，2,369 才一眼是价格；而一美元以下的币必须留够小数位，
  // 统一取 2 位会把 0.09426 压成 0.09——那个数字对使用者毫无意义
  it("触发价加千分位，且小数位按量级给", () => {
    const big = formatAlertMessage([{ ...alert, firstPrice: 2369 }], "zh");
    const small = formatAlertMessage([{ ...alert, firstPrice: 0.09426 }], "zh");

    expect(big).toContain("@2,369");
    expect(small).toContain("@0.09426");
  });
});

/* ── 编排：有新卡就推、失败不丢 ── */

const OK_SETTINGS = { enabled: true, botToken: "tok", lastPushedAt: null };

/** 一张有效卡片 = 同时出现在 cards 与（可选的）newCards 里 */
function input(cards: AlertCardData[], newCards: AlertCardData[] = cards) {
  return { cards, newCards };
}

function card(key: string): AlertCardData {
  return { ...alert, key, symbol: `${key}-USDT`, coin: key };
}

function useSettings(over: Record<string, unknown> = {}) {
  vi.mocked(getTelegramPushSettings).mockResolvedValue({ ...OK_SETTINGS, ...over } as never);
  vi.mocked(listTargetsFor).mockResolvedValue([{ id: "t1", enabled: true, botToken: null } as never]);
}

describe("pushNewAlerts", () => {
  beforeEach(() => {
    store.pending = null;
    vi.mocked(getTelegramPushSettings).mockReset();
    vi.mocked(listTargetsFor).mockReset();
    vi.mocked(deliverToTargets).mockReset().mockResolvedValue([{ ok: true } as never]);
    vi.mocked(markPushAttempt).mockClear();
  });

  it("Telegram 推送总开关关闭时一条都不发——运营关的是「机器人静音」，警报不该绕过", async () => {
    useSettings({ enabled: false });

    const out = await pushNewAlerts(input([alert]));

    expect(out.skippedReason).toBe("disabled");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  // 这是这次改动的核心：新卡片出现就推，不再等定时窗口
  it("有新警报卡就立刻推送", async () => {
    useSettings();

    const out = await pushNewAlerts(input([alert]));

    expect(deliverToTargets).toHaveBeenCalledTimes(1);
    expect(out.pushed).toBe(1);
    expect(out.delivered).toBe(true);
  });

  it("本轮没有新卡片时不打扰——卡片还在不等于有新事", async () => {
    useSettings();

    const out = await pushNewAlerts(input([alert], []));

    expect(deliverToTargets).not.toHaveBeenCalled();
    expect(out.skippedReason).toBe("nothing_new");
  });

  it("没有订阅 screener 的目标时不发", async () => {
    vi.mocked(getTelegramPushSettings).mockResolvedValue(OK_SETTINGS as never);
    vi.mocked(listTargetsFor).mockResolvedValue([]);

    expect((await pushNewAlerts(input([alert]))).skippedReason).toBe("no_targets");
  });

  it("推送成功后记一次健康——后台那张健康卡读的就是这几列", async () => {
    useSettings();
    await pushNewAlerts(input([alert]));
    expect(markPushAttempt).toHaveBeenCalledWith(true, null);
  });

  /* ── 纯事件驱动：不看表 ── */

  // 中间版本留过一道「最小推送间隔」的节流闸，那是把时间驱动换了个名字：
  // 够不够钟仍然由时钟说了算，一条刚触发的警报会被压到下一个窗口。
  it("上一条刚发完，紧接着又出新卡，照样立刻发", async () => {
    useSettings({ lastPushedAt: new Date().toISOString() });

    const out = await pushNewAlerts(input([alert]));

    expect(deliverToTargets).toHaveBeenCalledTimes(1);
    expect(out.pushed).toBe(1);
    expect(out.held).toBe(0);
  });

  it("连续两轮各有新卡时两条都发得出去，没有任何窗口概念", async () => {
    useSettings({ lastPushedAt: new Date().toISOString() });
    await pushNewAlerts(input([alert]));
    await pushNewAlerts(input([card("JTO")]));

    expect(deliverToTargets).toHaveBeenCalledTimes(2);
  });

  it("上一轮没发成的卡片，下一轮连同新卡一起重试", async () => {
    store.pending = [alert.key];
    useSettings();
    // 本轮没有新卡片，全靠上一轮没发成的那张
    const out = await pushNewAlerts(input([alert], []));

    expect(out.pushed).toBe(1);
    expect(store.pending).toEqual([]);
  });

  // 只存 key 的全部意义：攒着的期间事件结束了，就不该再推一条过期警报
  it("没发成的卡片已经失效时直接丢掉，不会推一条过期警报", async () => {
    store.pending = ["GONE"];
    useSettings();

    const out = await pushNewAlerts(input([], []));

    expect(deliverToTargets).not.toHaveBeenCalled();
    expect(out.skippedReason).toBe("nothing_new");
    expect(store.pending).toEqual([]);
  });

  it("同一张卡既在待重试的里、又是本轮新出的，只发一条", async () => {
    store.pending = [alert.key];
    useSettings();

    await pushNewAlerts(input([alert]));

    const rendered = vi.mocked(deliverToTargets).mock.calls[0][2]("zh");
    expect(rendered.split(/\r?\n/).filter((l) => l.includes("TIA")).length).toBe(1);
  });

  /* ── 投递失败 ── */

  it("投递失败时整批留到下一轮重试——一次 Telegram 抖动不该让事件消失", async () => {
    useSettings();
    vi.mocked(deliverToTargets).mockResolvedValue([{ ok: false, label: "群", error: "429" } as never]);

    const out = await pushNewAlerts(input([alert]));

    expect(out.pushed).toBe(0);
    expect(out.delivered).toBe(false);
    expect(store.pending).toEqual([alert.key]);
    expect(markPushAttempt).toHaveBeenCalledWith(false, expect.stringContaining("429"));
  });

  /* ── 单条消息上限 ── */

  it("超过单条上限的部分留到下一轮，而不是让整条消息发不出去", async () => {
    const many = Array.from({ length: MAX_ALERTS_PER_MESSAGE + 3 }, (_, i) => card(`C${i}`));
    useSettings();

    const out = await pushNewAlerts(input(many));

    expect(out.pushed).toBe(MAX_ALERTS_PER_MESSAGE);
    expect(out.held).toBe(3);
    expect(store.pending).toHaveLength(3);
  });
});

describe("pushActiveAlertsNow", () => {
  beforeEach(() => {
    store.pending = null;
    vi.mocked(getTelegramPushSettings).mockReset();
    vi.mocked(listTargetsFor).mockReset();
    vi.mocked(deliverToTargets).mockReset().mockResolvedValue([{ ok: true } as never]);
    vi.mocked(markPushAttempt).mockClear();
  });

  // 手动点一下就是明确的意图：总开关和节流都不该挡住它，否则这个按钮
  // 在最需要它的时候（排查「为什么没收到」）恰好用不了
  it("绕过总开关", async () => {
    useSettings({ enabled: false });

    const out = await pushActiveAlertsNow(input([alert], []));

    expect(out.pushed).toBe(1);
  });

  it("推的是当前所有有效卡片，不是「本轮新出的」——否则手动点通常没反应", async () => {
    useSettings();

    await pushActiveAlertsNow(input([alert, card("JTO")], []));

    const rendered = vi.mocked(deliverToTargets).mock.calls[0][2]("zh");
    expect(rendered).toContain("TIA");
    expect(rendered).toContain("JTO");
  });

  it("当前一张有效卡都没有时明确说清楚，而不是发一条空消息", async () => {
    useSettings();

    const out = await pushActiveAlertsNow(input([], []));

    expect(out.skippedReason).toBe("nothing_new");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });
});
